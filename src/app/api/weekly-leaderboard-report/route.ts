import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import { z } from 'zod';
import { rateLimit } from '@/lib/rate-limit';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '@/lib/supabase';

const FROM    = process.env.NOTIFY_FROM_EMAIL ?? 'programs@logthelift.ca';
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://logthelift.ca';

// ── Supabase clients ─────────────────────────────────────────────────────────

function sbAdmin() {
  return createClient(
    SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}

function sbUser(token: string) {
  return createClient(
    SUPABASE_URL,
    SUPABASE_ANON_KEY,
    { global: { headers: { Authorization: `Bearer ${token}` } } },
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function esc(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function fmtDate(d: string) {
  return new Date(d + 'T12:00:00').toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  });
}

function fmtShort(d: string) {
  return new Date(d + 'T12:00:00').toLocaleDateString('en-US', {
    month: 'short', day: 'numeric',
  });
}

function expandDateRange(start: string, end: string): string[] {
  const out: string[] = [];
  const cursor = new Date(start + 'T00:00:00');
  const endDate = new Date(end   + 'T00:00:00');
  while (cursor <= endDate) { out.push(cursor.toISOString().slice(0, 10)); cursor.setDate(cursor.getDate() + 1); }
  return out;
}

function calcStreakFixed(dates: string[], workDays: number[], approvedOffDates: string[] = []): number {
  if (!dates.length || !workDays.length) return 0;
  const dateSet = new Set(dates);
  const offSet  = new Set(approvedOffDates);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  function recentWD(from: Date): Date | null {
    const d = new Date(from);
    for (let i = 0; i < 60; i++) {
      const s = d.toISOString().slice(0, 10);
      if (workDays.includes(d.getDay()) && !offSet.has(s)) return new Date(d);
      d.setTime(d.getTime() - 86400000);
    }
    return null;
  }
  const lastWD = recentWD(today);
  if (!lastWD) return 0;
  let startFrom: Date;
  if (dateSet.has(lastWD.toISOString().slice(0, 10))) {
    startFrom = lastWD;
  } else {
    const prev = recentWD(new Date(lastWD.getTime() - 86400000));
    if (!prev || !dateSet.has(prev.toISOString().slice(0, 10))) return 0;
    startFrom = prev;
  }
  let streak = 0, cursor = new Date(startFrom);
  for (let safety = 0; safety < 800; safety++) {
    const s = cursor.toISOString().slice(0, 10);
    if (!offSet.has(s) && workDays.includes(cursor.getDay())) {
      if (dateSet.has(s)) streak++;
      else break;
    }
    cursor = new Date(cursor.getTime() - 86400000);
  }
  return streak;
}

function calcStreakFlexible(dates: string[], approvedOffDates: string[] = []): number {
  if (!dates.length) return 0;
  const dateSet = new Set(dates);
  const offSet  = new Set(approvedOffDates);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  let cursor = new Date(today), streak = 0, misses = 0;
  for (let safety = 0; safety < 800; safety++) {
    const s = cursor.toISOString().slice(0, 10);
    if (offSet.has(s)) { /* approved time off — skip */ }
    else if (dateSet.has(s)) { streak++; misses = 0; }
    else if (++misses >= 3) break;
    cursor = new Date(cursor.getTime() - 86400000);
  }
  return streak;
}

function calcStreak(dates: string[], scheduleType = 'fixed', workDays: number[] = [1, 2, 3, 4, 5], approvedOffDates: string[] = []): number {
  return scheduleType === 'flexible'
    ? calcStreakFlexible(dates, approvedOffDates)
    : calcStreakFixed(dates, workDays, approvedOffDates);
}

// ── Types ────────────────────────────────────────────────────────────────────

interface Employee   { id: string; name: string; teamId: string | null; teamName: string | null; }
interface IndividualRow { rank: number; name: string; teamName: string | null; count: number; streak: number; avgEffectiveness: number | null; avgEnjoyment: number | null; totalReps: number; totalDurationSecs: number; fullProgramDays: number; }
interface TeamRow    { rank: number; name: string; total: number; active: number; members: number; }
interface LbData     { individual: IndividualRow[]; teamRows: TeamRow[]; hasTeams: boolean; numPrograms: number; employeeIds: string[]; }

// ── Data fetching ─────────────────────────────────────────────────────────────

async function fetchLeaderboard(
  employerId:   string,
  fromDate:     string,
  toDate:       string,
  client        = sbAdmin(),
  scheduleType  = 'fixed',
  workDays:     number[] = [1, 2, 3, 4, 5],
): Promise<LbData & { employeeCount: number }> {

  const [{ data: links }, { data: teamsData }, { data: planRows }, { data: offRows }] = await Promise.all([
    client.from('patient_links')
      .select('patient_id, team_id, profiles!patient_links_patient_id_fkey(display_name)')
      .eq('practitioner_id', employerId),
    client.from('employer_teams')
      .select('id, name')
      .eq('employer_id', employerId)
      .order('name'),
    client.from('workout_plans')
      .select('id, name')
      .eq('practitioner_id', employerId),
    client.from('time_off_requests')
      .select('employee_id, start_date, end_date')
      .eq('employer_id', employerId)
      .eq('status', 'approved'),
  ]);

  const teams = (teamsData ?? []) as { id: string; name: string }[];
  const teamMap = new Map(teams.map(t => [t.id, t.name]));

  const employees: Employee[] = (links ?? []).map((l: any) => ({
    id:       l.patient_id,
    name:     l.profiles?.display_name ?? 'Unknown',
    teamId:   l.team_id ?? null,
    teamName: l.team_id ? (teamMap.get(l.team_id) ?? null) : null,
  }));

  const planIds = (planRows ?? []).map((p: any) => p.id as string);
  const empIds  = employees.map(e => e.id);

  const planToProgram: Record<string, string> = {};
  const programSet = new Set<string>();
  for (const p of (planRows ?? [])) { planToProgram[p.id as string] = p.name as string; programSet.add(p.name as string); }
  const numPrograms = programSet.size;

  if (!empIds.length || !planIds.length) {
    return { individual: [], teamRows: [], hasTeams: teams.length > 0, employeeCount: employees.length, numPrograms: 0, employeeIds: empIds };
  }

  const planFilter = `(${planIds.join(',')})`;

  const [{ data: periodData }, { data: streakData }] = await Promise.all([
    client.from('synced_workouts')
      .select('user_id, date, data')
      .in('user_id', empIds)
      .filter('data->>planId', 'in', planFilter)
      .gte('date', fromDate)
      .lte('date', toDate),
    // 60-day window for current streak
    client.from('synced_workouts')
      .select('user_id, date')
      .in('user_id', empIds)
      .filter('data->>planId', 'in', planFilter)
      .gte('date', new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10)),
  ]);

  const periodMap:  Record<string, string[]> = {};
  const streakMap:  Record<string, string[]> = {};
  const ratingsMap: Record<string, { effSum: number; effCount: number; enjSum: number; enjCount: number }> = {};
  const repsMap:    Record<string, number> = {};
  const durMap:     Record<string, number> = {};
  const empDayProg: Record<string, Record<string, Set<string>>> = {};
  for (const e of employees) {
    periodMap[e.id]  = [];
    streakMap[e.id]  = [];
    ratingsMap[e.id] = { effSum: 0, effCount: 0, enjSum: 0, enjCount: 0 };
    repsMap[e.id]    = 0;
    durMap[e.id]     = 0;
    empDayProg[e.id] = {};
  }
  for (const w of (periodData ?? [])) {
    periodMap[w.user_id]?.push(w.date);
    const r = ratingsMap[w.user_id];
    if (r) {
      const eff = typeof w.data?.effectivenessRating === 'number' ? w.data.effectivenessRating : null;
      const enj = typeof w.data?.enjoymentRating === 'number' ? w.data.enjoymentRating : null;
      if (eff !== null) { r.effSum += eff; r.effCount++; }
      if (enj !== null) { r.enjSum += enj; r.enjCount++; }
      for (const ex of (w.data?.exercises ?? [])) {
        for (const s of (ex.sets ?? [])) {
          repsMap[w.user_id] += (s.reps ?? 0) + ((s as any).leftReps ?? 0) + ((s as any).rightReps ?? 0);
          durMap[w.user_id]  += (s.duration ?? 0) + ((s as any).cardioduration ?? 0);
        }
      }
    }
    const planId  = w.data?.planId as string | undefined;
    const progName = planId ? planToProgram[planId] : undefined;
    if (progName && empDayProg[w.user_id]) {
      if (!empDayProg[w.user_id][w.date]) empDayProg[w.user_id][w.date] = new Set();
      empDayProg[w.user_id][w.date].add(progName);
    }
  }
  for (const w of (streakData ?? [])) streakMap[w.user_id]?.push(w.date);

  const approvedOffMap: Record<string, string[]> = {};
  for (const r of (offRows ?? [])) {
    if (!approvedOffMap[r.employee_id]) approvedOffMap[r.employee_id] = [];
    approvedOffMap[r.employee_id].push(...expandDateRange(r.start_date, r.end_date));
  }

  const individual: IndividualRow[] = employees
    .map(emp => {
      const rm = ratingsMap[emp.id];
      const fullProgramDays = numPrograms > 1
        ? Object.values(empDayProg[emp.id] ?? {}).filter(s => s.size >= numPrograms).length
        : 0;
      return {
        rank:             0,
        name:             emp.name,
        teamName:         emp.teamName,
        count:            periodMap[emp.id].length,
        streak:           calcStreak(streakMap[emp.id], scheduleType, workDays, approvedOffMap[emp.id] ?? []),
        avgEffectiveness: rm.effCount > 0 ? rm.effSum / rm.effCount : null,
        avgEnjoyment:     rm.enjCount > 0 ? rm.enjSum / rm.enjCount : null,
        totalReps:        repsMap[emp.id] ?? 0,
        totalDurationSecs: durMap[emp.id] ?? 0,
        fullProgramDays,
      };
    })
    .sort((a, b) => b.count - a.count || b.streak - a.streak)
    .map((r, i) => ({ ...r, rank: i + 1 }));

  const teamRows: TeamRow[] = teams
    .map(team => {
      const members = employees.filter(e => e.teamId === team.id);
      const counts  = members.map(m => periodMap[m.id].length);
      return {
        rank:    0,
        name:    team.name,
        total:   counts.reduce((s, c) => s + c, 0),
        active:  counts.filter(c => c > 0).length,
        members: members.length,
      };
    })
    .sort((a, b) => b.total - a.total)
    .map((r, i) => ({ ...r, rank: i + 1 }));

  return { individual, teamRows, hasTeams: teams.length > 0, employeeCount: employees.length, numPrograms, employeeIds: empIds };
}

// ── Email HTML builders ───────────────────────────────────────────────────────

function medal(rank: number) {
  return rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `#${rank}`;
}

function fmtDuration(secs: number): string {
  if (secs <= 0) return '0m';
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function buildSpotlights(rows: IndividualRow[], numPrograms: number): string {
  if (!rows.length) return '';

  const awards: { icon: string; title: string; winner: string; sub: string }[] = [];

  if (numPrograms > 1) {
    const champion = rows.slice().sort((a, b) => b.fullProgramDays - a.fullProgramDays)[0];
    if (champion && champion.fullProgramDays > 0) {
      awards.push({
        icon:   '🏆',
        title:  'Program Champion',
        winner: champion.name,
        sub:    `${champion.fullProgramDays} day${champion.fullProgramDays > 1 ? 's' : ''} completing all ${numPrograms} programs`,
      });
    }
  }

  const repKing = rows.slice().sort((a, b) => b.totalReps - a.totalReps)[0];
  if (repKing && repKing.totalReps > 0) {
    awards.push({
      icon:   '💪',
      title:  'Rep Machine',
      winner: repKing.name,
      sub:    `${repKing.totalReps.toLocaleString()} total reps`,
    });
  }

  const timeKing = rows.slice().sort((a, b) => b.totalDurationSecs - a.totalDurationSecs)[0];
  if (timeKing && timeKing.totalDurationSecs > 0) {
    awards.push({
      icon:   '⏱️',
      title:  'Most Active',
      winner: timeKing.name,
      sub:    `${fmtDuration(timeKing.totalDurationSecs)} of timed exercises`,
    });
  }

  if (!awards.length) return '';

  return `
    <p style="margin:32px 0 12px;font-size:11px;font-weight:700;color:#FFD700;text-transform:uppercase;letter-spacing:0.08em;">Spotlight Awards ✨</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border-radius:12px;overflow:hidden;border:1px solid rgba(255,215,0,0.25);background:rgba(255,215,0,0.04);margin-bottom:8px;">
      <tbody>
        ${awards.map((a, i) => `
        <tr style="${i > 0 ? 'border-top:1px solid rgba(255,215,0,0.15);' : ''}">
          <td style="padding:14px 16px;font-size:22px;width:44px;">${a.icon}</td>
          <td style="padding:14px 8px;">
            <div style="font-size:11px;font-weight:700;color:#FFD700;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:2px;">${a.title}</div>
            <div style="font-size:15px;font-weight:800;color:#f0f0f0;">${esc(a.winner)}</div>
            <div style="font-size:12px;color:#9ca3af;margin-top:2px;">${a.sub}</div>
          </td>
        </tr>`).join('')}
      </tbody>
    </table>`;
}

function buildIndividualRows(rows: IndividualRow[], showTeam: boolean, showStreak: boolean, showRatings = false, numPrograms = 0) {
  const showFullDays = numPrograms > 1;
  return rows.map(r => {
    const lastPad = showRatings || showFullDays ? 'padding:11px 8px' : 'padding:11px 14px 11px 8px';
    const streakPad = showRatings || showFullDays ? 'padding:11px 8px' : lastPad;
    return `
    <tr style="border-top:1px solid #2a2a3a;">
      <td style="padding:11px 14px;font-size:${r.rank <= 3 ? 16 : 13}px;">${medal(r.rank)}</td>
      <td style="padding:11px 8px;font-size:14px;font-weight:600;color:#f0f0f0;">${esc(r.name)}</td>
      ${showTeam ? `<td style="padding:11px 8px;font-size:13px;color:#6b7280;">${r.teamName ? esc(r.teamName) : '—'}</td>` : ''}
      <td style="padding:11px 8px;font-size:15px;font-weight:700;color:#1EDBA8;text-align:center;">${r.count}</td>
      ${showStreak ? `<td style="${streakPad};font-size:13px;color:${r.streak > 0 ? '#F97316' : '#6b7280'};text-align:center;">${r.streak > 0 ? `🔥 ${r.streak}d` : '—'}</td>` : ''}
      ${showFullDays ? `<td style="padding:11px 8px;font-size:13px;color:${r.fullProgramDays > 0 ? '#FFD700' : '#6b7280'};text-align:center;">${r.fullProgramDays > 0 ? `⭐ ${r.fullProgramDays}` : '—'}</td>` : ''}
      ${showRatings ? `
      <td style="padding:11px 8px;font-size:13px;color:${r.avgEffectiveness !== null ? '#f0f0f0' : '#6b7280'};text-align:center;">${r.avgEffectiveness !== null ? r.avgEffectiveness.toFixed(1) : '—'}</td>
      <td style="padding:11px 14px 11px 8px;font-size:13px;color:${r.avgEnjoyment !== null ? '#f0f0f0' : '#6b7280'};text-align:center;">${r.avgEnjoyment !== null ? r.avgEnjoyment.toFixed(1) : '—'}</td>` : ''}
    </tr>`;
  }).join('');
}

function buildTeamSection(teamRows: TeamRow[]) {
  if (!teamRows.length) return '';
  return `
    <p style="margin:32px 0 12px;font-size:11px;font-weight:700;color:#1EDBA8;text-transform:uppercase;letter-spacing:0.08em;">Team Standings</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border-radius:12px;overflow:hidden;border:1px solid #2a2a3a;">
      <thead>
        <tr style="background:#1e1e30;">
          <th style="padding:10px 14px;font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:0.06em;text-align:left;"></th>
          <th style="padding:10px 8px;font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:0.06em;text-align:left;">Team</th>
          <th style="padding:10px 8px;font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:0.06em;text-align:center;">Workouts</th>
          <th style="padding:10px 14px 10px 8px;font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:0.06em;text-align:center;">Active</th>
        </tr>
      </thead>
      <tbody style="background:#0f1117;">
        ${teamRows.map(t => `
          <tr style="border-top:1px solid #2a2a3a;">
            <td style="padding:12px 14px;font-size:${t.rank <= 3 ? 16 : 13}px;">${medal(t.rank)}</td>
            <td style="padding:12px 8px;font-size:14px;font-weight:700;color:#f0f0f0;">${esc(t.name)}</td>
            <td style="padding:12px 8px;font-size:15px;font-weight:700;color:#1EDBA8;text-align:center;">${t.total}</td>
            <td style="padding:12px 14px 12px 8px;font-size:13px;color:#6b7280;text-align:center;">${t.active}/${t.members}</td>
          </tr>`).join('')}
      </tbody>
    </table>`;
}

function buildTeamWeeklyHtml(
  company:  string,
  fromDate: string,
  toDate:   string,
  data:     LbData,
): string {
  const { individual, hasTeams, numPrograms } = data;
  const totalWorkouts = individual.reduce((s, r) => s + r.count, 0);
  const activeMembers = individual.filter(r => r.count > 0).length;
  const totalReps     = individual.reduce((s, r) => s + r.totalReps, 0);
  const totalDurSecs  = individual.reduce((s, r) => s + r.totalDurationSecs, 0);

  const thead = `
    <thead>
      <tr style="background:#1e1e30;">
        <th style="padding:10px 14px;font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:0.06em;text-align:left;"></th>
        <th style="padding:10px 8px;font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:0.06em;text-align:left;">Name</th>
        ${hasTeams ? '<th style="padding:10px 8px;font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:0.06em;text-align:left;">Team</th>' : ''}
        <th style="padding:10px 8px;font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:0.06em;text-align:center;">Workouts</th>
        <th style="padding:10px 8px;font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:0.06em;text-align:center;">Streak</th>
        ${numPrograms > 1 ? '<th style="padding:10px 14px 10px 8px;font-size:11px;font-weight:700;color:#FFD700;text-transform:uppercase;letter-spacing:0.06em;text-align:center;">All Done</th>' : ''}
      </tr>
    </thead>`;

  const content = `
    <p style="margin:0 0 6px;font-size:12px;font-weight:700;color:#1EDBA8;text-transform:uppercase;letter-spacing:0.08em;">Weekly Update</p>
    <h1 style="margin:0 0 6px;font-size:24px;font-weight:800;color:#f0f0f0;">Your Team This Week 💪</h1>
    <p style="margin:0 0 28px;font-size:14px;color:#6b7280;">${esc(company)} · ${fmtShort(fromDate)} – ${fmtDate(toDate)}</p>

    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:16px;">
      <tr>
        <td style="background:#0f1117;border:1px solid #2a2a3a;border-radius:12px;padding:18px;text-align:center;">
          <div style="font-size:32px;font-weight:900;color:#1EDBA8;">${totalWorkouts}</div>
          <div style="font-size:12px;color:#6b7280;margin-top:4px;">Total Workouts</div>
        </td>
        <td width="12"></td>
        <td style="background:#0f1117;border:1px solid #2a2a3a;border-radius:12px;padding:18px;text-align:center;">
          <div style="font-size:32px;font-weight:900;color:#C471ED;">${activeMembers}</div>
          <div style="font-size:12px;color:#6b7280;margin-top:4px;">Active Members</div>
        </td>
      </tr>
    </table>

    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:32px;">
      <tr>
        <td style="background:#0f1117;border:1px solid #2a2a3a;border-radius:12px;padding:18px;text-align:center;">
          <div style="font-size:28px;font-weight:900;color:#F97316;">${totalReps > 0 ? totalReps.toLocaleString() : '—'}</div>
          <div style="font-size:12px;color:#6b7280;margin-top:4px;">Team Total Reps 💪</div>
        </td>
        <td width="12"></td>
        <td style="background:#0f1117;border:1px solid #2a2a3a;border-radius:12px;padding:18px;text-align:center;">
          <div style="font-size:28px;font-weight:900;color:#818CF8;">${totalDurSecs > 0 ? fmtDuration(totalDurSecs) : '—'}</div>
          <div style="font-size:12px;color:#6b7280;margin-top:4px;">Team Exercise Time ⏱️</div>
        </td>
      </tr>
    </table>

    ${buildSpotlights(individual, numPrograms)}

    <p style="margin:32px 0 12px;font-size:11px;font-weight:700;color:#1EDBA8;text-transform:uppercase;letter-spacing:0.08em;">Leaderboard</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border-radius:12px;overflow:hidden;border:1px solid #2a2a3a;">
      ${thead}
      <tbody style="background:#0f1117;">
        ${buildIndividualRows(individual, hasTeams, true, false, numPrograms)}
      </tbody>
    </table>`;

  return emailShell(content, `Shared by ${esc(company)} via LiftLog. Reply to your employer to unsubscribe from team reports.`);
}

function emailShell(content: string, footerNote: string) {
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
          ${content}
        </td></tr>

        <tr><td style="padding-top:28px;text-align:center;">
          <p style="margin:0;font-size:12px;color:#4b5563;line-height:1.6;">
            ${footerNote}<br>
            &copy; ${new Date().getFullYear()} LiftLog
          </p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function buildWeeklyHtml(
  company:  string,
  fromDate: string,
  toDate:   string,
  programs: { name: string }[],
  data:     LbData,
): string {
  const { individual, teamRows, hasTeams, numPrograms } = data;
  const totalWorkouts  = individual.reduce((s, r) => s + r.count, 0);
  const activeMembers  = individual.filter(r => r.count > 0).length;
  const topRow         = individual[0];
  const totalReps      = individual.reduce((s, r) => s + r.totalReps, 0);
  const totalDurSecs   = individual.reduce((s, r) => s + r.totalDurationSecs, 0);
  const programLine    = programs.length
    ? `Active program${programs.length > 1 ? 's' : ''}: <strong style="color:#f0f0f0;">${programs.map(p => esc(p.name)).join(', ')}</strong>`
    : '';

  const thead = `
    <thead>
      <tr style="background:#1e1e30;">
        <th style="padding:10px 14px;font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:0.06em;text-align:left;"></th>
        <th style="padding:10px 8px;font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:0.06em;text-align:left;">Name</th>
        ${hasTeams ? '<th style="padding:10px 8px;font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:0.06em;text-align:left;">Team</th>' : ''}
        <th style="padding:10px 8px;font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:0.06em;text-align:center;">Workouts</th>
        <th style="padding:10px 8px;font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:0.06em;text-align:center;">Streak</th>
        ${numPrograms > 1 ? '<th style="padding:10px 8px;font-size:11px;font-weight:700;color:#FFD700;text-transform:uppercase;letter-spacing:0.06em;text-align:center;">All Done</th>' : ''}
        <th style="padding:10px 8px;font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:0.06em;text-align:center;">Effectiveness</th>
        <th style="padding:10px 14px 10px 8px;font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:0.06em;text-align:center;">Enjoyment</th>
      </tr>
    </thead>`;

  const content = `
    <p style="margin:0 0 6px;font-size:12px;font-weight:700;color:#1EDBA8;text-transform:uppercase;letter-spacing:0.08em;">Weekly Report</p>
    <h1 style="margin:0 0 6px;font-size:24px;font-weight:800;color:#f0f0f0;">Performance Update 🏆</h1>
    <p style="margin:0 0 24px;font-size:14px;color:#6b7280;">${esc(company)} · ${fmtShort(fromDate)} – ${fmtDate(toDate)}</p>
    ${programLine ? `<p style="margin:0 0 28px;font-size:13px;color:#9ca3af;">${programLine}</p>` : ''}

    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:16px;">
      <tr>
        <td style="background:#0f1117;border:1px solid #2a2a3a;border-radius:12px;padding:18px;text-align:center;">
          <div style="font-size:32px;font-weight:900;color:#1EDBA8;">${totalWorkouts}</div>
          <div style="font-size:12px;color:#6b7280;margin-top:4px;">Total Workouts</div>
        </td>
        <td width="12"></td>
        <td style="background:#0f1117;border:1px solid #2a2a3a;border-radius:12px;padding:18px;text-align:center;">
          <div style="font-size:32px;font-weight:900;color:#C471ED;">${activeMembers}</div>
          <div style="font-size:12px;color:#6b7280;margin-top:4px;">Active Members</div>
        </td>
        <td width="12"></td>
        <td style="background:#0f1117;border:1px solid #2a2a3a;border-radius:12px;padding:18px;text-align:center;">
          <div style="font-size:22px;font-weight:900;color:#f0f0f0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${topRow ? esc(topRow.name.split(' ')[0]) : '—'}</div>
          <div style="font-size:12px;color:#6b7280;margin-top:4px;">Top Performer</div>
        </td>
      </tr>
    </table>

    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:32px;">
      <tr>
        <td style="background:#0f1117;border:1px solid #2a2a3a;border-radius:12px;padding:18px;text-align:center;">
          <div style="font-size:28px;font-weight:900;color:#F97316;">${totalReps > 0 ? totalReps.toLocaleString() : '—'}</div>
          <div style="font-size:12px;color:#6b7280;margin-top:4px;">Team Total Reps 💪</div>
        </td>
        <td width="12"></td>
        <td style="background:#0f1117;border:1px solid #2a2a3a;border-radius:12px;padding:18px;text-align:center;">
          <div style="font-size:28px;font-weight:900;color:#818CF8;">${totalDurSecs > 0 ? fmtDuration(totalDurSecs) : '—'}</div>
          <div style="font-size:12px;color:#6b7280;margin-top:4px;">Team Exercise Time ⏱️</div>
        </td>
      </tr>
    </table>

    ${buildSpotlights(individual, numPrograms)}

    <p style="margin:32px 0 12px;font-size:11px;font-weight:700;color:#1EDBA8;text-transform:uppercase;letter-spacing:0.08em;">Individual Rankings</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border-radius:12px;overflow:hidden;border:1px solid #2a2a3a;">
      ${thead}
      <tbody style="background:#0f1117;">
        ${buildIndividualRows(individual, hasTeams, true, true, numPrograms)}
      </tbody>
    </table>

    ${buildTeamSection(teamRows)}

    <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:32px;">
      <tr>
        <td align="center">
          <a href="${APP_URL}/leaderboard"
             style="display:inline-block;background:#1EDBA8;color:#0f1117;font-size:15px;font-weight:800;text-decoration:none;padding:14px 36px;border-radius:12px;">
            View Full Leaderboard &rarr;
          </a>
        </td>
      </tr>
    </table>`;

  return emailShell(content, 'Sent every Sunday. You\'re receiving this as an employer on LiftLog.');
}

function buildRecapHtml(
  company: string,
  program: { name: string; started_at: string; ends_at: string },
  data:    LbData,
): string {
  const { individual, teamRows, hasTeams, numPrograms } = data;
  const totalWorkouts = individual.reduce((s, r) => s + r.count, 0);
  const activeMembers = individual.filter(r => r.count > 0).length;
  const top3          = individual.slice(0, 3);
  const rest          = individual.slice(3);

  const topThead = `
    <thead>
      <tr style="background:#1e1e30;">
        <th style="padding:10px 14px;font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;text-align:left;"></th>
        <th style="padding:10px 8px;font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;text-align:left;">Name</th>
        ${hasTeams ? '<th style="padding:10px 8px;font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;text-align:left;">Team</th>' : ''}
        <th style="padding:10px 14px 10px 8px;font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;text-align:center;">Total Workouts</th>
      </tr>
    </thead>`;

  const content = `
    <p style="margin:0 0 6px;font-size:12px;font-weight:700;color:#FFD700;text-transform:uppercase;letter-spacing:0.08em;">Program Complete 🎉</p>
    <h1 style="margin:0 0 6px;font-size:24px;font-weight:800;color:#f0f0f0;">${esc(program.name)}</h1>
    <p style="margin:0 0 28px;font-size:14px;color:#6b7280;">${esc(company)} · ${fmtDate(program.started_at)} – ${fmtDate(program.ends_at)}</p>

    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:32px;">
      <tr>
        <td style="background:#0f1117;border:1px solid #2a2a3a;border-radius:12px;padding:18px;text-align:center;">
          <div style="font-size:32px;font-weight:900;color:#1EDBA8;">${totalWorkouts}</div>
          <div style="font-size:12px;color:#6b7280;margin-top:4px;">Total Workouts</div>
        </td>
        <td width="12"></td>
        <td style="background:#0f1117;border:1px solid #2a2a3a;border-radius:12px;padding:18px;text-align:center;">
          <div style="font-size:32px;font-weight:900;color:#C471ED;">${activeMembers}</div>
          <div style="font-size:12px;color:#6b7280;margin-top:4px;">Participants</div>
        </td>
        <td width="12"></td>
        <td style="background:#0f1117;border:1px solid rgba(255,215,0,0.4);border-radius:12px;padding:18px;text-align:center;">
          <div style="font-size:32px;font-weight:900;color:#FFD700;">${individual[0]?.count ?? 0}</div>
          <div style="font-size:12px;color:#6b7280;margin-top:4px;">Top Score</div>
        </td>
      </tr>
    </table>

    ${buildSpotlights(individual, numPrograms)}

    ${top3.length ? `
    <p style="margin:32px 0 12px;font-size:11px;font-weight:700;color:#FFD700;text-transform:uppercase;letter-spacing:0.08em;">Top Performers</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border-radius:12px;overflow:hidden;border:1px solid rgba(255,215,0,0.25);background:rgba(255,215,0,0.04);margin-bottom:${rest.length ? 16 : 0}px;">
      ${topThead}
      <tbody>
        ${buildIndividualRows(top3, hasTeams, false)}
      </tbody>
    </table>` : ''}

    ${rest.length ? `
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border-radius:12px;overflow:hidden;border:1px solid #2a2a3a;">
      <tbody style="background:#0f1117;">
        ${buildIndividualRows(rest, hasTeams, false)}
      </tbody>
    </table>` : ''}

    ${buildTeamSection(teamRows)}

    <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:32px;">
      <tr>
        <td align="center">
          <a href="${APP_URL}/programs"
             style="display:inline-block;background:#1EDBA8;color:#0f1117;font-size:15px;font-weight:800;text-decoration:none;padding:14px 36px;border-radius:12px;">
            Launch Next Program &rarr;
          </a>
        </td>
      </tr>
    </table>`;

  return emailShell(content, 'Sent automatically when a program ends. You\'re registered as an employer on LiftLog.');
}

// ── GET — Vercel Cron (every Sunday at 20:00 UTC) ────────────────────────────

export async function GET(req: NextRequest) {
  const auth   = req.headers.get('authorization') ?? '';
  const secret = (process.env.CRON_SECRET ?? '').trim();
  if (!secret || auth.trim() !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const client   = sbAdmin();
  const resend   = new Resend(process.env.RESEND_API_KEY);
  const today    = new Date();
  const todayStr = today.toISOString().slice(0, 10);
  const sevenAgo = new Date(today.getTime() - 7 * 86400000).toISOString().slice(0, 10);

  const [{ data: activeProgs }, { data: endedProgs }] = await Promise.all([
    client.from('employer_programs')
      .select('id, employer_id, name, started_at, ends_at, schedule_type, work_days')
      .lte('started_at', todayStr)
      .gte('ends_at', todayStr),
    // Programs that ended since last Sunday's run
    client.from('employer_programs')
      .select('id, employer_id, name, started_at, ends_at, schedule_type, work_days')
      .gte('ends_at', sevenAgo)
      .lt('ends_at', todayStr),
  ]);

  const allEmployerIds = [...new Set([
    ...(activeProgs ?? []).map((p: any) => p.employer_id as string),
    ...(endedProgs  ?? []).map((p: any) => p.employer_id as string),
  ])];

  if (!allEmployerIds.length) {
    return NextResponse.json({ sent: 0, reason: 'No employers with programs' });
  }

  const { data: profiles } = await client
    .from('profiles')
    .select('id, company_name, include_team_in_report')
    .in('id', allEmployerIds);

  const profileMap = new Map((profiles ?? []).map((p: any) => [p.id as string, p]));

  let weekSent = 0, weekFailed = 0, recapSent = 0, recapFailed = 0;

  for (const employerId of allEmployerIds) {
    const { data: userRes } = await client.auth.admin.getUserById(employerId);
    const email = userRes?.user?.email;
    if (!email) continue;

    const company = (profileMap.get(employerId)?.company_name as string | null) ?? 'Your Company';

    // Weekly summary for active programs
    const empActive = (activeProgs ?? []).filter((p: any) => p.employer_id === employerId);
    if (empActive.length > 0) {
      const schedType = (empActive[0].schedule_type as string) ?? 'fixed';
      const wDays     = (empActive[0].work_days as number[]) ?? [1, 2, 3, 4, 5];
      const data = await fetchLeaderboard(employerId, sevenAgo, todayStr, client, schedType, wDays);
      if (data.employeeCount > 0) {
        const subject = `Weekly Performance Report — ${company} — Week of ${fmtDate(sevenAgo)}`;
        const { error } = await resend.emails.send({
          from:    FROM,
          to:      email,
          subject,
          html:    buildWeeklyHtml(company, sevenAgo, todayStr, empActive, data),
        });
        if (error) { console.error('Weekly send failed', employerId, error); weekFailed++; }
        else {
          weekSent++;
          if (profileMap.get(employerId)?.include_team_in_report && data.employeeIds.length) {
            const teamSubject = `Your Team's Leaderboard — ${company} — Week of ${fmtDate(sevenAgo)}`;
            const teamHtml    = buildTeamWeeklyHtml(company, sevenAgo, todayStr, data);
            for (const empId of data.employeeIds) {
              const { data: empUser } = await client.auth.admin.getUserById(empId);
              const empEmail = empUser?.user?.email;
              if (empEmail) await resend.emails.send({ from: FROM, to: empEmail, subject: teamSubject, html: teamHtml });
            }
          }
        }
      }
    }

    // Recap for recently ended programs
    const empEnded = (endedProgs ?? []).filter((p: any) => p.employer_id === employerId);
    for (const prog of empEnded) {
      const schedType = (prog.schedule_type as string) ?? 'fixed';
      const wDays     = (prog.work_days as number[]) ?? [1, 2, 3, 4, 5];
      const data = await fetchLeaderboard(employerId, prog.started_at, prog.ends_at, client, schedType, wDays);
      if (data.employeeCount > 0) {
        const subject = `Program Recap — ${prog.name} — Final Results`;
        const { error } = await resend.emails.send({
          from:    FROM,
          to:      email,
          subject,
          html:    buildRecapHtml(company, prog, data),
        });
        if (error) { console.error('Recap send failed', prog.id, error); recapFailed++; }
        else recapSent++;
      }
    }
  }

  return NextResponse.json({ weekSent, weekFailed, recapSent, recapFailed });
}

const postBodySchema = z.object({
  period:      z.enum(['7d', '1m', '4m']).default('1m'),
  includeTeam: z.boolean().optional(),
});

// ── POST — On-demand from the Leaderboard page ───────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const token = req.headers.get('authorization')?.replace('Bearer ', '');
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    // Pass the token explicitly — server-side clients have no local session
    const client = sbUser(token);
    const { data: { user }, error: authErr } = await client.auth.getUser(token);
    if (authErr || !user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const rl = rateLimit(`weekly-report:${user.id}`, 20, 60 * 60 * 1000);
    if (!rl.allowed) return NextResponse.json({ error: 'Too many requests' }, { status: 429 });

    const parsed = postBodySchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
    const { period, includeTeam } = parsed.data;

    const { data: prof } = await client
      .from('profiles')
      .select('role, is_employer, company_name')
      .eq('id', user.id)
      .single();

    if (!prof?.is_employer) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const today    = new Date();
    const todayStr = today.toISOString().slice(0, 10);
    let fromDate: string;
    if (period === '7d')      fromDate = new Date(today.getTime() - 7 * 86400000).toISOString().slice(0, 10);
    else if (period === '4m') fromDate = new Date(today.getFullYear(), today.getMonth() - 4, today.getDate()).toISOString().slice(0, 10);
    else                      fromDate = new Date(today.getFullYear(), today.getMonth() - 1, today.getDate()).toISOString().slice(0, 10);

    const company = (prof.company_name as string | null) ?? 'Your Company';

    const { data: activeSched } = await client
      .from('employer_programs')
      .select('schedule_type, work_days')
      .eq('employer_id', user.id)
      .lte('started_at', todayStr)
      .gte('ends_at', todayStr)
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const schedType = (activeSched?.schedule_type as string) ?? 'fixed';
    const wDays     = (activeSched?.work_days as number[]) ?? [1, 2, 3, 4, 5];
    const data      = await fetchLeaderboard(user.id, fromDate, todayStr, client, schedType, wDays);

    if (data.employeeCount === 0) {
      return NextResponse.json({ error: 'No employees found.' }, { status: 400 });
    }

    const { data: activeProgs } = await client
      .from('employer_programs')
      .select('name')
      .eq('employer_id', user.id)
      .lte('started_at', todayStr)
      .gte('ends_at', todayStr);

    const resend  = new Resend(process.env.RESEND_API_KEY);
    const subject = `Leaderboard Report — ${company} — ${fmtShort(fromDate)} to ${fmtDate(todayStr)}`;
    const { error } = await resend.emails.send({
      from:  FROM,
      to:    user.email,
      subject,
      html:  buildWeeklyHtml(company, fromDate, todayStr, activeProgs ?? [], data),
    });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    let teamSent = 0;
    if (includeTeam && data.employeeIds.length) {
      const admin = sbAdmin();
      const teamSubject = `Your Team's Leaderboard — ${company} — ${fmtShort(fromDate)} to ${fmtDate(todayStr)}`;
      const teamHtml    = buildTeamWeeklyHtml(company, fromDate, todayStr, data);
      for (const empId of data.employeeIds) {
        const { data: empUser } = await admin.auth.admin.getUserById(empId);
        const empEmail = empUser?.user?.email;
        if (!empEmail) continue;
        const { error: teamErr } = await resend.emails.send({ from: FROM, to: empEmail, subject: teamSubject, html: teamHtml });
        if (!teamErr) teamSent++;
      }
    }

    return NextResponse.json({ sent: true, to: user.email, teamSent });
  } catch (e: any) {
    console.error('[weekly-leaderboard-report POST]', e);
    return NextResponse.json({ error: e?.message ?? 'Internal server error' }, { status: 500 });
  }
}
