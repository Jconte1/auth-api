import prisma from '@/lib/prisma/prisma';
import argon2 from 'argon2';
import success from '@/lib/auth-helpers/success';
import error from '@/lib/auth-helpers/error';

export async function OPTIONS(req) {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": process.env.FRONTEND_URL || "http://localhost:3000",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  });
}

export async function POST(req) {
  try {
    const body = await req.json();

    // Accept either `otp` or `token` (your front-end sends `token`)
    const email = (body.email || '').trim().toLowerCase();
    const otp   = (body.otp || body.token || '').trim();
    const newPassword = body.newPassword;
    // Frontend already checks confirm; accept optional confirm to be flexible
    const confirmPassword = body.confirmPassword ?? body.newPassword;

    // 1) Basic validation
    if (!email || !otp || !newPassword || !confirmPassword) {
      return error('Missing required fields.', 400);
    }
    if (newPassword !== confirmPassword) {
      return error('Passwords do not match.', 400);
    }
    if (newPassword.length < 8) {
      return error('Password must be at least 8 characters.', 400);
    }

    // 2) Find a still-valid verification row
    const verification = await prisma.verifications.findFirst({
      where: {
        identifier: email,
        expiresAt: { gte: new Date() },
      },
      orderBy: { expiresAt: 'desc' },
    });
    if (!verification) {
      return error('Invalid or expired one-time password.', 400);
    }

    // IMPORTANT: you stored a HASH of the OTP in `value`, so verify it:
    const ok = await argon2.verify(verification.value, otp);
    if (!ok) {
      return error('Invalid or expired one-time password.', 400);
    }

    // 3) Find user
    const user = await prisma.users.findUnique({ where: { email } });
    if (!user) return error('User not found.', 404);

    // 4) Hash new password
    const hashed = await argon2.hash(newPassword);

    // 5) Update credentials (adjust these fields to your actual Account model)
    await prisma.account.updateMany({
      where: { userId: user.id, providerId: 'credentials' },
      data: { password: hashed, updatedAt: new Date() },
    });

    // 6) Delete the used OTP
    await prisma.verifications.delete({ where: { id: verification.id } });

    // 7) Done
    return success({ message: 'Password reset successful! You can now log in with your new password.' });
  } catch (err) {
    return error(err.message || 'Failed to reset password.', 500);
  }
}
