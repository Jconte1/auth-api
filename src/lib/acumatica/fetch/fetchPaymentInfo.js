// src/lib/acumatica/fetch/fetchPaymentInfo.js
import https from "node:https";

/**
 * Fetch payment-related fields for specific order numbers (by BAID),
 * batching to keep each request small.
 */
export default async function fetchPaymentInfo(
  restService,
  baid,
  {
    orderNbrs = [],
    chunkSize = Number(process.env.PAYMENTS_CHUNK_SIZE || 20),
    pageSize = 500,          // safety — though we don't expect paging for chunks
  } = {}
) {
  if (!Array.isArray(orderNbrs) || !orderNbrs.length) {
    console.log(`[fetchPaymentInfo] baid=${baid} no orderNbrs provided`);
    return [];
  }

  const token = await restService.getToken();
  const base = `${restService.baseUrl}/entity/CustomEndpoint/24.200.001/SalesOrder`;
  const agent = new https.Agent({ keepAlive: true, maxSockets: 8 });

  const select = ["OrderNbr", "OrderTotal", "UnpaidBalance", "Terms"].join(",");

  const chunks = chunk(orderNbrs, Math.max(1, chunkSize));
  const all = [];
  console.log(`[fetchPaymentInfo] baid=${baid} orderChunks=${chunks.length} chunkSize~=${chunkSize}`);

  const baidLit = baid.replace(/'/g, "''");

  const fetchOnce = async (filter) => {
    const params = new URLSearchParams();
    params.set("$filter", filter);
    params.set("$select", select);
    params.set("$top", String(pageSize));

    const url = `${base}?${params.toString()}`;
    const t0 = Date.now();
    const resp = await fetch(url, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
      },
      agent,
    });
    const ms = Date.now() - t0;
    const text = await resp.text();
    if (!resp.ok) {
      console.error(`[fetchPaymentInfo] baid=${baid} ERROR status=${resp.status} body=${text?.slice(0,500)}`);
      throw new Error(text || `ERP error for ${baid}`);
    }
    let arr = [];
    try { arr = text ? JSON.parse(text) : []; } catch { arr = []; }
    const rows = Array.isArray(arr) ? arr : [];
    return { rows, ms };
  };

  for (let i = 0; i < chunks.length; i++) {
    const batch = chunks[i];
    const ors = batch
      .map(n => String(n).replace(/'/g, "''"))
      .map(n => `OrderNbr eq '${n}'`)
      .join(" or ");

    const filter = [`CustomerID eq '${baidLit}'`, `(${ors})`].join(" and ");
    const { rows, ms } = await fetchOnce(filter);
    all.push(...rows);

    console.log(
      `[fetchPaymentInfo] baid=${baid} batch=${i + 1}/${chunks.length} orders=${batch.length} rows=${rows.length} ms=${ms}`
    );
  }

  console.log(`[fetchPaymentInfo] baid=${baid} totalRows=${all.length}`);
  return all;
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}
