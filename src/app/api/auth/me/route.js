import jwt from 'jsonwebtoken';
import prisma from '@/lib/prisma/prisma';
import success from '@/lib/auth-helpers/success';
import error from '@/lib/auth-helpers/error';

const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret';

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

export async function GET(req) {
  try {
    // 1. Check Authorization header for Bearer token
    const authHeader = req.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return error('Missing or invalid Authorization header', 401);
    }
    const token = authHeader.split(' ')[1];

    // 2. Verify JWT
    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch (err) {
      return error('Invalid or expired token', 401);
    }

    // 3. Find user in database
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: { id: true, email: true, name: true, image: true, emailVerified: true }
    });
    if (!user) return error('User not found', 404);

    // 4. Return user info (never return sensitive fields!)
    return success({ user });

  } catch (err) {
    return error(err.message || 'Failed to get user info', 500);
  }
}
