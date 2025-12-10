import prisma from '@/lib/prisma/prisma';

export async function GET(req, context) {
  // ✅ Await params properly per Next.js 14 requirement
  const { id } = await context.params;

  if (!id || typeof id !== 'string') {
    return new Response(
      JSON.stringify({ error: 'Missing or invalid quote id' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  try {
    const quote = await prisma.quoteRequest.findUnique({
      where: { id },
    });

    if (!quote) {
      return new Response(
        JSON.stringify({ error: 'Quote not found' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    return new Response(JSON.stringify({ quote }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*', // ✅ Helps cross-origin fetch
      },
    });
  } catch (err) {
    console.error('Error fetching quote:', err);
    return new Response(
      JSON.stringify({ error: 'Failed to fetch quote' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
