import { OAuth2Client } from 'google-auth-library';
import prisma from '@/lib/prisma/prisma';
import jwt from 'jsonwebtoken';
import success from '@/lib/auth-helpers/success';
import error from '@/lib/auth-helpers/error';

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret';

// Google Auth Library client
const oauthClient = new OAuth2Client(GOOGLE_CLIENT_ID);
//
export async function POST(req) {
  try {
    const { idToken } = await req.json();
    if (!idToken) return error('Missing Google ID token.', 400);

    // 1. Verify the Google token
    const ticket = await oauthClient.verifyIdToken({
      idToken,
      audience: GOOGLE_CLIENT_ID
    });
    const payload = ticket.getPayload();

    if (!payload || !payload.email) {
      return error('Invalid Google ID token.', 400);
    }

    const { email, name, sub: googleId, picture } = payload;

    // 2. Find or create user
    let user = await prisma.users.findUnique({ where: { email } });

    if (!user) {
      // Create user and Google account entry
      user = await prisma.users.create({
        data: {
          name: name || '',
          email,
          emailVerified: true, // Google emails are trusted!
          image: picture,
          createdAt: new Date(),
          updatedAt: new Date(),
          accounts: {
            create: {
              accountId: googleId,
              providerId: 'google',
              createdAt: new Date(),
              updatedAt: new Date(),
            }
          }
        },
        include: { accounts: true }
      });
    } else {
      // If user exists but has no Google account, add it
      const hasGoogleAccount = user.accounts?.some(
        (a) => a.providerId === 'google' && a.accountId === googleId
      );
      if (!hasGoogleAccount) {
        await prisma.account.create({
          data: {
            userId: user.id,
            accountId: googleId,
            providerId: 'google',
            createdAt: new Date(),
            updatedAt: new Date(),
          }
        });
      }
    }

    // 3. Issue JWT for this user
    const token = jwt.sign(
      { userId: user.id, email: user.email, name: user.name },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    return success({
      message: 'Login successful!',
      token,
      user: { id: user.id, email: user.email, name: user.name, image: user.image }
    });

  } catch (err) {
    return error(err.message || 'Google sign-in failed', 500);
  }
}
