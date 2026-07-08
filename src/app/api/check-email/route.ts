import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { rateLimit, getClientIp } from '@/lib/rate-limit';
import { SUPABASE_URL } from '@/lib/supabase';

const Schema = z.object({ email: z.string().email().max(254) });

export async function POST(req: NextRequest) {
  const rl = rateLimit(`check-email:${getClientIp(req)}`, 10, 60 * 60 * 1000);
  if (!rl.allowed) {
    return NextResponse.json({ error: 'Too many requests.' }, { status: 429 });
  }

  const parsed = Schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  }

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    console.error('check-email: SUPABASE_SERVICE_ROLE_KEY not set');
    return NextResponse.json({ exists: false });
  }

  // Call the check_email_exists RPC directly via REST — no SDK, no env var for URL.
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/check_email_exists`, {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'apikey':        serviceKey,
      'Authorization': `Bearer ${serviceKey}`,
    },
    body: JSON.stringify({ check_email: parsed.data.email }),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error('check-email rpc fetch error:', res.status, text);
    return NextResponse.json({ exists: false });
  }

  const exists = await res.json() as boolean;
  return NextResponse.json({ exists: !!exists });
}
