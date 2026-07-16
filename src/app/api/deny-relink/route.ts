import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '@/lib/supabase';

const Schema = z.object({ invite_id: z.string().uuid() });

export async function POST(req: NextRequest) {
  const token = req.headers.get('Authorization')?.replace('Bearer ', '');
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data: { user } } = await sb.auth.getUser();
  if (!user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let parsed: ReturnType<typeof Schema.safeParse>;
  try {
    parsed = Schema.safeParse(await req.json());
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });

  const { invite_id } = parsed.data;
  const sbAdmin = createClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  const { data: invite } = await sbAdmin
    .from('invite_codes')
    .select('id, invitee_email')
    .eq('id', invite_id)
    .is('used_by', null)
    .maybeSingle();

  // Not found or already used — idempotent success
  if (!invite) return NextResponse.json({ ok: true });

  // Only the intended recipient can deny the invite
  if (invite.invitee_email?.toLowerCase() !== user.email.toLowerCase()) {
    return NextResponse.json({ error: 'Not authorized.' }, { status: 403 });
  }

  await sbAdmin.from('invite_codes').delete().eq('id', invite_id);

  return NextResponse.json({ ok: true });
}
