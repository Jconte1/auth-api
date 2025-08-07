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
      return success({ message: 'If this email exists and is verified, you will receive a password reset link.' });
    }

    // 2. Generate secure token
    const token = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 1000 * 60 * 60); // 1 hour

    // 3. Store token in Verification table
    await prisma.verification.create({
      data: {
        identifier: email,
        value: token,
        expiresAt: expires,
        createdAt: new Date(),
        updatedAt: new Date(),
      }
    });

    // 4. Send password reset email
    await sendAuthEmail({
      to: email,
      name: user.name,
      token,
      type: 'reset', // send as a reset email
    });

    // Always return same message for security
    return success({ message: 'If this email exists and is verified, you will receive a password reset link.' });
  } catch (err) {
    return error(err.message || 'Failed to initiate password reset.', 500);
  }
}
