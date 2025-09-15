import prisma from '@/lib/prisma/prisma';
import crypto from 'crypto';
import success from '@/lib/auth-helpers/success';
import error from '@/lib/auth-helpers/error';
import sendAuthEmail from '@/lib/auth-helpers/email';

export async function POST(req) {
  try {
    const { email } = await req.json();
    if (!email) return error('Missing email.', 400);

    // 1. Find user (case-insensitive, best practice)
    const user = await prisma.user.findUnique({ where: { email } });

    // Security: Always respond with success
    if (!user || !user.emailVerified) {
      return success({ message: 'If the email is valid, you will receive an OTP.' });
    }

    // 2. Generate a random 6-digit OTP (numeric)
    const otp = (Math.floor(100000 + Math.random() * 900000)).toString();

    // 3. Store OTP in Verification table (type: 'reset-otp')
    await prisma.verification.create({
      data: {
        identifier: email,
        value: otp,
        type: 'reset-otp',
        expiresAt: new Date(Date.now() + 1000 * 60 * 10), // 10 minutes
        createdAt: new Date(),
        updatedAt: new Date(),
      }
    });

    // 4. Send email with the OTP (adjust your sendAuthEmail to handle OTP)
    await sendAuthEmail({
      to: email,
      name: user.name,
      token: otp,
      type: 'otp', // New type, you’ll handle this in your email util!
    });

    return success({ message: 'If the email is valid, you will receive an OTP.' });
  } catch (err) {
    return error(err.message || 'Failed to request reset OTP.', 500);
  }
}
