import prisma from '@/lib/prisma/prisma';
import success from '@/lib/auth-helpers/success';
import error from '@/lib/auth-helpers/error';

export async function GET(req) {
  try {
    // Parse search params from URL
    const { searchParams } = new URL(req.url);
    const token = searchParams.get('token');
    const email = searchParams.get('email');

    // 1. Validate query params
    if (!token || !email) {
      return error('Missing token or email in verification link.', 400);
    }

    // 2. Find the verification entry
    const verification = await prisma.verifications.findFirst({
      where: {
        identifier: email,
        value: token,
        expiresAt: { gte: new Date() }, // not expired
      },
    });

    if (!verification) {
      return error('Invalid or expired verification link.', 400);
    }

    // 3. Update the user's emailVerified field
    await prisma.users.update({
      where: { email },
      data: { emailVerified: true, updatedAt: new Date() },
    });

    // 4. Delete the verification token to prevent reuse
    await prisma.verifications.delete({
      where: { id: verification.id },
    });

    // 5. Respond with success
    return success({ message: 'Email successfully verified! You can now log in.' });

  } catch (err) {
    return error(err.message || 'Email verification failed.', 500);
  }
}
