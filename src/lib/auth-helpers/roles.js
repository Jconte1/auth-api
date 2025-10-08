import prisma from '@/lib/prisma/prisma';

export async function getActiveRolesFor(userId, baid) {
  if (!userId || !baid) return [];
  const rows = await prisma.accountUserRole.findMany({
    where: { userId, baid, isActive: true },
    select: { role: true },
  });
  return rows.map(r => r.role);
}

export async function isAdminForBaid(userId, baid) {
  const roles = await getActiveRolesFor(userId, baid);
  return roles.includes('ADMIN');
}

export async function isPmForBaid(userId, baid) {
  const roles = await getActiveRolesFor(userId, baid);
  return roles.includes('PM');
}
