import { NextRequest, NextResponse } from 'next/server';
import { Resend } from 'resend';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { rateLimit } from '@/lib/rate-limit';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '@/lib/supabase';

const SendEmailSchema = z.object({
  to:       z.string().email().max(254),
  toName:   z.string().max(100).optional(),
  fromName: z.string().max(100).optional(),
  subject:  z.string().min(1).max(200),
  body:     z.string().min(1).max(10000),
});

export async function POST(req: NextRequest) {
  const resend = new Resend(process.env.RESEND_API_KEY);

  // Auth — must be a practitioner or gym owner
  const token = req.headers.get('Authorization')?.replace('Bearer ', '');
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: prof } = await sb
    .from('profiles')
    .select('role, is_gym_owner')
    .eq('id', user.id)
    .single();

  if (prof?.role !== 'practitioner' && !prof?.is_gym_owner) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Rate limit — 20 emails per user per hour
  const rl = rateLimit(`send-email:${user.id}`, 20, 60 * 60 * 1000);
  if (!rl.allowed) {
    return NextResponse.json({ error: 'Too many requests. Please try again later.' }, { status: 429 });
  }

  try {
    const parsed = SendEmailSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
    }
    const { to, toName, fromName, subject, body } = parsed.data;

    if (!process.env.RESEND_API_KEY) {
      return NextResponse.json({ error: 'Email service not configured.' }, { status: 503 });
    }

    const html = `
      <!DOCTYPE html>
      <html>
      <head><meta charset="utf-8"></head>
      <body style="margin:0;padding:0;background:#0f1117;font-family:sans-serif;">
        <div style="max-width:600px;margin:0 auto;padding:40px 24px;">
          <div style="margin-bottom:32px;">
            <span style="color:#5fcfbf;font-size:22px;font-weight:800;">LiftLog</span>
          </div>
          <div style="background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:16px;padding:32px;">
            <p style="color:rgba(255,255,255,0.5);font-size:13px;margin:0 0 8px;">Message from your practitioner</p>
            <h2 style="color:#fff;font-size:20px;font-weight:700;margin:0 0 24px;">${escapeHtml(subject)}</h2>
            <div style="color:rgba(255,255,255,0.8);font-size:15px;line-height:1.7;white-space:pre-wrap;">${escapeHtml(body)}</div>
            <div style="margin-top:28px;padding-top:20px;border-top:1px solid rgba(255,255,255,0.08);">
              <p style="color:rgba(255,255,255,0.4);font-size:13px;margin:0;">
                Sent by <strong style="color:#C471ED;">${escapeHtml(fromName ?? '')}</strong> via LiftLog
              </p>
            </div>
          </div>
          <p style="color:rgba(255,255,255,0.25);font-size:12px;text-align:center;margin-top:24px;">
            © ${new Date().getFullYear()} LiftLog · <a href="https://logthelift.ca" style="color:rgba(255,255,255,0.4);">logthelift.ca</a>
          </p>
        </div>
      </body>
      </html>
    `;

    const { error } = await resend.emails.send({
      from:    'LiftLog <noreply@logthelift.ca>',
      replyTo: 'noreply@logthelift.ca',
      to:      [to],
      subject: `[LiftLog] ${subject}`,
      html,
      text:    `${body}\n\n—\nSent by ${fromName} via LiftLog (logthelift.ca)`,
      headers: {
        'X-Entity-Ref-ID': `liftlog-pt-msg-${Date.now()}`,
      },
    });

    if (error) {
      console.error('Resend error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error('send-email error:', err);
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
