import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
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
  if (!serviceKey) {
    console.error('SUPABASE_SERVICE_ROLE_KEY is not set');
    return NextResponse.json({ exists: false });
  }

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceKey,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  const { data } = await admin
    .from('profiles')
    .select('id')
    .eq('email', parsed.data.email.toLowerCase())
    .maybeSingle();

  return NextResponse.json({ exists: !!data });
}
