import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { rateLimit, getClientIp } from '@/lib/rate-limit';

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
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!serviceKey || !supabaseUrl) {
    console.error('check-email: missing env vars');
    return NextResponse.json({ exists: false });
  }

  const needle = parsed.data.email.toLowerCase();

  // Use the Supabase Auth Admin REST API directly — more reliable than the JS
  // admin SDK in Next.js server routes and works with the service role key.
  const res = await fetch(`${supabaseUrl}/auth/v1/admin/users?page=1&per_page=1000`, {
    headers: {
      apikey:        serviceKey,
      Authorization: `Bearer ${serviceKey}`,
    },
  });

  if (!res.ok) {
    console.error('check-email: auth admin API error', res.status, await res.text());
    return NextResponse.json({ exists: false });
  }

  const body = await res.json() as { users?: Array<{ email?: string }> };
  const users = body.users ?? [];
  const exists = users.some(u => u.email?.toLowerCase() === needle);
  return NextResponse.json({ exists });
}
