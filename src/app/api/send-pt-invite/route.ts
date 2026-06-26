import { NextRequest, NextResponse } from 'next/server';
import { Resend } from 'resend';
import { createClient } from '@supabase/supabase-js';
import { rateLimit } from '@/lib/rate-limit';

const SUPABASE_URL      = 'https://oiugmbbqigzswlndaidd.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_VX7YM-ESx-wpF77a1AkMqA_oRXXAuyM';

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function buildPTInviteHtml(gymName: string, ptName: string): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0f1117;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:600px;margin:0 auto;padding:40px 24px;">
    <div style="margin-bottom:32px;">
      <span style="color:#5fcfbf;font-size:24px;font-weight:800;letter-spacing:-0.5px;">LiftLog</span>
    </div>
    <div style="background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:16px;padding:36px;">
      <p style="color:rgba(255,255,255,0.5);font-size:13px;margin:0 0 6px;">PT Invitation</p>
      <h1 style="color:#fff;font-size:22px;font-weight:700;margin:0 0 20px;">
        ${escapeHtml(gymName)} has invited you to join as a PT on LiftLog
      </h1>
      ${ptName ? `<p style="color:rgba(255,255,255,0.6);font-size:14px;margin:0 0 16px;">Hi ${escapeHtml(ptName)},</p>` : ''}
      <p style="color:rgba(255,255,255,0.7);font-size:15px;line-height:1.7;margin:0 0 28px;">
        <strong style="color:#5fcfbf;">${escapeHtml(gymName)}</strong> would like you to join their team as a Personal Trainer on LiftLog — the platform for managing client workout plans and tracking progress.
      </p>

      <p style="color:rgba(255,255,255,0.6);font-size:14px;font-weight:600;margin:0 0 12px;">How to get started:</p>
      <ol style="color:rgba(255,255,255,0.7);font-size:14px;line-height:2.2;margin:0 0 28px;padding-left:20px;">
        <li>Download <strong style="color:#fff;">LiftLog</strong> from the App Store or Google Play</li>
        <li>Create your account and select <strong style="color:#fff;">Practitioner</strong> as your role</li>
        <li>Contact <strong style="color:#fff;">${escapeHtml(gymName)}</strong> to be linked to their gym on the platform</li>
      </ol>

      <a href="https://apps.apple.com/app/id6762567982"
         style="display:block;background:#5fcfbf;color:#0f1117;text-align:center;padding:14px 24px;border-radius:12px;font-weight:700;font-size:16px;text-decoration:none;margin-bottom:12px;">
        Download on the App Store (iOS)
      </a>
      <a href="https://play.google.com/store/apps/details?id=com.logthelift.app"
         style="display:block;background:#F9F295;color:#0f1117;text-align:center;padding:14px 24px;border-radius:12px;font-weight:700;font-size:16px;text-decoration:none;margin-bottom:12px;">
        Download on Google Play (Android)
      </a>

      <div style="margin-top:24px;padding-top:20px;border-top:1px solid rgba(255,255,255,0.08);">
        <p style="color:rgba(255,255,255,0.4);font-size:12px;margin:0;">
          Invited by <strong style="color:rgba(255,255,255,0.6);">${escapeHtml(gymName)}</strong> via LiftLog.
          If you did not expect this invitation, you can safely ignore this email.
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

  const resend = new Resend(process.env.RESEND_API_KEY);

  const token = req.headers.get('Authorization')?.replace('Bearer ', '');
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: prof } = await sb
    .from('profiles')
    .select('is_gym_owner')
    .eq('id', user.id)
    .single();

  if (!prof?.is_gym_owner) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Rate limit — 20 PT invites per user per hour
  const rl = rateLimit(`send-pt-invite:${user.id}`, 20, 60 * 60 * 1000);
  if (!rl.allowed) {
    return NextResponse.json({ error: 'Too many requests. Please try again later.' }, { status: 429 });
  }

  const { data: gymProfile } = await sb
    .from('gym_profiles')
    .select('gym_name')
    .eq('owner_id', user.id)
    .single();

  const gymName = (gymProfile?.gym_name as string | null) ?? 'Your gym';

  let pts: { email: string; name?: string }[] = [];
  try {
    const body = await req.json();
    pts = body.pts ?? [];
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  if (!pts.length) {
    return NextResponse.json({ error: 'No PTs provided.' }, { status: 400 });
  }

  const results: { email: string; success: boolean; error?: string }[] = [];

  for (const pt of pts) {
    const email = pt.email?.trim().toLowerCase();
    if (!email || !email.includes('@')) {
      results.push({ email: pt.email ?? '', success: false, error: 'Invalid email' });
      continue;
    }

    const ptName = pt.name?.trim() ?? '';
    const { error: emailErr } = await resend.emails.send({
      from:    'LiftLog <noreply@logthelift.ca>',
      to:      [email],
      subject: `${gymName} has invited you to join as a PT on LiftLog`,
      html:    buildPTInviteHtml(gymName, ptName),
    });

    results.push({ email, success: !emailErr, error: emailErr?.message });
  }

  const sent   = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;
  return NextResponse.json({ results, sent, failed });
}
