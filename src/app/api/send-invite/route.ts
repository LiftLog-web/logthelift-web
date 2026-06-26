import { NextRequest, NextResponse } from 'next/server';
import { Resend } from 'resend';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { rateLimit } from '@/lib/rate-limit';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '@/lib/supabase';

const SendInviteSchema = z.object({
  patients:    z.array(z.object({
    email: z.string().email().max(254),
    name:  z.string().max(100).optional(),
  })).min(1).max(100),
  isEmployer:  z.boolean().optional(),
  companyName: z.string().max(100).optional(),
});

function generateCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function buildInviteHtml(senderName: string, firstName: string, code: string, isEmployer: boolean): string {
  const headline = isEmployer
    ? `Hi ${escapeHtml(firstName)}, ${escapeHtml(senderName)} has invited you to LiftLog 🌿`
    : `Hi ${escapeHtml(firstName)}, ${escapeHtml(senderName)} invited you to LiftLog 👋`;

  const body = isEmployer
    ? `<strong style="color:#fff;">${escapeHtml(senderName)}</strong> wants to invite you to LiftLog to promote a healthy work environment and help you incorporate stretching and mobility into your work day. Your personalized office wellness plan will be waiting for you once you sign up.`
    : `You've been invited to LiftLog to track your fitness progress and stay connected with your team.`;

  const linkStep = isEmployer
    ? `Open the <strong style="color:#fff;">Stats</strong> tab, tap the <strong style="color:#fff;">⚙️ settings wheel</strong>, then tap <strong style="color:#fff;">Link to Practitioner or Employer</strong>`
    : `Open the <strong style="color:#fff;">Stats</strong> tab, tap the <strong style="color:#fff;">⚙️ settings wheel</strong>, then tap <strong style="color:#fff;">Link to Practitioner or Employer</strong>`;

  const footer = isEmployer
    ? `Sent on behalf of <strong style="color:rgba(255,255,255,0.6);">${escapeHtml(senderName)}</strong> via LiftLog. If you were not expecting this, you can safely ignore it.`
    : `Invited by <strong style="color:rgba(255,255,255,0.6);">${escapeHtml(senderName)}</strong> via LiftLog. If you don't know this person, you can safely ignore this email.`;

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0f1117;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:600px;margin:0 auto;padding:40px 24px;">
    <div style="margin-bottom:32px;">
      <span style="color:#5fcfbf;font-size:24px;font-weight:800;letter-spacing:-0.5px;">LiftLog</span>
    </div>
    <div style="background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:16px;padding:36px;">
      <p style="color:rgba(255,255,255,0.5);font-size:13px;margin:0 0 6px;">You have a new invitation</p>
      <h1 style="color:#fff;font-size:22px;font-weight:700;margin:0 0 20px;">${headline}</h1>
      <p style="color:rgba(255,255,255,0.7);font-size:15px;line-height:1.7;margin:0 0 28px;">${body}</p>

      <div style="background:rgba(95,207,191,0.1);border:1px solid rgba(95,207,191,0.3);border-radius:12px;padding:24px;text-align:center;margin-bottom:28px;">
        <p style="color:rgba(255,255,255,0.5);font-size:12px;font-weight:600;letter-spacing:1px;margin:0 0 8px;">YOUR INVITE CODE</p>
        <p style="color:#5fcfbf;font-size:36px;font-weight:800;letter-spacing:6px;margin:0;font-family:'Courier New',monospace;">${escapeHtml(code)}</p>
      </div>

      <p style="color:rgba(255,255,255,0.6);font-size:14px;font-weight:600;margin:0 0 12px;">How to get started:</p>
      <ol style="color:rgba(255,255,255,0.7);font-size:14px;line-height:2;margin:0 0 28px;padding-left:20px;">
        <li>Download <strong style="color:#fff;">LiftLog</strong> from the App Store (iOS) or Google Play (Android)</li>
        <li>Create your free account</li>
        <li>${linkStep}</li>
        <li>Enter the code above — you'll be connected instantly</li>
      </ol>

      <a href="https://apps.apple.com/app/id6762567982"
         style="display:block;background:#5fcfbf;color:#0f1117;text-align:center;padding:14px 24px;border-radius:12px;font-weight:700;font-size:16px;text-decoration:none;margin-bottom:12px;">
        Download on the App Store (iOS)
      </a>
      <a href="https://play.google.com/store/apps/details?id=com.logthelift.app"
         style="display:block;background:#F9F295;color:#0f1117;text-align:center;padding:14px 24px;border-radius:12px;font-weight:700;font-size:16px;text-decoration:none;">
        Download on Google Play (Android)
      </a>

      <div style="margin-top:24px;padding-top:20px;border-top:1px solid rgba(255,255,255,0.08);">
        <p style="color:rgba(255,255,255,0.4);font-size:12px;margin:0;">${footer}</p>
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
  const resend = new Resend(process.env.RESEND_API_KEY);

  if (!process.env.RESEND_API_KEY) {
    return NextResponse.json({ error: 'Email service not configured.' }, { status: 503 });
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
    .select('role, is_gym_owner, display_name')
    .eq('id', user.id)
    .single();

  if (prof?.role !== 'practitioner' && !prof?.is_gym_owner) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Rate limit — 50 invites per user per hour
  const rl = rateLimit(`send-invite:${user.id}`, 50, 60 * 60 * 1000);
  if (!rl.allowed) {
    return NextResponse.json({ error: 'Too many requests. Please try again later.' }, { status: 429 });
  }

  let parsed: ReturnType<typeof SendInviteSchema.safeParse>;
  try {
    parsed = SendInviteSchema.safeParse(await req.json());
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  }
  const { patients, isEmployer = false, companyName = '' } = parsed.data;

  const senderName = isEmployer && companyName
    ? companyName
    : ((prof?.display_name as string | null) ?? 'Your practitioner');

  const results: { email: string; success: boolean; error?: string }[] = [];

  for (const patient of patients) {
    const email = patient.email.trim().toLowerCase();

    const code = generateCode();

    const { error: codeErr } = await sb
      .from('invite_codes')
      .insert({ practitioner_id: user.id, code });

    if (codeErr) {
      results.push({ email, success: false, error: 'Could not create invite code' });
      continue;
    }

    const firstName = patient.name?.trim().split(' ')[0] ?? 'there';
    const subject   = isEmployer
      ? `${senderName} has invited you to LiftLog`
      : `${senderName} has invited you to LiftLog`;
    const { error: emailErr } = await resend.emails.send({
      from:    'LiftLog <noreply@logthelift.ca>',
      to:      [email],
      subject,
      html:    buildInviteHtml(senderName, firstName, code, isEmployer),
    });

    results.push({ email, success: !emailErr, error: emailErr?.message });
  }

  const sent    = results.filter(r => r.success).length;
  const failed  = results.filter(r => !r.success).length;
  return NextResponse.json({ results, sent, failed });
}
