import { NextRequest, NextResponse } from 'next/server';
import { Resend } from 'resend';
import { rateLimit, getClientIp } from '@/lib/rate-limit';

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export async function POST(req: NextRequest) {
  // Rate limit — 5 submissions per IP per hour (public form)
  const rl = rateLimit(`business-application:${getClientIp(req)}`, 5, 60 * 60 * 1000);
  if (!rl.allowed) {
    return NextResponse.json({ error: 'Too many requests. Please try again later.' }, { status: 429 });
  }

  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    const { name, email, companyName, businessType } = await req.json();

    if (!name || !email || !companyName || !businessType) {
      return NextResponse.json({ error: 'Missing fields' }, { status: 400 });
    }

    const typeLabel = businessType === 'gym' ? 'Gym / Studio' : 'Corporate / Employer';

    const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#0f1117;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:560px;margin:0 auto;padding:40px 24px;">
    <p style="color:#5fcfbf;font-weight:800;font-size:22px;margin:0 0 24px;">LiftLog — New Business Application</p>
    <div style="background:#1a1f2e;border:1px solid rgba(255,255,255,0.1);border-radius:16px;padding:28px;margin-bottom:24px;">
      <table style="width:100%;border-collapse:collapse;">
        <tr><td style="color:rgba(255,255,255,0.45);font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;padding-bottom:4px;">Name</td></tr>
        <tr><td style="color:#fff;font-size:16px;font-weight:600;padding-bottom:16px;">${escapeHtml(name)}</td></tr>
        <tr><td style="color:rgba(255,255,255,0.45);font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;padding-bottom:4px;">Email</td></tr>
        <tr><td style="color:#5fcfbf;font-size:16px;font-weight:600;padding-bottom:16px;">${escapeHtml(email)}</td></tr>
        <tr><td style="color:rgba(255,255,255,0.45);font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;padding-bottom:4px;">Company</td></tr>
        <tr><td style="color:#fff;font-size:16px;font-weight:600;padding-bottom:16px;">${escapeHtml(companyName)}</td></tr>
        <tr><td style="color:rgba(255,255,255,0.45);font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;padding-bottom:4px;">Business Type</td></tr>
        <tr><td style="color:#F9F295;font-size:16px;font-weight:600;">${escapeHtml(typeLabel)}</td></tr>
      </table>
    </div>
    <p style="color:rgba(255,255,255,0.5);font-size:13px;line-height:1.6;">
      To approve this account, open Supabase → profiles → find <strong style="color:#fff;">${escapeHtml(email)}</strong> → set
      <strong style="color:#fff;">${businessType === 'gym' ? 'is_gym_owner = true' : 'is_employer = true'}</strong>
      and confirm <strong style="color:#fff;">company_name</strong> is set to <strong style="color:#fff;">${escapeHtml(companyName)}</strong>.
    </p>
  </div>
</body>
</html>`;

    await resend.emails.send({
      from:    'LiftLog <noreply@logthelift.ca>',
      to:      'logthelift@gmail.com',
      subject: `New Business Application — ${companyName} (${typeLabel})`,
      html,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('business-application error:', err);
    return NextResponse.json({ error: 'Failed to send notification' }, { status: 500 });
  }
}
