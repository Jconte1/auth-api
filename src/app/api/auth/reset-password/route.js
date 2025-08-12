import prisma from '@/lib/prisma';
import argon2 from 'argon2';
import success from '@/lib/success';
import error from '@/lib/error';

export async function POST(req) {
  try {
    const { email, otp, newPassword, confirmPassword } = await req.json();

    // 1. Basic validation
    if (!email || !otp || !newPassword || !confirmPassword) {
      return error('Missing required fields.', 400);
    }
    if (newPassword !== confirmPassword) {
      return error('Passwords do not match.', 400);
    }
    if (newPassword.length < 8) {
      // Adjust minimum length/strength as you wish
      return error('Password must be at least 8 characters.', 400);
    }

    // 2. Find valid OTP in verification table
    const verification = await prisma.verification.findFirst({
      where: {
        identifier: email,
        value: otp,
        expiresAt: { gte: new Date() },
      }
    });
    if (!verification) {
      return error('Invalid or expired one-time password.', 400);
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

    // 6. Delete OTP (one-time use)
    await prisma.verification.delete({
      where: { id: verification.id }
    });

    // 7. Respond with success
    return success({ message: 'Password reset successful! You can now log in with your new password.' });

  } catch (err) {
    return error(err.message || 'Failed to reset password.', 500);
  }
}
