// src/lib/acumatica/escalations.js

/**
 * Post a 6-week delivery escalation to Acumatica.
 *
 * Called by the single-pass T42 runner when:
 *  - (A) Still unconfirmed and daysOut < 39  → escalate immediately, OR
 *  - (B) Still unconfirmed, in/after 39–42 window, and attemptCount hit 3 → escalate (4th action).
 *
 * IMPORTANT:
 *  - The caller (runner) is responsible for:
 *      * Marking contact.sixWeekFailed = true
 *      * Resetting NotificationJob.attemptCount → 0
 *      * Stamping notificationJob.escalationPostedAt
 *  - This function should be idempotent on its own when wired to Acumatica (see TODOs).
 *
 * @typedef {Object} T42EscalationPayload
 * @property {string} orderId           - Local ErpOrderSummary.id (FK)
 * @property {string} baid              - Business account ID (Acumatica customer key)
 * @property {string} orderNbr          - ERP order number (human-visible)
 * @property {Date|string} deliveryDate - Scheduled delivery date
 * @property {string|null} deliveryEmail- Email we attempted to reach (may be null/invalid)
 * @property {string} phase             - Constant 'T42'
 * @property {number} daysOut           - Integer days until delivery (Denver-based)
 * @property {number} [attemptCount]    - Optional: attempts counted when escalating
 * @property {string} [reason]          - Optional: 'late-window' | 'attempt-threshold' | etc.
 *
 * @typedef {Object} T42EscalationResult
 * @property {boolean} ok
 * @property {string|null} erpId        - Acumatica record identifier when created/upserted
 * @property {string} note              - Human-readable note about what happened
 */

 /**
  * Placeholder hook — wire this to Acumatica when ready.
  * Return shape is stable so the runner does not change.
  *
  * @param {T42EscalationPayload} payload
  * @returns {Promise<T42EscalationResult>}
  */
export async function postDeliveryEscalation(payload) {
  // ---- Minimal input sanity (non-throwing; runner logic already gated) ----
  const {
    orderId,
    baid,
    orderNbr,
    deliveryDate,
    deliveryEmail,
    phase,
    daysOut,
    attemptCount,
    reason,
  } = payload || {};

  if (!orderId || !baid || !orderNbr) {
    console.warn('[T42 escalate] Missing key identifiers', { orderId, baid, orderNbr });
  }

  // ---- TODO: Implement real Acumatica write via your AcumaticaService ----
  // Suggested implementation details:
  //
  // 1) Build an idempotency key so repeated cron runs don’t create dupes:
  //    const idempotencyKey = `T42:${baid}:${orderNbr}:${phase}`;
  //
  // 2) Upsert a Task/Case/Note in Acumatica:
  //    - Subject: `[T42] Unconfirmed delivery — Order ${orderNbr} (${daysOut} days out)`
  //    - Body includes:
  //        • OrderNbr, BAID, DeliveryDate (yyyy-mm-dd)
  //        • AttemptCount (if provided)
  //        • DeliveryEmail (even if null/invalid)
  //        • Reason ('late-window' | 'attempt-threshold')
  //        • A link back to your internal dashboard (if you have one)
  //    - Assign to the right queue/team based on site/store/buyerGroup.
  //
  // 3) Use a GET-then-POST/PUT pattern or a server-side unique key field to ensure idempotency.
  //
  // 4) Capture and return the ERP-side identifier (e.g., CaseNbr/TaskID) as `erpId`.
  //
  // 5) Error handling:
  //    - If the ERP call fails transiently, return { ok: false, erpId: null, note: '...' }
  //    - The caller can retry on the next cron pass while sixWeekFailed remains false.
  //
  // 6) Auditing:
  //    - Consider logging a structured event for BI ('t42_escalation_created').

  // ---- Placeholder no-op (dev): log and pretend success ----
  console.log('[T42 escalate] Placeholder — would send to Acumatica', {
    orderId,
    baid,
    orderNbr,
    deliveryDate,
    deliveryEmail,
    phase,
    daysOut,
    attemptCount,
    reason,
  });

  // Simulate a stable success shape
  return {
    ok: true,
    erpId: null, // replace with ERP record id when wired
    note: 'Placeholder: escalation accepted; integrate AcumaticaService here.',
  };
}
