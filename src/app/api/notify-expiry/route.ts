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

function fmtDate(d: string) {
  return new Date(d + 'T12:00:00').toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  });
}

function daysUntil(dateStr: string): number {
  const target = new Date(dateStr + 'T00:00:00');
  const now = new Date(); now.setHours(0, 0, 0, 0);
  return Math.max(1, Math.ceil((target.getTime() - now.getTime()) / 86400000));
}

// ── GET — Vercel Cron (every Monday at 09:00 UTC) ────────────────────────────

export async function GET(req: NextRequest) {
  const auth   = req.headers.get('authorization') ?? '';
  const secret = (process.env.CRON_SECRET ?? '').trim();
  if (!secret || auth.trim() !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const client = sb();
  const resend = new Resend(process.env.RESEND_API_KEY);
  const today  = new Date();
  const todayStr   = today.toISOString().slice(0, 10);
  const sevenAhead = new Date(today.getTime() + 7 * 86400000).toISOString().slice(0, 10);

  // Programs ending within the next 7 days (not today — today is the last active day)
  const { data: expiringProgs, error: fetchErr } = await client
    .from('employer_programs')
    .select('id, employer_id, name, ends_at')
    .gt('ends_at', todayStr)
    .lte('ends_at', sevenAhead);

  if (fetchErr) {
    console.error('notify-expiry: fetch failed', fetchErr);
    return NextResponse.json({ error: 'DB error' }, { status: 500 });
  }

  if (!expiringProgs?.length) {
    return NextResponse.json({ emailSent: 0, notifWritten: 0, reason: 'No expiring programs' });
  }

  // Group programs by employer
  const byEmployer: Record<string, Array<{ id: string; name: string; ends_at: string }>> = {};
  for (const p of expiringProgs) {
    if (!byEmployer[p.employer_id]) byEmployer[p.employer_id] = [];
    byEmployer[p.employer_id].push({
      id:      p.id      as string,
      name:    p.name    as string,
      ends_at: p.ends_at as string,
    });
  }

  const employerIds = Object.keys(byEmployer);
  const { data: profiles } = await client
    .from('profiles')
    .select('id, company_name')
    .in('id', employerIds);
  const profileMap = new Map(
    (profiles ?? []).map((p: any) => [p.id as string, (p.company_name as string | null) ?? 'Your Company']),
  );

  let emailSent = 0, emailFailed = 0, notifWritten = 0;

  for (const empId of employerIds) {
    const progs   = byEmployer[empId];
    const company = profileMap.get(empId) ?? 'Your Company';

    // ── Employer warning email ─────────────────────────────────────────────
    const { data: userRes } = await client.auth.admin.getUserById(empId);
    const email = userRes?.user?.email;
    if (!email) {
      emailFailed++;
    } else {
      const days    = daysUntil(progs[0].ends_at);
      const subject = progs.length === 1
        ? `Action required — "${progs[0].name}" ends in ${days} day${days !== 1 ? 's' : ''}`
        : `Action required — ${progs.length} programs ending this week`;
      const { error } = await resend.emails.send({
        from: FROM, to: email, subject,
        html: buildExpiryWarningHtml(company, progs),
      });
      if (error) { console.error('notify-expiry: email failed', empId, error); emailFailed++; }
      else emailSent++;
    }

    // ── Employee in-app notifications ─────────────────────────────────────
    const { data: links } = await client
      .from('patient_links')
      .select('patient_id')
      .eq('practitioner_id', empId);

    for (const link of (links ?? [])) {
      for (const prog of progs) {
        const dLeft = daysUntil(prog.ends_at);
        const { error } = await client.from('notifications').upsert({
          user_id:   link.patient_id,
          type:      'program_expiry_warning',
          title:     'Your program is ending soon',
          body:      `${prog.name} ends in ${dLeft} day${dLeft !== 1 ? 's' : ''}. Your employer will let you know what's next.`,
          data:      { program_id: prog.id, ends_at: prog.ends_at },
          dedup_key: `program_expiry:${prog.id}:${link.patient_id}`,
        }, { onConflict: 'dedup_key', ignoreDuplicates: true });
        if (!error) notifWritten++;
      }
    }
  }

  return NextResponse.json({ emailSent, emailFailed, notifWritten });
}

// ── Email template ───────────────────────────────────────────────────────────

function buildExpiryWarningHtml(
  company: string,
  programs: { id: string; name: string; ends_at: string }[],
): string {
  const rows = programs.map(p => {
    const days    = daysUntil(p.ends_at);
    const urgency = days <= 2 ? '#ef4444' : days <= 4 ? '#f97316' : '#facc15';
    return `
      <tr style="border-top:1px solid #2a2a3a;">
        <td style="padding:14px 16px;">
          <div style="font-size:15px;font-weight:700;color:#f0f0f0;">${esc(p.name)}</div>
          <div style="margin-top:4px;font-size:13px;color:${urgency};font-weight:600;">
            Ends ${fmtDate(p.ends_at)} &middot; ${days} day${days !== 1 ? 's' : ''} remaining
          </div>
        </td>
      </tr>`;
  }).join('');

  const headline = programs.length === 1
    ? 'A program is ending soon'
    : `${programs.length} programs ending this week`;

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

        <p style="margin:0 0 6px;font-size:12px;font-weight:700;color:#f97316;text-transform:uppercase;letter-spacing:0.08em;">Action Required</p>
        <h1 style="margin:0 0 14px;font-size:24px;font-weight:800;color:#f0f0f0;">${headline}</h1>
        <p style="margin:0 0 28px;font-size:14px;color:#9ca3af;line-height:1.6;">
          Hi ${esc(company)} &mdash; ${programs.length === 1 ? 'one of your active programs' : 'some of your active programs'} will be
          ending shortly. Make sure your employees know what&rsquo;s next by launching a new program before it expires.
        </p>

        <table width="100%" cellpadding="0" cellspacing="0"
          style="border-collapse:collapse;border-radius:12px;overflow:hidden;border:1px solid #2a2a3a;margin-bottom:32px;">
          <tbody style="background:#0f1117;">
            ${rows}
          </tbody>
        </table>

        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td align="center">
              <a href="${APP_URL}/programs"
                 style="display:inline-block;background:#1EDBA8;color:#0f1117;font-size:15px;font-weight:800;text-decoration:none;padding:14px 36px;border-radius:12px;">
                Launch Next Program &rarr;
              </a>
            </td>
          </tr>
        </table>

      </td></tr>

      <tr><td style="padding-top:28px;text-align:center;">
        <p style="margin:0;font-size:12px;color:#4b5563;line-height:1.6;">
          Sent automatically when a program is about to expire. You&rsquo;re registered as an employer on LiftLog.<br>
          &copy; ${new Date().getFullYear()} LiftLog
        </p>
      </td></tr>

    </table>
  </td></tr>
</table>
</body>
</html>`;
}
