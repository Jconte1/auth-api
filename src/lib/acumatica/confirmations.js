// src/lib/erp/confirmations.js

/**
 * Placeholder: send a "customer confirmed order" signal to Acumatica.
 * Wire your OAuth client + POST here. Keep the shape stable so callers don't change.
 *
 * @param {Object} payload
 * @param {string} payload.orderId        // internal ID (ErpOrderSummary.id)
 * @param {string} payload.baid
 * @param {string} payload.orderNbr
 * @param {string|Date} [payload.deliveryDate]
 * @param {string} [payload.deliveryEmail]
 * @returns {Promise<{ok: boolean, erpId?: string|null}>}
 */
export async function postOrderConfirmed(payload) {
  // TODO: integrate with your Acumatica client:
  // const token = await acumaticaClient.getToken();
  // const res = await fetch(`${ACUMATICA_URL}/...`, { method:'POST', headers:{ Authorization:`Bearer ${token}` }, body: JSON.stringify(payload) });
  // return { ok: res.ok, erpId: (await res.json()).id };

  // For now, just acknowledge.
  return { ok: true, erpId: null };
}
