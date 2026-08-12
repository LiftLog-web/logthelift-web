import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '@/lib/supabase';

const Schema = z.object({ practitioner_id: z.string().uuid() });

export async function POST(req: NextRequest) {
  const token = req.headers.get('Authorization')?.replace('Bearer ', '');
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data: { user } } = await sb.auth.getUser();
  if (!user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let parsed: ReturnType<typeof Schema.safeParse>;
  try {
    parsed = Schema.safeParse(await req.json());
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });

  const { practitioner_id } = parsed.data;

  if (practitioner_id === user.id) {
    return NextResponse.json({ error: 'Cannot unlink from yourself.' }, { status: 400 });
  }

  const sbAdmin = createClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  const { data: link } = await sbAdmin
    .from('patient_links')
    .select('id')
    .eq('patient_id', user.id)
    .eq('practitioner_id', practitioner_id)
    .is('unlinked_at', null)
    .maybeSingle();

  if (!link) return NextResponse.json({ ok: true });

  const { error } = await sbAdmin
    .from('patient_links')
    .update({ unlinked_at: new Date().toISOString() })
    .eq('patient_id', user.id)
    .eq('practitioner_id', practitioner_id)
    .is('unlinked_at', null);

  if (error) return NextResponse.json({ error: 'Failed to unlink.' }, { status: 500 });

  await sbAdmin
    .from('workout_plans')
    .update({ hidden_by_patient: true })
    .eq('patient_id', user.id)
    .eq('practitioner_id', practitioner_id);

  return NextResponse.json({ ok: true });
}
