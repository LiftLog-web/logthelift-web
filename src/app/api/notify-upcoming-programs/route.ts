import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://logthelift.com';
const FROM    = process.env.NOTIFY_FROM_EMAIL   ?? 'programs@logthelift.com';
const MASTER  = process.env.NEXT_PUBLIC_FEATURED_PRACTITIONER_ID!;

function sb() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}

export async function GET(req: NextRequest) {
  const auth   = req.headers.get('authorization') ?? '';
  const secret = (process.env.CRON_SECRET ?? '').trim();
  if (!secret || auth.trim() !== `Bearer ${secret}`) {
    return NextResponse.json({
      error: 'Unauthorized',
      debug: { authLength: auth.length, secretLength: secret.length, secretSet: !!secret },
    }, { status: 401 });
  }

  const client = sb();
  const today  = new Date().toISOString().slice(0, 10);
  const d45    = new Date(); d45.setDate(d45.getDate() + 45);
  const future = d45.toISOString().slice(0, 10);

  // Fetch coming-soon programs (not yet live, within 45-day window)
  const { data: tpls, error: tplErr } = await client
    .from('plan_templates')
    .select('id, name, description, featured_duration_days, catalog_available_from, catalog_available_until')
    .eq('practitioner_id', MASTER)
    .eq('is_featured', true)
    .not('catalog_available_from', 'is', null)
    .gt('catalog_available_from', today)
    .lte('catalog_available_from', future)
    .order('catalog_available_from');

  if (tplErr) return NextResponse.json({ error: tplErr.message }, { status: 500 });

  const upcoming = (tpls ?? []).filter(
    p => !p.catalog_available_until || p.catalog_available_until >= today,
  );

  if (upcoming.length === 0) {
    return NextResponse.json({ sent: 0, reason: 'No upcoming programs to notify about' });
  }

  // Fetch all active employers
  const { data: employers, error: empErr } = await client
    .from('profiles')
    .select('id, company_name')
    .eq('is_employer', true);

  if (empErr) return NextResponse.json({ error: empErr.message }, { status: 500 });

  const resend = new Resend(process.env.RESEND_API_KEY);
  let sent = 0, failed = 0;

  for (const employer of (employers ?? [])) {
    const { data: userRes, error: userErr } = await client.auth.admin.getUserById(employer.id);
    if (userErr || !userRes?.user?.email) { failed++; continue; }

    const { error: sendErr } = await resend.emails.send({
      from:    FROM,
      to:      userRes.user.email,
      subject: buildSubject(upcoming),
      html:    buildHtml(employer.company_name ?? 'your company', upcoming),
    });

    if (sendErr) { console.error('Resend error for', userRes.user.email, sendErr); failed++; }
    else { sent++; }
  }

  return NextResponse.json({ sent, failed, programs: upcoming.length });
}

function buildSubject(programs: any[]): string {
  const first = programs[0].catalog_available_from as string;
  const month = new Date(first + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  return `Next month's programs are ready to preview — ${month}`;
}

function fmtDate(d: string) {
  return new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
}

function buildHtml(company: string, programs: any[]): string {
  const rows = programs.map(p => `
    <tr>
      <td style="padding:18px 0;border-bottom:1px solid #2a2a3a;">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td>
              <span style="font-size:16px;font-weight:700;color:#f0f0f0;">${p.name}</span>
              ${p.featured_duration_days
                ? `<span style="margin-left:8px;font-size:12px;font-weight:600;color:#C471ED;background:rgba(196,113,237,0.15);border-radius:999px;padding:2px 9px;">${p.featured_duration_days}-day program</span>`
                : ''}
            </td>
          </tr>
          ${p.description ? `<tr><td style="padding-top:4px;font-size:14px;color:#9ca3af;line-height:1.55;">${p.description}</td></tr>` : ''}
          <tr><td style="padding-top:6px;font-size:13px;font-weight:600;color:#1EDBA8;">Available from ${fmtDate(p.catalog_available_from)}</td></tr>
        </table>
      </td>
    </tr>`).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Upcoming Programs</title>
</head>
<body style="margin:0;padding:0;background:#0f1117;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0f1117;padding:48px 20px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:580px;">

        <!-- Brand -->
        <tr>
          <td style="padding-bottom:28px;">
            <span style="font-size:22px;font-weight:800;color:#1EDBA8;letter-spacing:-0.5px;">LiftLog</span>
          </td>
        </tr>

        <!-- Card -->
        <tr>
          <td style="background:#1a1a2e;border:1px solid #2a2a3a;border-radius:18px;padding:36px;">

            <p style="margin:0 0 8px;font-size:12px;font-weight:700;color:#1EDBA8;text-transform:uppercase;letter-spacing:0.08em;">Coming Soon</p>
            <h1 style="margin:0 0 14px;font-size:26px;font-weight:800;color:#f0f0f0;line-height:1.25;">
              Next month's programs are ready to preview
            </h1>
            <p style="margin:0 0 30px;font-size:15px;color:#9ca3af;line-height:1.65;">
              Hi ${company} — take a look at what's available next month. Review the exercises now and decide which program you'd like to launch for your team before the window opens.
            </p>

            <!-- Programs -->
            <table width="100%" cellpadding="0" cellspacing="0">
              ${rows}
            </table>

            <!-- CTA -->
            <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:32px;">
              <tr>
                <td align="center">
                  <a href="${APP_URL}/programs"
                     style="display:inline-block;background:#1EDBA8;color:#0f1117;font-size:15px;font-weight:800;text-decoration:none;padding:15px 40px;border-radius:12px;">
                    Preview Programs &rarr;
                  </a>
                </td>
              </tr>
            </table>

          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="padding-top:28px;text-align:center;">
            <p style="margin:0;font-size:12px;color:#4b5563;line-height:1.6;">
              You're receiving this because you're registered as an employer on LiftLog.<br>
              &copy; ${new Date().getFullYear()} LiftLog
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}
