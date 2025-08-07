import prisma from '@/lib/prisma';
import argon2 from 'argon2';
import success from '@/lib/success';
import error from '@/lib/error';

export async function POST(req) {
  try {
    const { email, token, newPassword } = await req.json();

    // 1. Basic validation
    if (!email || !token || !newPassword) {
      return error('Missing email, token, or new password.', 400);
    }

    // 2. Find matching verification token
    const verification = await prisma.verification.findFirst({
      where: {
        identifier: email,
        value: token,
        expiresAt: { gte: new Date() }
      }
    });
    if (!verification) {
      return error('Invalid or expired verification link.', 400);
    }

    // 3. Find user
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return error('User not found.', 404);

    // 4. Hash new password
    const hashed = await argon2.hash(newPassword);

    // 5. Update password in Account table (credentials provider)
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

    // 6. Delete verification token (one-time use)
    await prisma.verification.delete({
      where: { id: verification.id }
    });

    // 7. Respond with success
    return success({ message: 'Password reset successful! You can now log in with your new password.' });

  } catch (err) {
    return error(err.message || 'Failed to reset password.', 500);
  }
}
