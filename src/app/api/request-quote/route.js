// app/api/request-quote/route.js

import prisma from '@/lib/prisma/prisma';
import success from '@/lib/auth-helpers/success';
import error from '@/lib/auth-helpers/error';
import sendAuthEmail from '@/lib/auth-helpers/email';

// --- Simple in-memory rate limit (same idea as your register route) ---
const ipHits = new Map();
function rateLimit(req, limit = 10, windowMs = 60_000) {
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'unknown';
  const now = Date.now();
  const bucket = (ipHits.get(ip) || []).filter((t) => now - t < windowMs);
  bucket.push(now);
  ipHits.set(ip, bucket);
  return bucket.length <= limit;
}

// --- reCAPTCHA v3 verification helper ---
async function verifyRecaptcha(token) {
  try {
    if (!token) {
      console.warn('reCAPTCHA: missing token');
      return false;
    }

    const secret = process.env.RECAPTCHA_SECRET_KEY;
    if (!secret) {
      console.warn('reCAPTCHA: RECAPTCHA_SECRET_KEY is not set');
      return false;
    }

    const params = new URLSearchParams();
    params.append('secret', secret);
    params.append('response', token);

    const res = await fetch(
      'https://www.google.com/recaptcha/api/siteverify',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params.toString(),
      }
    );

    if (!res.ok) {
      console.error(
        'reCAPTCHA verify HTTP error:',
        res.status,
        res.statusText
      );
      return false;
    }

    const data = await res.json();
    console.log('reCAPTCHA verify response:', data);

    if (!data.success) {
      console.warn('reCAPTCHA error codes:', data['error-codes']);
      return false;
    }

    return true;
  } catch (err) {
    console.error('reCAPTCHA verify error:', err);
    return false;
  }
}

// --- Build minimal cart payload for DB (price, modelNumber, quantity, imageUrl, description) ---
function buildCartSnapshot(cartItems = []) {
  return cartItems.map((item) => {
    const p = item.product || {};

    // 1) SKU
    const modelNumber =
      p.modelNumber ??
      p.product?.modelNumber ??
      p.data?.modelNumber ??
      null;

    const acumaticaSku =
    p.acumaticaSku ??
      p.product?.acumaticaSku ??
      p.data?.acumaticaSku ??
      null;

    // 2) Description / label for email
    const description =
      p.description ||
      p.name ||
      [p.product?.brand, p.modelNumber, p.product?.minor]
        .filter(Boolean)
        .join(' · ') ||
      'Item';

    // 3) Image URL – match CartItemView / ProductImages path
    const imagesFromProduct =
      p.product?.data?.media?.images?.image ??
      p.data?.media?.images?.image ??
      [];

    let imageUrl = null;
    if (Array.isArray(imagesFromProduct) && imagesFromProduct.length > 0) {
      const first = imagesFromProduct[0];
      imageUrl =
        first?.full_size_url ||
        first?.thumbnail_url ||
        first?.url ||
        null;
    }

    // still allow any direct imageUrl fields as a fallback
    if (!imageUrl) {
      imageUrl =
        p.imageURL ||
        p.imageUrl ||
        p.thumbnailUrl ||
        null;
    }

    // 4) Price
    const rawPrice = p.price;
    const numericPrice =
      typeof rawPrice === 'number' ? rawPrice : Number(rawPrice);
    const price = Number.isFinite(numericPrice) ? numericPrice : null;

    // 5) Quantity
    const rawQty = Number(item.quantity ?? 1);
    const quantity = Number.isFinite(rawQty) ? rawQty : 1;

    return {
      modelNumber,
      acumaticaSku,
      price,
      quantity,
      description,
      imageUrl,
    };
  });
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': 'https://mld-website-git-closeout-store-jconte1s-projects.vercel.app',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}

export async function POST(req) {
  try {
    // 1) Rate limit
    if (!rateLimit(req)) {
      return error('Too many requests', 429);
    }

    const body = await req.json();
    const { recaptchaToken, contact, cartItems } = body || {};

    // 2) Verify reCAPTCHA
    const recaptchaOk = await verifyRecaptcha(recaptchaToken);
    if (!recaptchaOk) {
      return error('reCAPTCHA verification failed', 400);
    }

    // 3) Basic validation
    if (!contact || typeof contact !== 'object') {
      return error('Missing contact information', 400);
    }

    const {
      firstName,
      lastName,
      company,
      email,
      phone,
      address,
      notes,
    } = contact;

    if (!firstName || !lastName) {
      return error('First and last name are required', 400);
    }

    if (!email || typeof email !== 'string') {
      return error('Valid email is required', 400);
    }

    const normalizedEmail = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      return error('Invalid email', 400);
    }

    if (!phone || typeof phone !== 'string') {
      return error('Phone is required', 400);
    }

    if (!address || typeof address !== 'object') {
      return error('Address is required', 400);
    }

    const { line1, line2, city, state, zip } = address;

    if (!line1 || !city || !state || !zip) {
      return error(
        'Address line 1, city, state, and zip are required',
        400
      );
    }

    if (!Array.isArray(cartItems) || cartItems.length === 0) {
      return error('Cart items are required', 400);
    }

    // 🔎 Build minimal cart snapshot (only what we care about)
    const cartSnapshot = buildCartSnapshot(cartItems);

    // 4) Create QuoteRequest in DB
    const quote = await prisma.quoteRequest.create({
      data: {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        company: company?.trim() || null,
        email: normalizedEmail,
        phone: phone.trim(),
        address1: line1.trim(),
        address2: line2?.trim() || null,
        city: city.trim(),
        state: state.trim(),
        zip: String(zip).trim(),
        notes: notes?.trim() || null,
        cart: cartSnapshot,
        status: 'confirmed',
      },
    });

    // Build shipping info for the email
    const shipping = {
      name: `${firstName} ${lastName}`.trim(),
      line1: line1.trim(),
      line2: line2?.trim() || null,
      city: city.trim(),
      state: state.trim(),
      zip: String(zip).trim(),
    };

    // 5) Send RFQ summary email immediately (no magic link)
    try {
      const info = await sendAuthEmail({
        to: normalizedEmail,
        name: `${firstName} ${lastName}`.trim(),
        type: 'rfq-summary',
        quoteId: quote.id,
        cart: cartSnapshot,
        shipping,
      });

      console.log('RFQ summary email sent:', {
        messageId: info?.messageId,
        accepted: info?.accepted,
        rejected: info?.rejected,
        response: info?.response,
      });
    } catch (emailErr) {
      console.error('RFQ summary email FAILED:', emailErr);
      return error('Quote saved but summary email could not be sent.', 500);
    }

    // 6) Respond WITH quoteId so frontend can redirect
    return success(
      {
        message:
          'Quote request received. A summary has been emailed to you.',
        quoteId: quote.id,
      },
      201
    );
  } catch (err) {
    console.error('RFQ submit error:', err);
    return error('Failed to submit quote request', 500);
  }
}
