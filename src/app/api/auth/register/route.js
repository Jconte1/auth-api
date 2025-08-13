import prisma from '@/lib/prisma';
import argon2 from 'argon2';
import crypto from 'crypto';
import success from '@/lib/success';
import error from '@/lib/error';
import sendAuthEmail from '@/lib/email';
import zxcvbn from 'zxcvbn';

// --- Simple in-memory rate limit (replace with Redis/Upstash in prod) ---
const ipHits = new Map();
function rateLimit(req, limit = 10, windowMs = 60_000) {
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
    'unknown';
  const now = Date.now();
  const bucket = (ipHits.get(ip) || []).filter(t => now - t < windowMs);
  bucket.push(now);
  ipHits.set(ip, bucket);
  return bucket.length <= limit;
}

// HIBP k-anonymity check — only send SHA-1 prefix
async function pwnedCount(password) {
  const sha1 = crypto.createHash('sha1').update(password, 'utf8').digest('hex').toUpperCase();
  const prefix = sha1.slice(0, 5);
  const suffix = sha1.slice(5);
  const res = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
    headers: { 'User-Agent': 'mld-app/1.0' },
    // Optional: cache headers if your platform supports it
  });
  if (!res.ok) return 0;
  const text = await res.text();
  const line = text.split('\n').find(l => l.startsWith(suffix));
  if (!line) return 0;
  const count = parseInt(line.split(':')[1], 10);
  return Number.isFinite(count) ? count : 0;
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': process.env.FRONTEND_URL || 'http://localhost:3000',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}

export async function POST(req) {
  try {
    // Rate limit
    if (!rateLimit(req)) {
      return error('Too many requests', 429);
    }

    const body = await req.json();
    const { name, email, password } = body || {};

    // 1) Validate presence and basic shapes (do not trim password)
    if (typeof name !== 'string' || typeof email !== 'string' || typeof password !== 'string') {
      return error('Missing name, email, or password', 400);
    }
    const normalizedName = name.trim();
    const normalizedEmail = email.trim().toLowerCase();

    if (!normalizedName) return error('Name is required', 400);
    // Basic email shape check (DB will enforce unique)
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      return error('Invalid email', 400);
    }

    // Password length: NIST min ≥ 8; allow long but cap server memory
    if (password.length < 8) {
      return error('Password must be at least 8 characters', 400);
    }
    if (password.length > 1024) {
      return error('Password is too long', 400);
    }

    // 2) Strength check (zxcvbn): require score ≥ 3
    const { score } = zxcvbn(password);
    if (score < 3) {
      return error('Password too weak. Use a longer passphrase (3+ random words).', 400);
    }

    // 3) Breach check (HIBP)
    const breachedCount = await pwnedCount(password);
    if (breachedCount > 0) {
      return error('This password appears in known breaches. Choose another.', 400);
    }

    // 4) Check if user already exists (normalized email)
    const exists = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (exists) return error('Email already registered', 409);

    // 5) Hash password — argon2id with explicit params
    const hashed = await argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: 19456, // ~19MB
      timeCost: 2,
      parallelism: 1,
    });

    // 6) Create user and credentials account (transactional)
    const user = await prisma.user.create({
      data: {
        name: normalizedName,
        email: normalizedEmail,
        emailVerified: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        accounts: {
          create: {
            accountId: normalizedEmail,
            providerId: 'credentials',
            password: hashed,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        },
      },
      include: { accounts: true },
    });

    // 7) Generate verification token
    const token = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 1000 * 60 * 60 * 24); // 24h

    await prisma.verification.create({
      data: {
        identifier: normalizedEmail,
        value: token,
        expiresAt: expires,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });

    // 8) Send verification email
    await sendAuthEmail({
      to: normalizedEmail,
      name: normalizedName,
      token,
      type: 'verify',
    });

    // 9) Success (neutral response)
    return success(
      {
        message: 'Registration successful. Please verify your email.',
        user: { id: user.id, email: user.email, name: user.name },
      },
      201
    );
  } catch (err) {
    console.error('Registration error:', err);
    return error('Registration failed', 500);
  }
}
