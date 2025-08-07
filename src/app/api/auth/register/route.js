import prisma from '@/lib/prisma';
import argon2 from 'argon2';
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
    const body = await req.json();
    const { name, email, password } = body;

    // 1. Validate input
    if (!name || !email || !password) {
      return error('Missing name, email, or password', 400);
    }

    // 2. Check if user already exists
    const exists = await prisma.user.findUnique({ where: { email } });
    if (exists) return error('Email already registered', 409);

    // 3. Hash password
    const hashed = await argon2.hash(password);

    // 4. Create user and account (transactional)
    const user = await prisma.user.create({
      data: {
        name,
        email,
        emailVerified: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        accounts: {
          create: {
            accountId: email,
            providerId: 'credentials',
            password: hashed,
            createdAt: new Date(),
            updatedAt: new Date(),
          }
        }
      },
      include: { accounts: true }
    });

    // 5. Generate a secure random token
    const token = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 1000 * 60 * 60 * 24); // 24 hours

    // 6. Store token in Verification table
    await prisma.verification.create({
      data: {
        identifier: email,
        value: token,
        expiresAt: expires,
        createdAt: new Date(),
        updatedAt: new Date(),
      }
    });

    // 7. Send the verification email
    await sendAuthEmail({
      to: email,
      name,
      token,
      type: 'verify',
    });

    // 8. Return success
    return success({
      message: 'Registration successful. Please verify your email.',
      user: { id: user.id, email: user.email, name: user.name }
    }, 201);

  } catch (err) {
    return error(err.message || 'Registration failed', 500);
  }
}
