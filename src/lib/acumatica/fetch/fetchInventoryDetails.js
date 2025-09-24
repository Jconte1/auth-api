import https from "node:https";

/**
 * Parallel, adaptive fetch of SalesOrder Details for specific order numbers.
 * Adjusted to be friendlier to throttling:
 *  - smaller default pool + batch
 *  - per-request timeout
 *  - respect Retry-After on 429
 *  - light minDelay pacing between requests
 *  - also split batches on 429 (not only long URI)
 */
export default async function fetchInventoryDetails(
  restService,
  baid,
  orderNbrs,
  {
    batchSize   = Number(process.env.LINES_BATCH_SIZE   || 16),   // was 24
    pool        = Number(process.env.LINES_POOL         || 4),    // was 6
    maxSockets  = Number(process.env.LINES_MAX_SOCKETS  || 8),    // ≈ pool*2
    retries     = Number(process.env.LINES_RETRIES      || 4),    // was 3
    maxUrl      = Number(process.env.ACUMATICA_MAX_URL  || 7000),
    timeoutMs   = Number(process.env.LINES_TIMEOUT_MS   || 25000),
    minDelayMs  = Number(process.env.LINES_MIN_DELAY_MS || 150),  // small pacing
  } = {}
) {
  if (!Array.isArray(orderNbrs) || orderNbrs.length === 0) return [];

  const token = await restService.getToken();
  const base = `${restService.baseUrl}/entity/CustomEndpoint/24.200.001/SalesOrder`;
  const agent = new https.Agent({ keepAlive: true, maxSockets });

  const select = [
    "OrderNbr",
    "Details/InventoryID",
    "Details/LineDescription",
    "Details/LineType",
    "Details/UnitPrice",
    "Details/OpenQty",
    "Details/UsrETA",
    "Details/Here",
    "Details/WarehouseID",
  ].join(",");

  const chunks = chunk(orderNbrs, Math.max(1, batchSize));
  const all = [];

  // light global pacer so we don't burst too fast
  let lastHit = 0;
  async function pace() {
    const now = Date.now();
    const delta = now - lastHit;
    if (delta < minDelayMs) await sleep(minDelayMs - delta);
    lastHit = Date.now();
  }

  const fetchBatchAdaptive = async (batch, batchIndex, totalBatches, depth = 0) => {
    // Build URL
    const ors = batch
      .map(n => String(n).replace(/'/g, "''"))
      .map(n => `OrderNbr eq '${n}'`)
      .join(" or ");

    // Add status exclusions (same spirit as order summaries)
    const blockedStatuses = [
      "Canceled", "Cancelled", "On Hold",
      "Pending Approval", "Rejected", "Pending Processing",
      "Awaiting Payment", "Credit Hold", "Completed",
      "Invoiced", "Expired", "Purchase Hold",
      "Not Approved", "Risk Hold"
    ];
    const statusClauses = blockedStatuses.map(s => `Status ne '${s.replace(/'/g, "''")}'`);
    // Also exclude empty status
    statusClauses.push(`Status ne ''`);

    const filter = [
      `CustomerID eq '${String(baid).replace(/'/g, "''")}'`,
      `(${ors})`,
      ...statusClauses,
    ].join(" and ");

    const params = new URLSearchParams();
    params.set("$filter", filter);
    params.set("$select", select);
    params.set("$expand", "Details");
    params.set("$top", String(500));
    const url = `${base}?${params.toString()}`;

    // If URL is too long, split recursively
    if (url.length > maxUrl && batch.length > 1) {
      const mid = Math.floor(batch.length / 2);
      await fetchBatchAdaptive(batch.slice(0, mid), batchIndex, totalBatches, depth + 1);
      await fetchBatchAdaptive(batch.slice(mid), batchIndex, totalBatches, depth + 1);
      return;
    }

    const attemptFetch = async (attempt) => {
      // pacing + tiny jitter before each network call
      await pace();
      if (attempt > 0) await sleep(15 + Math.floor(Math.random() * 25));

      const controller = new AbortController();
      const t0 = Date.now();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);

      let resp, text;
      try {
        resp = await fetch(url, {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
            "Accept": "application/json",
            "Accept-Encoding": "gzip, deflate",
            "Authorization": `Bearer ${token}`,
          },
          agent,
          signal: controller.signal,
        });
        text = await resp.text();
      } finally {
        clearTimeout(timeout);
      }

      const ms = Date.now() - t0;

      if (!resp.ok) {
        const status = resp.status;
        const body = (text || "").toString();

        // conditions that indicate we should split the batch (URI too long / HTML module msg / bad request due to filter size / or throttled)
        const splitWorthy =
          status === 413 || status === 414 ||
          status === 429 || // add split option on 429 too
          body.includes("custom error module does not recognize this error") ||
          (status === 400 && url.length > Math.floor(maxUrl * 0.8));

        if (splitWorthy && batch.length > 1) {
          console.warn(`[fetchInventoryDetails] split batch (status=${status}) urlLen=${url.length} depth=${depth} baid=${baid} size=${batch.length}`);
          const mid = Math.floor(batch.length / 2);
          await fetchBatchAdaptive(batch.slice(0, mid), batchIndex, totalBatches, depth + 1);
          await fetchBatchAdaptive(batch.slice(mid), batchIndex, totalBatches, depth + 1);
          return;
        }

        // retry-worthy?
        if ((status === 429 || (status >= 500 && status < 600)) && attempt < retries) {
          // If Retry-After is present, honor it
          let wait = 0;
          const ra = resp.headers.get("retry-after");
          if (ra) {
            const secs = Number(ra);
            if (Number.isFinite(secs)) {
              wait = Math.max(0, Math.floor(secs * 1000));
            } else {
              // HTTP-date
              const until = Date.parse(ra);
              if (Number.isFinite(until)) wait = Math.max(0, until - Date.now());
            }
          }
          if (wait === 0) {
            // exponential backoff + jitter
            wait = (400 * Math.pow(2, attempt)) + Math.floor(Math.random() * 400);
          }
          console.warn(`[fetchInventoryDetails] retry ${attempt + 1}/${retries} baid=${baid} batch=${batchIndex + 1}/${totalBatches} status=${status} wait=${wait}ms`);
          await sleep(wait);
          return attemptFetch(attempt + 1);
        }

        throw new Error(body || `ERP error (status ${status}) for ${baid}`);
      }

      let rows = [];
      try {
        const json = text ? JSON.parse(text) : [];
        rows = Array.isArray(json) ? json : [];
      } catch {
        rows = [];
      }

      all.push(...rows);
      console.log(`[fetchInventoryDetails] baid=${baid} batch=${batchIndex + 1}/${totalBatches} depth=${depth} orders=${batch.length} rows=${rows.length} ms=${ms}`);
    };

    await attemptFetch(0);
  };

  await poolRun(
    chunks,
    Math.max(1, pool),
    async (batch, idx) => fetchBatchAdaptive(batch, idx, chunks.length)
  );

  console.log(`[fetchInventoryDetails] baid=${baid} totalRows=${all.length} batches=${chunks.length} pool=${pool} batchSize=${batchSize}`);
  return all;
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function poolRun(items, concurrency, worker) {
  let i = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const idx = i++; if (idx >= items.length) break;
      await worker(items[idx], idx);
    }
  });
  await Promise.all(runners);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
