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
    .select('id, practitioner_id, invitee_email')
    .eq('id', invite_id)
    .is('used_by', null)
    .maybeSingle();

  if (!invite) return NextResponse.json({ linked: false, reason: 'not_found' });

  if (invite.invitee_email?.toLowerCase() !== user.email.toLowerCase()) {
    return NextResponse.json({ error: 'Not authorized.' }, { status: 403 });
  }

  if (invite.practitioner_id === user.id) {
    return NextResponse.json({ linked: false, reason: 'self_link' });
  }

  await sbAdmin.from('invite_codes').update({ used_by: user.id }).eq('id', invite_id);

  const { error: linkError } = await sbAdmin
    .from('patient_links')
    .upsert(
      { practitioner_id: invite.practitioner_id, patient_id: user.id, unlinked_at: null },
      { onConflict: 'practitioner_id,patient_id' }
    );

  if (linkError) {
    return NextResponse.json({ error: 'Failed to create link.' }, { status: 500 });
  }

  await sbAdmin
    .from('workout_plans')
    .update({ hidden_by_patient: false })
    .eq('patient_id', user.id)
    .eq('practitioner_id', invite.practitioner_id);

  const { data: practProf } = await sbAdmin
    .from('profiles')
    .select('display_name, is_employer')
    .eq('id', invite.practitioner_id)
    .single();

  return NextResponse.json({
    linked: true,
    practitionerName: practProf?.display_name ?? null,
    isEmployer: practProf?.is_employer ?? false,
  });
}
