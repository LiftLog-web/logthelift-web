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
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!serviceKey || !supabaseUrl) {
    console.error('check-email: missing env vars');
    return NextResponse.json({ exists: false });
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // RPC function queries auth.users directly with SECURITY DEFINER — reliable
  // regardless of RLS policies. Function must exist in Supabase (see SQL in docs).
  const { data, error } = await admin.rpc('check_email_exists', {
    check_email: parsed.data.email,
  });

  if (error) {
    console.error('check-email rpc error:', error);
    return NextResponse.json({ exists: false });
  }

  return NextResponse.json({ exists: !!data });
}
