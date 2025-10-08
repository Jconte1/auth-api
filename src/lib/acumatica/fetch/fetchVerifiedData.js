// src/lib/acumatica/fetch/fetchVerifiedData.js
import https from "node:https";

/**
 * Fetch candidate customer records for verification using ONE OData filter:
 *   Zip5 eq '<zip>' and (PrimaryEmail eq '<email>' or PrimaryPhone1 eq '<phone10>' or PrimaryPhone2 eq '<phone10>')
 *
 * Returns the raw array from Acumatica (not mapped).
 */
export default async function fetchVerifiedData(
  restService,
  {
    zip,
    email,
    phone,
    pageSize = 500, // safety (we don't expect paging here)
  } = {}
) {
  if (!zip || !email || !phone) {
    console.log("[fetchVerifiedData] missing zip/email/phone");
    return [];
  }

  const token = await restService.getToken();
  const base = `${restService.baseUrl}/entity/CustomEndpoint/24.200.001/Customer`;
  const agent = new https.Agent({ keepAlive: true, maxSockets: 8 });

  // OData-escape single quotes
  const esc = (s) => String(s).replace(/'/g, "''");

  const filter = `Zip5 eq '${esc(zip)}' and (PrimaryEmail eq '${esc(email)}' or PrimaryPhone1 eq '${esc(phone)}' or PrimaryPhone2 eq '${esc(phone)}')`;

  const params = new URLSearchParams();
  params.set("$filter", filter);
  params.set("$top", String(pageSize));

  const url = `${base}?${params.toString()}`;

  // Uncomment for debugging:
  // console.log("[fetchVerifiedData] URL:", url);

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
    // console.error(`[fetchVerifiedData] ERROR status=${resp.status} body=${text?.slice(0, 500)}`);
    throw new Error(text || "ERP error");
  }

  let arr = [];
  try { arr = text ? JSON.parse(text) : []; } catch { arr = []; }

  const rows = Array.isArray(arr) ? arr : (arr?.value ?? []);
  console.log(`[fetchVerifiedData] rows=${rows.length} ms=${ms}`);

  return rows;
}
