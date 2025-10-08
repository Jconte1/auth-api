// backend: src/services/assignment/deriveOrderPmAssignment.js
import prisma from "@/lib/prisma/prisma";

export default async function deriveOrderPmAssignment(orderSummaryId) {
  // load the order + its contact
  const order = await prisma.erpOrderSummary.findUnique({
    where: { id: orderSummaryId },
    include: { contact: true },
  });
  if (!order) return { ok: false, reason: 'ORDER_NOT_FOUND' };

  // PM email is required in ERP and lives at ErpOrderContact.deliveryEmail
  const email = (order.contact?.deliveryEmail || '').toLowerCase().trim();
  if (!email) return { ok: false, reason: 'NO_PM_EMAIL' };

  // find matching app user by email
  const user = await prisma.users.findFirst({
    where: { email },
    select: { id: true, email: true },
  });
  if (!user) return { ok: false, reason: 'NO_MATCHING_USER', candidates: [email] };

  // check if an active PM assignment already exists
  const existing = await prisma.orderAssignment.findFirst({
    where: { orderSummaryId, userId: user.id, role: 'PM', isActive: true },
    select: { id: true },
  });

  if (existing) {
    // keep it active; nothing else to do
    return { ok: true, assignedUserId: user.id, email: user.email, existed: true };
  }

  // create new PM assignment
  await prisma.orderAssignment.create({
    data: {
      orderSummaryId,
      userId: user.id,
      role: 'PM',
      source: 'acumatica',
      isActive: true,
    },
  });

  return { ok: true, assignedUserId: user.id, email: user.email, created: true };
}
