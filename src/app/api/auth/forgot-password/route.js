import prisma from '@/lib/prisma';
import crypto from 'crypto';
import success from '@/lib/success';
import error from '@/lib/error';
import sendAuthEmail from '@/lib/email';

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
    const { email } = await req.json();
    if (!email) return error('Missing email.', 400);

    // 1. Find user (case-insensitive, best practice)
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !user.emailVerified) {
      // Always respond with success to avoid email enumeration
      return success({ message: 'If this email exists and is verified, you will receive a one-time password.' });
    }

    // 2. Generate a secure 6-digit numeric OTP (or 6-character alphanumeric if you want)
    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    // 3. Set expiration (10 minutes)
    const expires = new Date(Date.now() + 1000 * 60 * 10);

    // 4. Store OTP in Verification table
    await prisma.verification.create({
      data: {
        identifier: email,
        value: otp,
        expiresAt: expires,
        createdAt: new Date(),
        updatedAt: new Date(),
      }
    });

    // 5. Send the OTP email
    await sendAuthEmail({
      to: email,
      name: user.name,
      token: otp,
      type: 'otp',
    });

    // Always return same message for security
    return success({ message: 'If this email exists and is verified, you will receive a one-time password.' });

  } catch (err) {
    return error(err.message || 'Failed to initiate password reset.', 500);
  }
}
