import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';

const FROM    = process.env.NOTIFY_FROM_EMAIL ?? 'programs@logthelift.ca';
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://logthelift.ca';

function sb() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}

function esc(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── GET — Vercel Cron (20th of each month at 09:00 UTC) ──────────────────────

export async function GET(req: NextRequest) {
  const auth   = req.headers.get('authorization') ?? '';
  const secret = (process.env.CRON_SECRET ?? '').trim();
  if (!secret || auth.trim() !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const client = sb();
  const resend = new Resend(process.env.RESEND_API_KEY);

  // Next calendar month bounds
  const now            = new Date();
  const nextMonthStart = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const nextMonthEnd   = new Date(now.getFullYear(), now.getMonth() + 2, 0); // last day
  const startStr       = nextMonthStart.toISOString().slice(0, 10);
  const endStr         = nextMonthEnd.toISOString().slice(0, 10);
  const monthLabel     = nextMonthStart.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  // Fetch all employers and which ones already have a program that overlaps next month
  const [{ data: employers }, { data: coveredRows }] = await Promise.all([
    client.from('profiles').select('id, company_name').eq('is_employer', true),
    client.from('employer_programs')
      .select('employer_id')
      .lte('started_at', endStr)
      .gte('ends_at', startStr),
  ]);

  if (!employers?.length) {
    return NextResponse.json({ sent: 0, reason: 'No employers' });
  }

  const coveredSet = new Set((coveredRows ?? []).map((r: any) => r.employer_id as string));
  const uncovered  = (employers as any[]).filter(e => !coveredSet.has(e.id as string));

  if (!uncovered.length) {
    return NextResponse.json({ sent: 0, reason: 'All employers have a program next month' });
  }

  let sent = 0, failed = 0;

  for (const employer of uncovered) {
    const { data: userRes } = await client.auth.admin.getUserById(employer.id);
    const email = userRes?.user?.email;
    if (!email) { failed++; continue; }
    const company = (employer.company_name as string | null) ?? 'Your Company';
    const { error } = await resend.emails.send({
      from: FROM, to: email,
      subject: `Reminder — no program set for ${monthLabel} yet`,
      html: buildNoProgramHtml(company, monthLabel),
    });
    if (error) { console.error('notify-no-program: email failed', employer.id, error); failed++; }
    else sent++;
  }

  return NextResponse.json({ sent, failed, uncovered: uncovered.length });
}

// ── Email template ───────────────────────────────────────────────────────────

function buildNoProgramHtml(company: string, monthLabel: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
</head>
<body style="margin:0;padding:0;background:#0f1117;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#0f1117;padding:48px 20px;">
  <tr><td align="center">
    <table width="100%" cellpadding="0" cellspacing="0" style="max-width:580px;">

      <tr><td style="padding-bottom:28px;">
        <span style="font-size:22px;font-weight:800;color:#1EDBA8;letter-spacing:-0.5px;">LiftLog</span>
      </td></tr>

      <tr><td style="background:#1a1a2e;border:1px solid #2a2a3a;border-radius:18px;padding:36px;">

        <p style="margin:0 0 6px;font-size:12px;font-weight:700;color:#C471ED;text-transform:uppercase;letter-spacing:0.08em;">Program Reminder</p>
        <h1 style="margin:0 0 14px;font-size:24px;font-weight:800;color:#f0f0f0;line-height:1.25;">
          No program set for ${esc(monthLabel)} yet
        </h1>
        <p style="margin:0 0 28px;font-size:14px;color:#9ca3af;line-height:1.65;">
          Hi ${esc(company)} &mdash; we noticed you don&rsquo;t have a program scheduled for ${esc(monthLabel)}.
          Keep your team on track by launching one before the month begins.
        </p>

        <table width="100%" cellpadding="0" cellspacing="0"
          style="background:#0f1117;border:1px solid #2a2a3a;border-radius:12px;margin-bottom:32px;">
          <tr>
            <td style="padding:20px;text-align:center;">
              <div style="font-size:34px;margin-bottom:12px;">&#128197;</div>
              <div style="font-size:15px;font-weight:700;color:#f0f0f0;margin-bottom:6px;">Browse available programs</div>
              <div style="font-size:13px;color:#6b7280;line-height:1.5;">
                Review the catalog and assign the right program for your team for ${esc(monthLabel)}.
              </div>
            </td>
          </tr>
        </table>

        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td align="center">
              <a href="${APP_URL}/programs"
                 style="display:inline-block;background:#1EDBA8;color:#0f1117;font-size:15px;font-weight:800;text-decoration:none;padding:15px 40px;border-radius:12px;">
                Set Up Program &rarr;
              </a>
            </td>
          </tr>
        </table>

      </td></tr>

      <tr><td style="padding-top:28px;text-align:center;">
        <p style="margin:0;font-size:12px;color:#4b5563;line-height:1.6;">
          Sent to help your team stay active every month. You&rsquo;re registered as an employer on LiftLog.<br>
          &copy; ${new Date().getFullYear()} LiftLog
        </p>
      </td></tr>

    </table>
  </td></tr>
</table>
</body>
</html>`;
}
