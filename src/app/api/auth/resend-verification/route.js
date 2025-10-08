import prisma from '@/lib/prisma/prisma';
import crypto from 'crypto';
import success from '@/lib/auth-helpers/success';
import error from '@/lib/auth-helpers/error';
import sendAuthEmail from '@/lib/auth-helpers/email';

export async function POST(req) {
  try {
    const { email } = await req.json();
    if (!email) return error('Missing email', 400);

    // 1. Find user
    const user = await prisma.users.findUnique({ where: { email } });
    if (!user) return error('No account with that email', 404);

    // 2. If already verified, no need to resend
    if (user.emailVerified) {
      return error('Email is already verified. Please log in.', 400);
    }

    // 3. Generate new verification token (or reuse old unexpired one)
    let verification = await prisma.verifications.findFirst({
      where: {
        identifier: email,
        expiresAt: { gte: new Date() }, // not expired
      }
    });

    let token;
    if (verification) {
      token = verification.value;
    } else {
      token = crypto.randomBytes(32).toString('hex');
      await prisma.verifications.create({
        data: {
          identifier: email,
          value: token,
          expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24), // 24 hours
          createdAt: new Date(),
          updatedAt: new Date(),
        }
      });
    }

    // 4. Send the verification email again
    await sendAuthEmail({
      to: email,
      name: user.name,
      token,
      type: 'verify', // explicitly as verification
    });

    return success({ message: 'Verification email resent. Please check your inbox.' });

  } catch (err) {
    return error(err.message || 'Could not resend verification email.', 500);
  }
}
