import prisma from '@/lib/prisma/prisma';
import argon2 from 'argon2';
import jwt from 'jsonwebtoken';
import success from '@/lib/auth-helpers/success';
import error from '@/lib/auth-helpers/error';

const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret';

export async function OPTIONS(req) {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "http://localhost:3000", 
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  });
}

export async function POST(req) {
  try {
    const { email, password } = await req.json();

    // 1. Validate input
    if (!email || !password) {
      return error('Missing email or password', 400);
    }

    // 2. Find user and associated accounts
    const user = await prisma.users.findUnique({
      where: { email },
      include: { accounts: true }
    });

    if (!user) return error('Invalid email or password', 401);

    // 3. Make sure email is verified
    if (!user.emailVerified) {
      return error('Please verify your email before logging in.', 403);
    }

    // 4. Find credentials account
    const account = user.accounts.find(acc => acc.providerId === 'credentials');
    if (!account || !account.password) {
      return error('Invalid email or password', 401);
    }

    // 5. Check password
    const valid = await argon2.verify(account.password, password);
    if (!valid) return error('Invalid email or password', 401);

    // 6. Create JWT token
    const token = jwt.sign(
      { userId: user.id, email: user.email, name: user.name },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    // 7. Respond with token and user info
    return success({
      message: 'Login successful!',
      token,
      user: { id: user.id, email: user.email, name: user.name }
    });

  } catch (err) {
    return error(err.message || 'Login failed', 500);
  }
}
