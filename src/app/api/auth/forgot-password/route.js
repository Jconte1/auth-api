// src/app/api/auth/forgot-password/route.js (App Router style)
import prisma from '@/lib/prisma/prisma';
import crypto from 'crypto';
import argon2 from 'argon2';
import success from '@/lib/auth-helpers/success';
import error from '@/lib/auth-helpers/error';
import sendAuthEmail from '@/lib/auth-helpers/email';

const TYPE = 'PASSWORD_RESET_OTP';

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': process.env.FRONTEND_URL || 'http://localhost:3000',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Vary': 'Origin',
    },
  });
}

export async function POST(req) {
  try {
    const { email } = await req.json();
    const emailNorm = (email || '').trim().toLowerCase();
    if (!emailNorm) return error('Missing email.', 400);

    // Find user (assuming emails are stored normalized to lowercase)
    const user = await prisma.user.findUnique({ where: { email: emailNorm } });

    // Always respond the same to avoid enumeration
    if (!user || !user.emailVerified) {
      return success({ message: 'If this email exists and is verified, you will receive a one-time password.' });
    }

    // Generate crypto-safe 6-digit OTP
    const otp = crypto.randomInt(0, 1e6).toString().padStart(6, '0');

    // Hash OTP before storing
    const otpHash = await argon2.hash(otp, { type: argon2.argon2id });

    // 10-minute expiry
    const expires = new Date(Date.now() + 10 * 60 * 1000);

    // Replace any existing active tokens for this identifier+type
    await prisma.$transaction([
      prisma.verification.deleteMany({ where: { identifier: emailNorm} }), // add "type: TYPE " after adding to schema
      prisma.verification.create({
        data: {
          identifier: emailNorm,
          // type: TYPE,
          value: otpHash,        // store HASH, not the OTP itself
          expiresAt: expires,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      }),
    ]);

    // Send the *plain* OTP to the user
    await sendAuthEmail({
      to: emailNorm,
      name: user.name,
      token: otp,
      type: 'otp',
    });

    return success({ message: 'If this email exists and is verified, you will receive a one-time password.' });
  } catch (err) {
    return error(err.message || 'Failed to initiate password reset.', 500);
  }
}
