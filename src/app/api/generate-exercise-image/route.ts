import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import OpenAI from 'openai';
import { rateLimit } from '@/lib/rate-limit';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '@/lib/supabase';

export const maxDuration = 60;

const MASTER_ID = process.env.NEXT_PUBLIC_FEATURED_PRACTITIONER_ID ?? '969ea6c6-ba6d-4ee4-8bb8-a7cee267f40c';
const BUCKET    = 'exercise-illustrations';

const BodySchema = z.object({
  templateId:        z.string().uuid(),
  exerciseId:        z.string().min(1).max(100),
  exerciseName:      z.string().min(1).max(200),
  practitionerNotes: z.string().max(1000).optional(),
});

export async function POST(req: NextRequest) {
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

  const { templateId, exerciseId, exerciseName, practitionerNotes } = parsed.data;

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const contextHint = practitionerNotes ? ` Context: ${practitionerNotes.slice(0, 200)}` : '';
  const prompt = `Clean minimal instructional diagram of a person performing "${exerciseName}" in a workplace or office setting. Flat vector illustration style, white background, clear body posture demonstrating the exercise movement. No text labels.${contextHint}`;

  const imageRes = await openai.images.generate({
    model:   'dall-e-3',
    prompt,
    n:       1,
    size:    '1024x1024',
    quality: 'standard',
  });

  const imageUrl = imageRes.data?.[0]?.url;
  if (!imageUrl) return NextResponse.json({ error: 'Image generation failed.' }, { status: 500 });

  // Download bytes from OpenAI's temporary CDN URL (not user-supplied)
  const imgFetch = await fetch(imageUrl);
  if (!imgFetch.ok) return NextResponse.json({ error: 'Failed to download generated image.' }, { status: 500 });
  const imgBuffer = Buffer.from(await imgFetch.arrayBuffer());

  // Service-role client for storage + DB writes — bypasses RLS safely on the server
  const sbAdmin = createClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  const safeName    = exerciseName.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 60);
  const storagePath = `${safeName}_${exerciseId}.png`;

  const { error: uploadErr } = await sbAdmin.storage
    .from(BUCKET)
    .upload(storagePath, imgBuffer, { contentType: 'image/png', upsert: true });

  if (uploadErr) return NextResponse.json({ error: 'Storage upload failed.' }, { status: 500 });

  const { data: { publicUrl } } = sbAdmin.storage.from(BUCKET).getPublicUrl(storagePath);

  // Patch the exercise's illustrationUrl inside plan_templates.exercises JSONB
  const { data: tpl } = await sbAdmin
    .from('plan_templates')
    .select('exercises')
    .eq('id', templateId)
    .single();

  if (!tpl) return NextResponse.json({ error: 'Template not found.' }, { status: 404 });

  let patched = false;

  function patchList(list: any[]): any[] {
    return list.map((e: any) => {
      if (e.id === exerciseId) { patched = true; return { ...e, illustrationUrl: publicUrl }; }
      return e;
    });
  }

  const raw = tpl.exercises;
  let newExercises: any;

  if (Array.isArray(raw)) {
    newExercises = patchList(raw);
  } else if (raw?.days) {
    newExercises = {
      ...raw,
      days: (raw.days as any[]).map((d: any) => ({ ...d, exercises: patchList(d.exercises ?? []) })),
    };
  } else {
    newExercises = raw;
  }

  if (!patched) return NextResponse.json({ error: 'Exercise not found in template.' }, { status: 404 });

  const { error: updateErr } = await sbAdmin
    .from('plan_templates')
    .update({ exercises: newExercises })
    .eq('id', templateId);

  if (updateErr) return NextResponse.json({ error: 'Failed to save illustration.' }, { status: 500 });

  return NextResponse.json({ url: publicUrl });
}
