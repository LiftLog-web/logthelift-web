import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import OpenAI from 'openai';
import { rateLimit } from '@/lib/rate-limit';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '@/lib/supabase';

export const maxDuration = 60;

const MASTER_ID = process.env.NEXT_PUBLIC_FEATURED_PRACTITIONER_ID ?? '969ea6c6-ba6d-4ee4-8bb8-a7cee267f40c';
const BUCKET    = 'exercise-illustrations';

const CHARACTER_PROFILES = [
  'a woman with pale peach skin, straight brown hair in a ponytail, wearing a navy blue top and dark grey leggings',
  'a man with warm brown skin, short natural hair, wearing a white polo shirt and black trousers',
  'a woman with deep brown skin, voluminous natural curly hair, wearing a coral pink t-shirt and black leggings',
  'a man with fair freckled skin, short blond hair, wearing a grey t-shirt and navy trousers',
  'a woman with warm olive skin, long straight black hair, wearing a teal top and charcoal leggings',
  'a man with deep ebony skin, very short cropped hair, wearing a light blue shirt and dark trousers',
  'a woman with medium beige skin, short auburn wavy bob, wearing a purple top and black leggings',
  'a man with golden tan skin, curly dark hair, wearing a heather grey t-shirt and khaki trousers',
  'a woman with pale ivory skin, long wavy red hair, wearing a forest green top and dark leggings',
  'a man with caramel brown skin, short neat fade haircut, wearing an orange t-shirt and black joggers',
  'a woman with rich dark brown skin, short natural afro, wearing a yellow top and charcoal leggings',
  'a man with light beige skin, short brown hair, wearing a burgundy polo shirt and grey trousers',
];

function pickProfile(dayId: string): string {
  let hash = 0;
  for (let i = 0; i < dayId.length; i++) {
    hash = Math.imul(31, hash) + dayId.charCodeAt(i) | 0;
  }
  return CHARACTER_PROFILES[Math.abs(hash) % CHARACTER_PROFILES.length];
}

const BodySchema = z.object({
  templateId:        z.string().uuid(),
  exerciseId:        z.string().min(1).max(100),
  exerciseName:      z.string().min(1).max(200),
  dayId:             z.string().min(1).max(100),
  practitionerNotes: z.string().max(1000).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const token = req.headers.get('Authorization')?.replace('Bearer ', '');
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });

    const { data: { user } } = await sb.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    if (user.id !== MASTER_ID) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    // 20/hr to cap AI image costs
    const rl = rateLimit(`gen-illus:${user.id}`, 20, 60 * 60 * 1000);
    if (!rl.allowed) return NextResponse.json({ error: 'Too many requests. Please try again later.' }, { status: 429 });

    const parsed = BodySchema.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });

    const { templateId, exerciseId, exerciseName, dayId, practitionerNotes } = parsed.data;

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const character   = pickProfile(dayId);
    const contextHint = practitionerNotes ? ` Context: ${practitionerNotes.slice(0, 200)}` : '';
    const prompt = `Clean minimal instructional diagram of ${character} performing "${exerciseName}" in a workplace or office setting. Flat vector illustration style, white background, clear body posture demonstrating the exercise movement. The entire figure must be fully visible — full head including top of hair and both feet including soles — with generous empty space above the head and below the feet so nothing is cropped. The person has a calm, natural expression — relaxed and focused, not frowning or sad. All hands must have exactly five natural, anatomically correct fingers — no fused, missing, or distorted fingers. No text labels.${contextHint}`;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const imageRes = await openai.images.generate({ model: 'gpt-image-1', prompt, n: 1, size: '1024x1536', quality: 'medium' } as any) as { data: Array<{ b64_json?: string | null }> };

    const b64 = imageRes.data?.[0]?.b64_json;
    if (!b64) return NextResponse.json({ error: 'Image generation failed.' }, { status: 500 });
    const imgBuffer = Buffer.from(b64, 'base64');

    // Service-role client for storage + DB writes — bypasses RLS safely on the server
    const sbAdmin = createClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY!);

    const safeName    = exerciseName.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 60);
    const storagePath = `${safeName}_${exerciseId}.png`;

    const { error: uploadErr } = await sbAdmin.storage
      .from(BUCKET)
      .upload(storagePath, imgBuffer, { contentType: 'image/png', upsert: true });

    if (uploadErr) return NextResponse.json({ error: 'Storage upload failed.' }, { status: 500 });

    const { data: { publicUrl: _publicUrl } } = sbAdmin.storage.from(BUCKET).getPublicUrl(storagePath);
    // Append a timestamp so every regen bypasses the CDN/browser cache at the same path.
    const publicUrl = `${_publicUrl}?t=${Date.now()}`;

    // Patch the exercise's illustrationUrl inside plan_templates.exercises JSONB
    const { data: tpl } = await sbAdmin
      .from('plan_templates')
      .select('name, exercises, practitioner_id')
      .eq('id', templateId)
      .single();

    if (!tpl) return NextResponse.json({ error: 'Template not found.' }, { status: 404 });

    let patched = false;

    function patchExercises(raw: any): any {
      if (Array.isArray(raw)) {
        return raw.map((e: any) => {
          if (e.id === exerciseId) { patched = true; return { ...e, illustrationUrl: publicUrl }; }
          return e;
        });
      }
      if (raw?.days) {
        return {
          ...raw,
          days: (raw.days as any[]).map((d: any) => ({
            ...d,
            exercises: (d.exercises ?? []).map((e: any) => {
              if (e.id === exerciseId) { patched = true; return { ...e, illustrationUrl: publicUrl }; }
              return e;
            }),
          })),
        };
      }
      return raw;
    }

    const newExercises = patchExercises(tpl.exercises);

    if (!patched) return NextResponse.json({ error: 'Exercise not found in template.' }, { status: 404 });

    const { error: updateErr } = await sbAdmin
      .from('plan_templates')
      .update({ exercises: newExercises })
      .eq('id', templateId);

    if (updateErr) return NextResponse.json({ error: 'Failed to save illustration.' }, { status: 500 });

    // Propagate the updated exercises to all workout_plans copies assigned from this template.
    // workout_plans is a snapshot — we replace its exercises with the freshly patched template
    // exercises directly, avoiding any exercise-id mismatch between the two tables.
    // The web MASTER account and the mobile practitioner account are different Supabase users,
    // so we cannot filter by practitioner_id here. Match by name only; the MASTER_ID gate
    // at the top of this route prevents arbitrary callers from triggering this.
    const { data: assignedPlans, error: wpQueryErr } = await sbAdmin
      .from('workout_plans')
      .select('id')
      .eq('name', tpl.name);

    const wpUpdateErrors: string[] = [];
    if (assignedPlans && assignedPlans.length > 0) {
      await Promise.all(assignedPlans.map(async (wp: any) => {
        const { error: upErr } = await sbAdmin.from('workout_plans').update({ exercises: newExercises }).eq('id', wp.id);
        if (upErr) wpUpdateErrors.push(`${wp.id}: ${upErr.message}`);
      }));
    }

    return NextResponse.json({ url: publicUrl });
  } catch (err: any) {
    console.error('[generate-exercise-image]', err);
    return NextResponse.json({ error: err?.message ?? 'Unexpected server error' }, { status: 500 });
  }
}
