import prisma from '@/lib/prisma/prisma';
import argon2 from 'argon2';
import jwt from 'jsonwebtoken';
import success from '@/lib/auth-helpers/success';
import error from '@/lib/auth-helpers/error';

const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret';

export async function POST(req) {
  try {
    // 1. Get and validate JWT from Authorization header
    const authHeader = req.headers.get('authorization') || '';
    if (!authHeader.startsWith('Bearer ')) {
      return error('Missing or invalid Authorization header', 401);
    }
    const token = authHeader.split(' ')[1];
    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch (err) {
      return error('Invalid or expired token', 401);
    }

    // 2. Get request body
    const { currentPassword, newPassword } = await req.json();
    if (!currentPassword || !newPassword) {
      return error('Missing current or new password.', 400);
    }

    // 3. Find user and their credentials account
    const user = await prisma.users.findUnique({
      where: { id: decoded.userId },
      include: { accounts: true }
    });
    if (!user) return error('User not found', 404);

    const account = user.accounts.find(acc => acc.providerId === 'credentials');
    if (!account || !account.password) {
      return error('No password set for this account.', 400);
    }

    // 4. Verify current password
    const valid = await argon2.verify(account.password, currentPassword);
    if (!valid) {
      return error('Current password is incorrect.', 401);
    }

    // 5. Hash and update new password
    const hashed = await argon2.hash(newPassword);
    await prisma.account.updateMany({
      where: {
        userId: user.id,
        providerId: 'credentials'
      },
      data: {
        password: hashed,
        updatedAt: new Date()
      }
    });

    // 6. Optionally, you could revoke all sessions here for security (not shown)

    // 7. Respond with success
    return success({ message: 'Password changed successfully.' });
  } catch (err) {
    return error(err.message || 'Failed to change password.', 500);
  }
}
