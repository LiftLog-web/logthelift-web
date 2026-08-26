import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import { SUPABASE_URL } from '@/lib/supabase';

const FROM    = process.env.NOTIFY_FROM_EMAIL ?? 'programs@logthelift.ca';
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://logthelift.ca';

const MILESTONES = [10, 25, 50, 100, 200, 500, 1000];

function sbAdmin() {
  return createClient(
    SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}

function esc(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function fmtMonth(d: Date) {
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

function milestone(n: number): number | null {
  for (let i = MILESTONES.length - 1; i >= 0; i--) {
    if (n >= MILESTONES[i]) return MILESTONES[i];
  }
  return null;
}

interface IndividualCallout { name: string; total: number; milestone: number; }
interface TeamCallout       { name: string; total: number; milestone: number; }

function buildMilestonesHtml(
  company:     string,
  monthLabel:  string,
  individuals: IndividualCallout[],
  teams:       TeamCallout[],
): string {
  const hasIndividual = individuals.length > 0;
  const hasTeam       = teams.length > 0;

  const medalFor = (m: number) =>
    m >= 500 ? '🏆' : m >= 100 ? '🥇' : m >= 50 ? '🥈' : m >= 25 ? '🥉' : '⭐';

  const individualRows = individuals.map(({ name, total, milestone: m }) => `
    <tr style="border-bottom:1px solid #2a2a3a;">
      <td style="padding:12px 16px;font-size:22px;">${medalFor(m)}</td>
      <td style="padding:12px 8px;font-size:14px;color:#f0f0f0;font-weight:600;">${esc(name)}</td>
      <td style="padding:12px 8px;font-size:14px;color:#6b7280;text-align:right;">${total.toLocaleString()} workouts</td>
      <td style="padding:12px 16px 12px 8px;font-size:13px;font-weight:700;color:#1EDBA8;text-align:right;">
        ${m.toLocaleString()} milestone!
      </td>
    </tr>`).join('');

  const teamRows = teams.map(({ name, total, milestone: m }) => `
    <tr style="border-bottom:1px solid #2a2a3a;">
      <td style="padding:12px 16px;font-size:22px;">${medalFor(m)}</td>
      <td style="padding:12px 8px;font-size:14px;color:#f0f0f0;font-weight:600;">${esc(name)}</td>
      <td style="padding:12px 8px;font-size:14px;color:#6b7280;text-align:right;">${total.toLocaleString()} combined</td>
      <td style="padding:12px 16px 12px 8px;font-size:13px;font-weight:700;color:#C471ED;text-align:right;">
        ${m.toLocaleString()} milestone!
      </td>
    </tr>`).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Monthly Milestones — ${esc(company)}</title></head>
<body style="margin:0;padding:0;background:#080b12;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#080b12;">
    <tr><td align="center" style="padding:40px 16px;">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

        <!-- Header -->
        <tr><td style="padding-bottom:32px;">
          <p style="margin:0 0 6px;font-size:12px;font-weight:700;color:#1EDBA8;text-transform:uppercase;letter-spacing:0.08em;">Monthly Milestones</p>
          <h1 style="margin:0 0 6px;font-size:24px;font-weight:800;color:#f0f0f0;">Celebrate Your Team! 🎉</h1>
          <p style="margin:0;font-size:14px;color:#6b7280;">${esc(company)} · ${esc(monthLabel)}</p>
        </td></tr>

        ${hasIndividual ? `
        <!-- Individual milestones -->
        <tr><td style="padding-bottom:32px;">
          <p style="margin:0 0 12px;font-size:11px;font-weight:700;color:#1EDBA8;text-transform:uppercase;letter-spacing:0.08em;">Individual Milestones</p>
          <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border-radius:12px;overflow:hidden;border:1px solid #2a2a3a;background:#0f1117;">
            <tbody>${individualRows}</tbody>
          </table>
        </td></tr>` : ''}

        ${hasTeam ? `
        <!-- Team milestones -->
        <tr><td style="padding-bottom:32px;">
          <p style="margin:0 0 12px;font-size:11px;font-weight:700;color:#C471ED;text-transform:uppercase;letter-spacing:0.08em;">Team Milestones</p>
          <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border-radius:12px;overflow:hidden;border:1px solid #2a2a3a;background:#0f1117;">
            <tbody>${teamRows}</tbody>
          </table>
        </td></tr>` : ''}

        <!-- CTA -->
        <tr><td style="padding-bottom:40px;text-align:center;">
          <a href="${APP_URL}/leaderboard"
             style="display:inline-block;background:#1EDBA8;color:#0f1117;font-size:15px;font-weight:800;text-decoration:none;padding:14px 36px;border-radius:12px;">
            View Full Leaderboard &rarr;
          </a>
        </td></tr>

        <!-- Footer -->
        <tr><td style="border-top:1px solid #2a2a3a;padding-top:24px;text-align:center;">
          <p style="margin:0;font-size:12px;color:#374151;">
            LiftLog &mdash; Employer Monthly Milestones Report
          </p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// ── GET — Vercel Cron (1st of each month, 09:00 UTC) ─────────────────────────

export async function GET(req: NextRequest) {
  const auth   = req.headers.get('authorization') ?? '';
  const secret = (process.env.CRON_SECRET ?? '').trim();
  if (!secret || auth.trim() !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const client = sbAdmin();
  const resend  = new Resend(process.env.RESEND_API_KEY);

  // Compute last month's date range
  const now          = new Date();
  const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0); // last day of prev month
  const lastMonthStart = new Date(lastMonthEnd.getFullYear(), lastMonthEnd.getMonth(), 1);
  const startStr = lastMonthStart.toISOString().slice(0, 10);
  const endStr   = lastMonthEnd.toISOString().slice(0, 10);
  const monthLabel = fmtMonth(lastMonthEnd);

  // Fetch all active employers
  const { data: employers } = await client
    .from('profiles')
    .select('id, company_name')
    .eq('is_employer', true);

  if (!employers?.length) return NextResponse.json({ sent: 0, reason: 'No employers' });

  let sent = 0, failed = 0;

  for (const employer of employers) {
    try {
      const { data: userRes } = await client.auth.admin.getUserById(employer.id);
      const email = userRes?.user?.email;
      if (!email) continue;

      // Get all employees for this employer
      const { data: links } = await client
        .from('patient_links')
        .select('patient_id, team_id, profiles!patient_links_patient_id_fkey(display_name)')
        .eq('practitioner_id', employer.id);

      if (!links?.length) continue;

      const employeeIds = links.map((l: any) => l.patient_id as string);

      // Count all-time workouts and last-month workouts per employee in one query
      const { data: allTimeRows } = await client
        .from('synced_workouts')
        .select('user_id, date')
        .in('user_id', employeeIds)
        .lte('date', endStr);

      if (!allTimeRows?.length) continue;

      // Aggregate counts per employee
      const totalAllTime: Record<string, number> = {};
      const totalLastMonth: Record<string, number> = {};

      for (const row of allTimeRows as any[]) {
        const uid = row.user_id as string;
        totalAllTime[uid] = (totalAllTime[uid] ?? 0) + 1;
        if (row.date >= startStr) {
          totalLastMonth[uid] = (totalLastMonth[uid] ?? 0) + 1;
        }
      }

      // Detect individual milestone crossings
      const nameMap: Record<string, string> = {};
      for (const l of links as any[]) {
        nameMap[l.patient_id] = (l.profiles?.display_name as string | null) ?? 'Unknown';
      }

      const individualCallouts: IndividualCallout[] = [];
      for (const empId of employeeIds) {
        const total    = totalAllTime[empId] ?? 0;
        const prevTotal = total - (totalLastMonth[empId] ?? 0);
        const m = milestone(total);
        if (m !== null && prevTotal < m) {
          individualCallouts.push({ name: nameMap[empId], total, milestone: m });
        }
      }
      individualCallouts.sort((a, b) => b.milestone - a.milestone);

      // Detect team milestone crossings
      const teamCallouts: TeamCallout[] = [];
      const teamMap = new Map<string, { name: string; total: number; prev: number }>();

      // Build team lookup from links
      const { data: teamsData } = await client
        .from('employer_teams')
        .select('id, name')
        .eq('employer_id', employer.id);

      if (teamsData?.length) {
        const teamNames: Record<string, string> = {};
        for (const t of teamsData as any[]) teamNames[t.id] = t.name;

        for (const l of links as any[]) {
          const tid = l.team_id as string | null;
          if (!tid || !teamNames[tid]) continue;
          const empTotal = totalAllTime[l.patient_id] ?? 0;
          const empPrev  = empTotal - (totalLastMonth[l.patient_id] ?? 0);
          if (!teamMap.has(tid)) teamMap.set(tid, { name: teamNames[tid], total: 0, prev: 0 });
          const entry = teamMap.get(tid)!;
          entry.total += empTotal;
          entry.prev  += empPrev;
        }

        for (const [, entry] of teamMap) {
          const m = milestone(entry.total);
          if (m !== null && entry.prev < m) {
            teamCallouts.push({ name: entry.name, total: entry.total, milestone: m });
          }
        }
        teamCallouts.sort((a, b) => b.milestone - a.milestone);
      }

      if (individualCallouts.length === 0 && teamCallouts.length === 0) continue;

      const company = (employer.company_name as string | null) ?? 'Your Company';
      const html = buildMilestonesHtml(company, monthLabel, individualCallouts, teamCallouts);
      const subject = `Monthly Milestones — ${company} — ${monthLabel}`;

      const { error } = await resend.emails.send({ from: FROM, to: email, subject, html });
      if (error) { console.error('[monthly-milestones] send failed', employer.id, error); failed++; }
      else sent++;
    } catch (err) {
      console.error('[monthly-milestones] employer error', employer.id, err);
      failed++;
    }
  }

  return NextResponse.json({ sent, failed, month: monthLabel });
}
