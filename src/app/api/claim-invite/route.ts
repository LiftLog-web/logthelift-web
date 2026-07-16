import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { rateLimit } from '@/lib/rate-limit';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '@/lib/supabase';

export async function POST(req: NextRequest) {
  const token = req.headers.get('Authorization')?.replace('Bearer ', '');
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data: { user } } = await sb.auth.getUser();
  if (!user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const rl = rateLimit(`claim-invite:${user.id}`, 10, 60 * 60 * 1000);
  if (!rl.allowed) return NextResponse.json({ error: 'Too many requests.' }, { status: 429 });

  const sbAdmin = createClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const email = user.email.toLowerCase();
  const now = new Date().toISOString();

  const { data: invite } = await sbAdmin
    .from('invite_codes')
    .select('id, practitioner_id, is_relink')
    .eq('invitee_email', email)
    .is('used_by', null)
    .or(`expires_at.is.null,expires_at.gt.${now}`)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!invite) return NextResponse.json({ linked: false, reason: 'no_invite' });
  if (invite.practitioner_id === user.id) return NextResponse.json({ linked: false, reason: 'self_link' });

  // Always return a consent prompt — the mobile app shows Accept/Deny before linking.
  // accept-relink handles the actual patient_links insert.
  const { data: practProf } = await sbAdmin
    .from('profiles')
    .select('display_name, is_employer')
    .eq('id', invite.practitioner_id)
    .single();

  return NextResponse.json({
    linked: false,
    pendingRelink: true,
    inviteId: invite.id,
    practitionerName: practProf?.display_name ?? null,
    isEmployer: practProf?.is_employer ?? false,
    isRelink: invite.is_relink ?? false,
  });
}
