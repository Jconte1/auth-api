// src/lib/notifications/t3/run.js
import prisma from '@/lib/prisma/prisma';
import { startOfDayDenver } from '@/lib/time/denver';
import { sendT3Email } from '@/lib/email/mailer';
import { writeT3 } from '@/lib/acumatica/confirmations';
import { writeT3Note } from '@/lib/acumatica/confirmations';

function daysUntilDenver(targetDate, now = new Date()) {
  if (!targetDate) return null;
  const t0 = startOfDayDenver(targetDate);
  const n0 = startOfDayDenver(now);
  return Math.round((t0.getTime() - n0.getTime()) / (24 * 60 * 60 * 1000));
}

function orderTypeFromNbr(orderNbr = '') {
  const m = String(orderNbr).match(/^[A-Za-z0-9]{2}/);
  return m ? m[0].toUpperCase() : null;
}

// Helper: resolve noteId with a DB fallback (keeps scope small)
async function getNoteIdForOrder(o) {
  // Prefer the note id already present on your loaded record
  if (o.noteId) return String(o.noteId);

  // Fallback: quick DB lookup by orderNbr (adjust model/field names if needed)
  const row = await prisma.erpOrderSummary.findUnique({
    where: { orderNbr: String(o.orderNbr) },
    select: { noteId: true },
  });
  return row?.noteId ? String(row.noteId) : null;
}

export async function runT3({ now = new Date() } = {}) {
  const todayDenver = startOfDayDenver(now);

  const orders = await prisma.erpOrderSummary.findMany({
    where: { isActive: true, deliveryDate: { gte: todayDenver } },
    include: { contact: true },
  });

  let sent = 0;
  let resetFlags = 0;
  let skippedNoEmail = 0;
  let skippedOutOfWindow = 0;
  let alreadySent = 0;
  let errors = 0;

  // ERP write metrics
  let erpWrites = 0;
  let erpWriteErrors = 0;

  // NEW: ERP note metrics (optional)
  let erpNotes = 0;
  let erpNoteErrors = 0;
  let skippedNoNoteId = 0;

  for (const o of orders) {
    const daysOut = daysUntilDenver(o.deliveryDate, now);
    const threeDaySent = o?.contact?.threeDaySent === true;
    const to = o?.contact?.deliveryEmail?.trim() || '';

    console.log('[T3][inspect]', o.orderNbr, {
      todayDenver: todayDenver.toISOString(),
      rawDelivery: o.deliveryDate,
      deliveryDenver: startOfDayDenver(o.deliveryDate).toISOString(),
      daysOut,
      threeDaySent,
      hasEmail: !!to,
      noteId: o.noteId ?? null,
    });

    if (daysOut == null) { skippedOutOfWindow++; continue; }

    // Reset rule
    if (daysOut > 3 && threeDaySent) {
        // console.log('daysout', daysOut)
        // console.log('threedaysent', threedaysent)
      await prisma.erpOrderContact.update({
        where: { orderSummaryId: o.id },
        data: { threeDaySent: false },
      });
      resetFlags++;
      continue;
    }

    // Send rule
    if (daysOut >= 2 && daysOut <= 4 && !threeDaySent) {
      if (!to) { skippedNoEmail++; continue; }
      try {
        // 1) Send email
        await sendT3Email({
          to,
          orderNbr: o.orderNbr,
          customerName: o.customerName || '',
          deliveryDate: o.deliveryDate,
        });

        // 2) Mark local flag
        await prisma.erpOrderContact.update({
          where: { orderSummaryId: o.id },
          data: { threeDaySent: true },
        });

        // 3) ERP write (3-day flag)
        try {
          const orderType = orderTypeFromNbr(o.orderNbr);
          if (!orderType) {
            erpWriteErrors++;
            console.error('[T3][ERP write skipped - bad orderType]', o.orderNbr);
          } else {
            await writeT3({ orderType, orderNbr: o.orderNbr });
            erpWrites++;

            // 4) ERP Activity note (best effort)
            try {
              const noteId = await getNoteIdForOrder(o);
              if (!noteId) {
                skippedNoNoteId++;
                console.warn('[T3][ERP note skipped - no noteId]', o.orderNbr);
              } else {
                await writeT3Note({ noteID: noteId });
                erpNotes++;
              }
            } catch (noteErr) {
              erpNoteErrors++;
              console.error('[T3][ERP note error]', o.orderNbr, noteErr?.message || noteErr);
            }
          }
        } catch (erpErr) {
          erpWriteErrors++;
          console.error('[T3][ERP write error]', o.orderNbr, erpErr?.message || erpErr);
        }

        sent++;
      } catch (e) {
        errors++;
        console.error('[T3][send-or-flag error]', o.orderNbr, e?.message || e);
      }
      continue;
    }

    if (threeDaySent && daysOut === 3) {
      alreadySent++;
    } else {
      skippedOutOfWindow++;
    }
  }

  const summary = {
    sent,
    resetFlags,
    skippedNoEmail,
    skippedOutOfWindow,
    alreadySent,
    errors,
    erpWrites,
    erpWriteErrors,
    erpNotes,
    erpNoteErrors,
    skippedNoNoteId,
  };

  console.log('[T3] summary:', JSON.stringify(summary));
  return { ok: true, phase: 'T3', summary };
}
