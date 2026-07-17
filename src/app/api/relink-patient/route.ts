import { NextRequest, NextResponse } from 'next/server';
import { Resend } from 'resend';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { rateLimit } from '@/lib/rate-limit';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '@/lib/supabase';

const Schema = z.object({ patient_id: z.string().uuid() });

function generateCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function buildRelinkHtml(practitionerName: string, code: string, patientEmail: string): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0f1117;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:600px;margin:0 auto;padding:40px 24px;">
    <div style="margin-bottom:32px;">
      <span style="color:#5fcfbf;font-size:24px;font-weight:800;letter-spacing:-0.5px;">LiftLog</span>
    </div>
    <div style="background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:16px;padding:36px;">
      <p style="color:rgba(255,255,255,0.5);font-size:13px;margin:0 0 6px;">Re-link request</p>
      <h1 style="color:#fff;font-size:22px;font-weight:700;margin:0 0 20px;">${escapeHtml(practitionerName)} wants to reconnect with you on LiftLog</h1>
      <p style="color:rgba(255,255,255,0.7);font-size:15px;line-height:1.7;margin:0 0 28px;">
        Open the LiftLog app to accept or deny this request. If you accept, <strong style="color:#fff;">${escapeHtml(practitionerName)}</strong> will be able to view your progress and assign you plans again.
      </p>

      <div style="margin-bottom:24px;padding:16px;background:rgba(95,207,191,0.06);border:1px solid rgba(95,207,191,0.15);border-radius:12px;">
        <p style="color:rgba(255,255,255,0.5);font-size:13px;margin:0 0 10px;font-weight:600;">No push notifications? Enter this code manually:</p>
        <p style="color:rgba(255,255,255,0.4);font-size:13px;margin:0 0 12px;">Go to <strong style="color:rgba(255,255,255,0.6);">Connect tab → Link to Practitioner or Employer</strong></p>
        <div style="background:rgba(95,207,191,0.08);border:1px solid rgba(95,207,191,0.2);border-radius:10px;padding:14px;text-align:center;">
          <p style="color:#5fcfbf;font-size:28px;font-weight:800;letter-spacing:5px;margin:0;font-family:'Courier New',monospace;">${escapeHtml(code)}</p>
        </div>
      </div>

      <div style="padding-top:20px;border-top:1px solid rgba(255,255,255,0.08);">
        <p style="color:rgba(255,255,255,0.4);font-size:12px;margin:0;">
          Sent on behalf of <strong style="color:rgba(255,255,255,0.6);">${escapeHtml(practitionerName)}</strong> via LiftLog.
          If you don't recognize this practitioner, you can safely ignore this email.
        </p>
      </div>
    </div>
    <p style="color:rgba(255,255,255,0.2);font-size:12px;text-align:center;margin-top:24px;">
      © ${new Date().getFullYear()} LiftLog · <a href="https://logthelift.ca" style="color:rgba(255,255,255,0.3);">logthelift.ca</a>
    </p>
  </div>
</body>
</html>`;
}

export async function POST(req: NextRequest) {
  if (!process.env.RESEND_API_KEY) {
    return NextResponse.json({ error: 'Email service not configured.' }, { status: 503 });
  }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: 'Server configuration error.' }, { status: 503 });
  }

  const token = req.headers.get('Authorization')?.replace('Bearer ', '');
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: prof } = await sb
    .from('profiles')
    .select('role, display_name')
    .eq('id', user.id)
    .single();

  if (prof?.role !== 'practitioner') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const rl = rateLimit(`relink:${user.id}`, 20, 60 * 60 * 1000);
  if (!rl.allowed) {
    return NextResponse.json({ error: 'Too many requests. Please try again later.' }, { status: 429 });
  }

  let parsed: ReturnType<typeof Schema.safeParse>;
  try {
    parsed = Schema.safeParse(await req.json());
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });

  const { patient_id } = parsed.data;
  if (patient_id === user.id) {
    return NextResponse.json({ error: 'Cannot link to yourself.' }, { status: 400 });
  }

  const sbAdmin = createClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  const { data: patientProfile, error: profileErr } = await sbAdmin
    .from('profiles')
    .select('email, expo_push_token')
    .eq('id', patient_id)
    .single();

  if (!patientProfile?.email) {
    console.error('[relink-patient] patient profile lookup failed:', profileErr, 'patient_id:', patient_id);
    return NextResponse.json({ error: 'Patient not found.' }, { status: 404 });
  }

  const code = generateCode();
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

  const { data: invite, error: codeErr } = await sbAdmin
    .from('invite_codes')
    .insert({ practitioner_id: user.id, code, invitee_email: patientProfile.email, expires_at: expiresAt, is_relink: true })
    .select('id')
    .single();

  if (codeErr || !invite) {
    console.error('[relink-patient] invite_codes insert error:', codeErr);
    return NextResponse.json({ error: 'Could not create invite.' }, { status: 500 });
  }

  const practitionerName = (prof?.display_name as string | null) ?? 'Your practitioner';
  const resend = new Resend(process.env.RESEND_API_KEY);

  await resend.emails.send({
    from: 'LiftLog <noreply@logthelift.ca>',
    to: [patientProfile.email],
    subject: `${practitionerName} wants to reconnect with you on LiftLog`,
    html: buildRelinkHtml(practitionerName, code, patientProfile.email),
  });

  if (patientProfile.expo_push_token) {
    await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to: patientProfile.expo_push_token,
        sound: 'default',
        title: 'Re-link Request',
        body: `${practitionerName} wants to reconnect with you in LiftLog.`,
        data: { type: 'relink_request', invite_id: invite.id, practitioner_name: practitionerName },
      }),
    }).catch(() => {}); // push failure is non-fatal — email is the fallback
  }

  return NextResponse.json({ ok: true });
}
