'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { getSupabase } from '@/lib/supabase';
import { Mail, Upload, AlertTriangle, Info } from 'lucide-react';

const TEAL   = '#1EDBA8';
const PURPLE = '#C471ED';
const GOLD   = '#FFD700';
const SILVER = '#94A3B8';
const BRONZE = '#CD7F32';

type Period = '4m' | 'prog' | 'past';

interface Team {
  id: string;
  name: string;
}

interface Employee {
  id: string;
  name: string;
  teamId: string | null;
}

interface TeamEntry {
  team: Team;
  totalWorkouts: number;
  activeMembers: number;
  totalMembers: number;
  topPerformer: LeaderboardEntry | null;
}

interface LeaderboardEntry {
  employee: Employee;
  workoutCount: number;
  currentStreak: number;
  longestStreak: number;
  lastActive: string | null;
}

interface TimeOffRequest {
  id: string;
  employee_id: string;
  start_date: string;
  end_date: string;
  status: 'pending' | 'approved' | 'denied';
}

interface TopProgram {
  name: string;
  avgEffectiveness: number | null;
  avgEnjoyment: number | null;
  ratingCount: number;
}

interface PastProgram {
  id: string;
  name: string;
  started_at: string;
  ends_at: string;
}

function getPeriodStart(period: Period, progFrom?: string | null, pastFrom?: string | null): Date {
  const now = new Date();
  if (period === '4m') return new Date(now.getFullYear(), now.getMonth() - 4, now.getDate());
  if (period === 'prog' && progFrom) return new Date(progFrom + 'T00:00:00');
  if (period === 'past' && pastFrom) return new Date(pastFrom + 'T00:00:00');
  return new Date(now.getFullYear(), now.getMonth() - 4, now.getDate());
}

function computeProgramWeeks(progFrom: string, progTo?: string): Array<{ weekNum: number; from: string; to: string }> {
  const start = new Date(progFrom + 'T00:00:00');
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const bound = progTo ? new Date(progTo + 'T00:00:00') : today;
  const weeks: Array<{ weekNum: number; from: string; to: string }> = [];
  const cursor = new Date(start);
  let weekNum = 1;
  while (cursor <= bound) {
    const weekEnd = new Date(cursor);
    weekEnd.setDate(weekEnd.getDate() + 6);
    if (weekEnd > bound) weekEnd.setTime(bound.getTime());
    weeks.push({ weekNum, from: cursor.toISOString().slice(0, 10), to: weekEnd.toISOString().slice(0, 10) });
    cursor.setDate(cursor.getDate() + 7);
    weekNum++;
  }
  return weeks;
}

function expandDateRange(start: string, end: string): string[] {
  const out: string[] = [];
  const cursor = new Date(start + 'T00:00:00');
  const endDate = new Date(end   + 'T00:00:00');
  while (cursor <= endDate) { out.push(cursor.toISOString().slice(0, 10)); cursor.setDate(cursor.getDate() + 1); }
  return out;
}

function fmtDateShort(d: string) {
  return new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function calcCurrentStreakFixed(sortedDates: string[], workDays: number[], approvedOffDates: string[] = []): number {
  if (!sortedDates.length || !workDays.length) return 0;
  const dateSet = new Set(sortedDates);
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

function calcCurrentStreakFlexible(sortedDates: string[], approvedOffDates: string[] = []): number {
  if (!sortedDates.length) return 0;
  const dateSet = new Set(sortedDates);
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

function calcCurrentStreak(sortedDates: string[], scheduleType = 'fixed', workDays: number[] = [1, 2, 3, 4, 5], approvedOffDates: string[] = []): number {
  return scheduleType === 'flexible'
    ? calcCurrentStreakFlexible(sortedDates, approvedOffDates)
    : calcCurrentStreakFixed(sortedDates, workDays, approvedOffDates);
}

function calcLongestStreak(sortedDates: string[]): number {
  if (!sortedDates.length) return 0;
  const unique = [...new Set(sortedDates)].sort();
  let longest = 1, current = 1;
  for (let i = 1; i < unique.length; i++) {
    const prev = new Date(unique[i - 1]).getTime();
    const curr = new Date(unique[i]).getTime();
    if (curr - prev === 86400000) {
      current++;
      if (current > longest) longest = current;
    } else {
      current = 1;
    }
  }
  return longest;
}

function Avatar({ name, size = 44 }: { name: string; size?: number }) {
  const initials = name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: `linear-gradient(135deg, ${TEAL}, ${PURPLE})`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: '#fff', fontWeight: 700, fontSize: size * 0.36,
      flexShrink: 0,
    }}>
      {initials}
    </div>
  );
}

function StatCard({ label, value, sub, accent }: { label: string; value: string | number; sub?: string; accent?: string }) {
  return (
    <div style={{
      background: 'var(--card)',
      border: `1px solid ${accent ?? 'var(--border)'}`,
      borderRadius: 16,
      padding: '24px 28px',
      display: 'flex', flexDirection: 'column', gap: 6,
      boxShadow: accent ? `0 0 20px ${accent}22` : '0 2px 8px #0002',
    }}>
      <div style={{ fontSize: 13, color: 'var(--text-muted)', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: 38, fontWeight: 800, color: accent ?? 'var(--text)', lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{sub}</div>}
    </div>
  );
}

function PodiumBlock({ entry, rank, height }: { entry: LeaderboardEntry; rank: 1 | 2 | 3; height: number }) {
  const color  = rank === 1 ? GOLD : rank === 2 ? SILVER : BRONZE;
  const medal  = rank === 1 ? '🥇' : rank === 2 ? '🥈' : '🥉';
  const glow   = rank === 1 ? `0 0 32px ${GOLD}66, 0 4px 24px #0004` : '0 2px 8px #0002';
  const border = rank === 1 ? `2px solid ${GOLD}` : `1px solid ${color}44`;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
      {rank === 1 && <div style={{ fontSize: 28 }}>👑</div>}
      <Avatar name={entry.employee.name} size={rank === 1 ? 60 : 48} />
      <div style={{ fontSize: rank === 1 ? 15 : 13, fontWeight: 700, color: 'var(--text)', textAlign: 'center', maxWidth: 120 }}>
        {entry.employee.name}
      </div>
      <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
        {entry.workoutCount} workout{entry.workoutCount !== 1 ? 's' : ''}
      </div>
      {entry.currentStreak > 0 && (
        <div style={{ fontSize: 12, color: TEAL, fontWeight: 600 }}>🔥 {entry.currentStreak}d streak</div>
      )}
      <div style={{
        width: rank === 1 ? 120 : 96,
        height,
        background: `linear-gradient(180deg, ${color}33 0%, ${color}11 100%)`,
        border,
        borderBottom: 'none',
        borderRadius: '10px 10px 0 0',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        boxShadow: glow,
        fontSize: 28,
      }}>
        {medal}
      </div>
    </div>
  );
}

export default function LeaderboardPage() {
  const router = useRouter();
  const [loading, setLoading]   = useState(true);
  const [period, setPeriod]     = useState<Period>('4m');
  const [lbView, setLbView]     = useState<'team' | 'individual'>('individual');
  const [companyName, setCompanyName] = useState('');
  const [teams, setTeams]             = useState<Team[]>([]);
  const [employees, setEmployees]     = useState<Employee[]>([]);
  const [allDates, setAllDates]       = useState<Record<string, string[]>>({});
  const [scheduleType, setScheduleType]   = useState<string>('fixed');
  const [workDays, setWorkDays]           = useState<number[]>([1, 2, 3, 4, 5]);
  const [sessionToken, setSessionToken]   = useState('');
  const [emailStatus, setEmailStatus]         = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [emailMsg, setEmailMsg]               = useState('');
  const [teamEmailStatus, setTeamEmailStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [teamEmailMsg, setTeamEmailMsg]       = useState('');
  const [userId, setUserId]               = useState('');
  const [timeOffRequests, setTimeOffRequests] = useState<TimeOffRequest[]>([]);
  const [approvedOffMap, setApprovedOffMap]   = useState<Record<string, string[]>>({});
  const [autoApprove, setAutoApprove]           = useState(false);
  const [includeTeamInReport, setIncludeTeamInReport] = useState(false);
  const [torExpanded, setTorExpanded]         = useState(false);
  const [hoveredRow, setHoveredRow]           = useState<string | null>(null);
  const [planMeta, setPlanMeta]               = useState<{ id: string; name: string }[]>([]);
  const [datesByPlan, setDatesByPlan]         = useState<Record<string, Record<string, string[]>>>({});
  const [programFilter, setProgramFilter]     = useState<string | null>(null);
  const [topProgram, setTopProgram]           = useState<TopProgram | null>(null);
  const [programDates, setProgramDates]       = useState<{ from: string } | null>(null);
  const [selectedWeeks, setSelectedWeeks]     = useState<number[]>([]);
  const [pastPrograms, setPastPrograms]       = useState<PastProgram[]>([]);
  const [selectedPastProgram, setSelectedPastProgram] = useState<PastProgram | null>(null);

  useEffect(() => {
    setEmailStatus('idle');
    setEmailMsg('');
    if (period !== 'prog' && period !== 'past') setSelectedWeeks([]);
  }, [period]);

  async function approveRequest(id: string) {
    const supabase = getSupabase();
    await supabase.from('time_off_requests').update({ status: 'approved' }).eq('id', id);
    setTimeOffRequests(prev => prev.map(r => r.id === id ? { ...r, status: 'approved' } : r));
    setApprovedOffMap(prev => {
      const req = timeOffRequests.find(r => r.id === id);
      if (!req) return prev;
      const next = { ...prev };
      if (!next[req.employee_id]) next[req.employee_id] = [];
      next[req.employee_id] = [...next[req.employee_id], ...expandDateRange(req.start_date, req.end_date)];
      return next;
    });
  }

  async function denyRequest(id: string) {
    const supabase = getSupabase();
    await supabase.from('time_off_requests').update({ status: 'denied' }).eq('id', id);
    setTimeOffRequests(prev => prev.filter(r => r.id !== id));
  }

  async function approveAll() {
    const supabase = getSupabase();
    const pending = timeOffRequests.filter(r => r.status === 'pending');
    if (!pending.length) return;
    await supabase.from('time_off_requests').update({ status: 'approved' }).in('id', pending.map(r => r.id));
    const nextOff = { ...approvedOffMap };
    for (const r of pending) {
      if (!nextOff[r.employee_id]) nextOff[r.employee_id] = [];
      nextOff[r.employee_id] = [...nextOff[r.employee_id], ...expandDateRange(r.start_date, r.end_date)];
    }
    setTimeOffRequests(prev => prev.map(r => r.status === 'pending' ? { ...r, status: 'approved' } : r));
    setApprovedOffMap(nextOff);
  }

  async function toggleAutoApprove() {
    const supabase = getSupabase();
    const next = !autoApprove;
    await supabase.from('profiles').update({ auto_approve_time_off: next }).eq('id', userId);
    setAutoApprove(next);
  }

  async function toggleIncludeTeam() {
    const supabase = getSupabase();
    const next = !includeTeamInReport;
    await supabase.from('profiles').update({ include_team_in_report: next }).eq('id', userId);
    setIncludeTeamInReport(next);
  }

  async function sendToTeam() {
    if (teamEmailStatus === 'sending' || !sessionToken) return;
    setTeamEmailStatus('sending');
    setTeamEmailMsg('');
    try {
      const res  = await fetch('/api/weekly-leaderboard-report', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionToken}` },
        body:    JSON.stringify({ period, includeTeam: true }),
      });
      const text = await res.text();
      let json: any;
      try { json = JSON.parse(text); } catch {
        console.error('[Team Report] HTTP', res.status, text.slice(0, 1000));
        setTeamEmailStatus('error');
        setTeamEmailMsg(`Server error (HTTP ${res.status}) — see browser console.`);
        return;
      }
      if (!res.ok) { setTeamEmailStatus('error'); setTeamEmailMsg(json.error ?? 'Failed to send.'); }
      else         { setTeamEmailStatus('sent');  setTeamEmailMsg(`Sent to ${json.teamSent} employee${json.teamSent !== 1 ? 's' : ''}`); }
    } catch (e) {
      console.error('[Team Report] fetch threw:', e);
      setTeamEmailStatus('error');
      setTeamEmailMsg('Could not reach the server.');
    }
  }

  async function sendReport() {
    if (emailStatus === 'sending' || !sessionToken) return;
    setEmailStatus('sending');
    setEmailMsg('');
    try {
      const res  = await fetch('/api/weekly-leaderboard-report', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionToken}` },
        body:    JSON.stringify({ period }),
      });
      const text = await res.text();
      let json: any;
      try { json = JSON.parse(text); } catch {
        console.error('[Email Report] HTTP', res.status, text.slice(0, 1000));
        setEmailStatus('error');
        setEmailMsg(`Server error (HTTP ${res.status}) — see browser console for details.`);
        return;
      }
      if (!res.ok) { setEmailStatus('error'); setEmailMsg(json.error ?? 'Failed to send.'); }
      else         { setEmailStatus('sent');  setEmailMsg(`Sent to ${json.to}`); }
    } catch (e) {
      console.error('[Email Report] fetch threw:', e);
      setEmailStatus('error');
      setEmailMsg('Could not reach the server.');
    }
  }

  useEffect(() => {
    (async () => {
      const supabase = getSupabase();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.replace('/login'); return; }
      setSessionToken(session.access_token);
      const user = session.user;

      setUserId(user.id);

      const { data: prof } = await supabase
        .from('profiles')
        .select('role, is_employer, company_name, auto_approve_time_off, include_team_in_report')
        .eq('id', user.id)
        .single();

      if (!prof || prof.role !== 'practitioner' || !prof.is_employer) {
        router.replace('/plans');
        return;
      }
      setCompanyName(prof.company_name ?? 'Your Company');
      setAutoApprove(!!(prof as any).auto_approve_time_off);
      setIncludeTeamInReport(!!(prof as any).include_team_in_report);

      const todayStr = new Date().toISOString().slice(0, 10);
      const [{ data: links }, { data: teamsData }, { data: planRows }, { data: activeSched }, { data: torRows }] = await Promise.all([
        supabase.from('patient_links').select('patient_id, team_id, profiles!patient_links_patient_id_fkey(display_name)').eq('practitioner_id', user.id),
        supabase.from('employer_teams').select('id, name').eq('employer_id', user.id).order('name'),
        supabase.from('workout_plans').select('id, name').eq('practitioner_id', user.id),
        supabase.from('employer_programs').select('schedule_type, work_days, started_at').eq('employer_id', user.id).lte('started_at', todayStr).gte('ends_at', todayStr).order('started_at', { ascending: false }).limit(1).maybeSingle(),
        supabase.from('time_off_requests').select('id, employee_id, start_date, end_date, status').eq('employer_id', user.id).in('status', ['pending', 'approved']).order('start_date', { ascending: false }),
      ]);

      const torList = (torRows ?? []) as TimeOffRequest[];
      setTimeOffRequests(torList);

      const offMap: Record<string, string[]> = {};
      for (const r of torList.filter(r => r.status === 'approved')) {
        if (!offMap[r.employee_id]) offMap[r.employee_id] = [];
        offMap[r.employee_id].push(...expandDateRange(r.start_date, r.end_date));
      }
      setApprovedOffMap(offMap);

      const sched = activeSched as any;
      setScheduleType(sched?.schedule_type ?? 'fixed');
      setWorkDays(sched?.work_days ?? [1, 2, 3, 4, 5]);
      if (sched?.started_at) {
        setProgramDates({ from: sched.started_at as string });
        setPeriod('prog');
      }

      if (!links || links.length === 0) { setLoading(false); return; }
      setTeams((teamsData ?? []) as Team[]);

      const empList: Employee[] = links.map((l: any) => ({
        id: l.patient_id,
        name: l.profiles?.display_name ?? 'Unknown',
        teamId: l.team_id ?? null,
      }));
      setEmployees(empList);

      const metaList = (planRows ?? []).map((p: any) => ({ id: p.id as string, name: p.name as string }));
      setPlanMeta(metaList);
      const planIds = metaList.map(p => p.id);

      let workouts: { user_id: string; date: string; planId: string }[] = [];
      if (planIds.length > 0 && empList.length > 0) {
        const { data } = await supabase
          .from('synced_workouts')
          .select('user_id, date, data')
          .in('user_id', empList.map(e => e.id))
          .filter('data->>planId', 'in', `(${planIds.join(',')})`);
        workouts = (data ?? []).map((w: any) => ({
          user_id: w.user_id,
          date: w.date,
          planId: (w.data as any)?.planId ?? '',
        }));
      }

      const dateMap: Record<string, string[]> = {};
      const dbp: Record<string, Record<string, string[]>> = {};
      for (const emp of empList) dateMap[emp.id] = [];
      for (const pid of planIds) dbp[pid] = {};

      for (const w of workouts) {
        dateMap[w.user_id]?.push(w.date);
        if (w.planId && dbp[w.planId]) {
          if (!dbp[w.planId][w.user_id]) dbp[w.planId][w.user_id] = [];
          dbp[w.planId][w.user_id].push(w.date);
        }
      }

      setAllDates(dateMap);
      setDatesByPlan(dbp);
      setLoading(false);

      // Non-blocking: fetch past employer programs
      supabase.from('employer_programs')
        .select('id, started_at, ends_at')
        .eq('employer_id', user.id)
        .lt('ends_at', todayStr)
        .order('ends_at', { ascending: false })
        .then(({ data: pastProgsData }) => {
          if (!pastProgsData?.length) return;
          const past: PastProgram[] = (pastProgsData as any[]).map(p => {
            const f = new Date((p.started_at as string) + 'T12:00:00');
            const t = new Date((p.ends_at   as string) + 'T12:00:00');
            const fromLbl = f.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            const toLbl   = t.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
            return {
              id: p.id as string,
              name: `${fromLbl} – ${toLbl}`,
              started_at: p.started_at as string,
              ends_at:    p.ends_at    as string,
            };
          });
          setPastPrograms(past);
          setSelectedPastProgram(past[0]);
        });

      // Non-blocking: fetch highest rated program
      supabase.rpc('get_employer_program_ratings', { p_employer_id: user.id }).then(async ({ data: ratings }) => {
        if (!ratings || (ratings as any[]).length === 0) return;
        const top = (ratings as any[]).reduce((best: any, r: any) => {
          const scoreR    = (r.avg_effectiveness ? Number(r.avg_effectiveness) : 0) + (r.avg_enjoyment ? Number(r.avg_enjoyment) : 0);
          const scoreBest = (best.avg_effectiveness ? Number(best.avg_effectiveness) : 0) + (best.avg_enjoyment ? Number(best.avg_enjoyment) : 0);
          return scoreR > scoreBest ? r : best;
        });
        if (!top?.plan_template_id) return;
        const { data: tpl } = await supabase.from('plan_templates').select('name').eq('id', top.plan_template_id).single();
        if (!tpl?.name) return;
        setTopProgram({
          name:             tpl.name as string,
          avgEffectiveness: top.avg_effectiveness ? Number(top.avg_effectiveness) : null,
          avgEnjoyment:     top.avg_enjoyment     ? Number(top.avg_enjoyment)     : null,
          ratingCount:      Number(top.rating_count),
        });
      });
    })();
  }, [router]);

  const programs = useMemo(() => [...new Set(planMeta.map(p => p.name))].sort(), [planMeta]);

  const planIdsByProgram = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const p of planMeta) {
      if (!map[p.name]) map[p.name] = [];
      map[p.name].push(p.id);
    }
    return map;
  }, [planMeta]);

  const programWeeks = useMemo(() => {
    if (period === 'prog' && programDates) return computeProgramWeeks(programDates.from);
    if (period === 'past' && selectedPastProgram) return computeProgramWeeks(selectedPastProgram.started_at, selectedPastProgram.ends_at);
    return [];
  }, [period, programDates, selectedPastProgram]);

  const entries = useMemo<LeaderboardEntry[]>(() => {
    const start = getPeriodStart(period, programDates?.from, selectedPastProgram?.started_at);
    const startStr = start.toISOString().slice(0, 10);
    const endStr: string | null = period === 'past' ? (selectedPastProgram?.ends_at ?? null) : null;

    let allowedDateSet: Set<string> | null = null;
    if ((period === 'prog' || period === 'past') && selectedWeeks.length > 0) {
      allowedDateSet = new Set<string>();
      for (const w of programWeeks) {
        if (selectedWeeks.includes(w.weekNum)) {
          for (const d of expandDateRange(w.from, w.to)) allowedDateSet.add(d);
        }
      }
    }
    const allowed = allowedDateSet;

    return employees
      .map(emp => {
        let dates: string[];
        if (programFilter && planIdsByProgram[programFilter]) {
          const merged = new Set<string>();
          for (const pid of planIdsByProgram[programFilter]) {
            for (const d of datesByPlan[pid]?.[emp.id] ?? []) merged.add(d);
          }
          dates = [...merged];
        } else {
          dates = allDates[emp.id] ?? [];
        }
        const periodDates = allowed
          ? dates.filter(d => allowed.has(d))
          : endStr
          ? dates.filter(d => d >= startStr && d <= endStr)
          : dates.filter(d => d >= startStr);
        return {
          employee: emp,
          workoutCount: periodDates.length,
          currentStreak: calcCurrentStreak([...dates].sort(), scheduleType, workDays, approvedOffMap[emp.id] ?? []),
          longestStreak: calcLongestStreak([...periodDates].sort()),
          lastActive: dates.length ? [...dates].sort().at(-1)! : null,
        };
      })
      .sort((a, b) => b.workoutCount - a.workoutCount || b.currentStreak - a.currentStreak);
  }, [employees, allDates, datesByPlan, planIdsByProgram, programFilter, period, programDates, selectedPastProgram, programWeeks, selectedWeeks, scheduleType, workDays, approvedOffMap]);

  const totalWorkouts  = useMemo(() => entries.reduce((s, e) => s + e.workoutCount, 0), [entries]);
  const activeMembers  = useMemo(() => entries.filter(e => e.workoutCount > 0).length, [entries]);
  const avgWorkouts    = useMemo(() => employees.length > 0 ? (totalWorkouts / employees.length).toFixed(1) : '0', [totalWorkouts, employees]);
  const topStreak      = useMemo(() => entries.reduce((best, e) => e.currentStreak > best.currentStreak ? e : best, entries[0] ?? null), [entries]);

  const participationRate  = useMemo(() => employees.length > 0 ? Math.round((activeMembers / employees.length) * 100) : 0, [activeMembers, employees]);
  const activeEntries      = useMemo(() => entries.filter(e => e.workoutCount > 0), [entries]);
  const notStartedEntries  = useMemo(() => entries.filter(e => e.workoutCount === 0), [entries]);

  const teamEntries = useMemo<TeamEntry[]>(() => {
    if (!teams.length) return [];
    return teams.map(team => {
      const memberIds = new Set(employees.filter(e => e.teamId === team.id).map(e => e.id));
      const memberEntries = entries.filter(e => memberIds.has(e.employee.id));
      const totalWorkouts = memberEntries.reduce((s, e) => s + e.workoutCount, 0);
      const activeMembers = memberEntries.filter(e => e.workoutCount > 0).length;
      const topPerformer = memberEntries.length
        ? [...memberEntries].sort((a, b) => b.workoutCount - a.workoutCount)[0]
        : null;
      return { team, totalWorkouts, activeMembers, totalMembers: memberIds.size, topPerformer };
    }).sort((a, b) => b.totalWorkouts - a.totalWorkouts);
  }, [teams, employees, entries]);

  const periodLabel: Record<Period, string> = { '4m': '4 Months', 'prog': 'This Program', 'past': 'Past Programs' };

  const top3 = activeEntries.slice(0, 3);

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ color: TEAL, fontSize: 18, fontWeight: 600 }}>Loading leaderboard…</div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', color: 'var(--text)', fontFamily: 'sans-serif' }}>
      <main style={{ maxWidth: 1100, margin: '0 auto', padding: '40px 32px' }}>

        {/* Page header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' as const, gap: 10, marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 26, lineHeight: 1 }}>🏆</span>
            <div>
              <div style={{ fontSize: 22, fontWeight: 900, letterSpacing: '-0.02em', lineHeight: 1, background: `linear-gradient(135deg, ${TEAL}, ${PURPLE})`, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                Leaderboard
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{companyName}</div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' as const }}>
            <button
              onClick={sendReport}
              disabled={emailStatus === 'sending'}
              style={{
                background: 'transparent',
                border: `1px solid ${emailStatus === 'error' ? '#F9731660' : `${TEAL}50`}`,
                borderRadius: 8, padding: '6px 14px', fontSize: 12, fontWeight: 700,
                color: emailStatus === 'sent' ? TEAL : emailStatus === 'error' ? '#F97316' : 'var(--text-muted)',
                cursor: emailStatus === 'sending' ? 'wait' : 'pointer', transition: 'all 0.2s',
              }}
            >
              {emailStatus === 'sending' ? '⏳ Sending…' : emailStatus === 'sent' ? '✓ Report Sent'
                : emailStatus === 'error'
                ? <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><AlertTriangle size={12} /> Retry</span>
                : <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><Mail size={12} /> Email Report</span>}
            </button>
            <button
              onClick={sendToTeam}
              disabled={teamEmailStatus === 'sending'}
              style={{
                background: 'transparent',
                border: `1px solid ${teamEmailStatus === 'error' ? '#F9731660' : '#C471ED50'}`,
                borderRadius: 8, padding: '6px 14px', fontSize: 12, fontWeight: 700,
                color: teamEmailStatus === 'sent' ? PURPLE : teamEmailStatus === 'error' ? '#F97316' : 'var(--text-muted)',
                cursor: teamEmailStatus === 'sending' ? 'wait' : 'pointer', transition: 'all 0.2s',
              }}
            >
              {teamEmailStatus === 'sending' ? '⏳ Sending…' : teamEmailStatus === 'sent' ? '✓ Team Notified'
                : teamEmailStatus === 'error'
                ? <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><AlertTriangle size={12} /> Retry</span>
                : <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><Upload size={12} /> Share with Team</span>}
            </button>
            <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--text-muted)', cursor: 'pointer' }}>
              <input type="checkbox" checked={includeTeamInReport} onChange={toggleIncludeTeam} style={{ accentColor: PURPLE, width: 11, height: 11 }} />
              Auto-send Sundays
              <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }} className="lb-info-wrap">
                <Info size={11} style={{ color: 'var(--text-muted)', opacity: 0.6, cursor: 'default' }} />
                <span style={{
                  position: 'absolute', bottom: 'calc(100% + 6px)', left: '50%', transform: 'translateX(-50%)',
                  background: 'var(--modal-bg)', border: '1px solid var(--border)',
                  borderRadius: 8, padding: '7px 10px', width: 210, fontSize: 11,
                  color: 'var(--text)', lineHeight: 1.45, pointerEvents: 'none',
                  boxShadow: '0 4px 16px #0003', zIndex: 100,
                  whiteSpace: 'normal' as const,
                }} className="lb-info-tip">
                  When checked, your weekly leaderboard summary is automatically emailed to all team members every Sunday morning.
                </span>
              </span>
            </label>
          </div>
        </div>

        {(emailMsg || teamEmailMsg) && (
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' as const, marginBottom: 12 }}>
            {emailMsg && <p style={{ margin: 0, fontSize: 11, color: emailStatus === 'error' ? '#F97316' : TEAL }}>{emailMsg}</p>}
            {teamEmailMsg && <p style={{ margin: 0, fontSize: 11, color: teamEmailStatus === 'error' ? '#F97316' : PURPLE }}>{teamEmailMsg}</p>}
          </div>
        )}

        {/* Two-column layout: sticky filter sidebar + scrollable content */}
        <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start' }}>

          {/* Sticky filter sidebar */}
          <div style={{
            width: 200,
            flexShrink: 0,
            position: 'sticky' as const,
            top: 80,
            display: 'flex',
            flexDirection: 'column' as const,
            gap: 20,
            background: `radial-gradient(ellipse at 15% 25%, ${TEAL}1a 0%, transparent 65%), var(--card)`,
            borderRadius: 18,
            padding: '18px 14px',
            border: '1px solid var(--border)',
            boxShadow: `0 0 40px ${TEAL}10, 0 2px 16px #0002`,
          }}>

            {/* Period */}
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: TEAL, textTransform: 'uppercase' as const, letterSpacing: '0.1em', marginBottom: 6 }}>Period</div>
              <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 1 }}>
                {(['4m', ...(programDates ? ['prog'] : []), ...(pastPrograms.length ? ['past'] : [])] as Period[]).map(p => (
                  <button key={p} onClick={() => setPeriod(p)} style={{
                    padding: '7px 12px', borderRadius: 9, border: 'none',
                    textAlign: 'left' as const, cursor: 'pointer', fontWeight: 700, fontSize: 13,
                    background: period === p ? `linear-gradient(135deg, ${TEAL}, ${PURPLE})` : 'transparent',
                    color: period === p ? '#fff' : 'var(--text-muted)',
                    transition: 'all 0.18s',
                    boxShadow: period === p ? `0 2px 10px ${TEAL}44` : 'none',
                  }}>
                    {periodLabel[p]}
                  </button>
                ))}
              </div>
              {/* Past program selector */}
              {period === 'past' && pastPrograms.length > 0 && (
                <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column' as const, gap: 1 }}>
                  {pastPrograms.map(prog => {
                    const isSelected = selectedPastProgram?.id === prog.id;
                    return (
                      <button key={prog.id} onClick={() => setSelectedPastProgram(prog)} style={{
                        padding: '5px 10px 5px 14px', borderRadius: 7, border: 'none',
                        textAlign: 'left' as const, cursor: 'pointer', fontWeight: 600, fontSize: 11,
                        background: isSelected ? `${TEAL}22` : 'transparent',
                        color: isSelected ? TEAL : 'var(--text-muted)',
                        transition: 'all 0.15s',
                      }}>
                        {prog.name}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Week filter */}
            {(period === 'prog' || period === 'past') && programWeeks.length > 1 && (
              <div>
                <div style={{ fontSize: 10, fontWeight: 700, color: TEAL, textTransform: 'uppercase' as const, letterSpacing: '0.1em', marginBottom: 6 }}>Week</div>
                <div style={{ display: 'flex', flexWrap: 'wrap' as const, gap: 4 }}>
                  {programWeeks.map(w => {
                    const active = selectedWeeks.includes(w.weekNum);
                    return (
                      <button key={w.weekNum} onClick={() => setSelectedWeeks(prev =>
                        prev.includes(w.weekNum) ? prev.filter(x => x !== w.weekNum) : [...prev, w.weekNum]
                      )} style={{
                        padding: '4px 10px', borderRadius: 20,
                        border: `1px solid ${active ? TEAL : 'var(--border)'}`,
                        cursor: 'pointer', fontWeight: 600, fontSize: 12,
                        background: active ? `${TEAL}22` : 'transparent',
                        color: active ? TEAL : 'var(--text-muted)',
                        transition: 'all 0.15s',
                      }}>
                        Wk {w.weekNum}
                      </button>
                    );
                  })}
                  {selectedWeeks.length > 0 && (
                    <button onClick={() => setSelectedWeeks([])} style={{
                      padding: '4px 10px', borderRadius: 20,
                      border: '1px solid var(--border)',
                      cursor: 'pointer', fontWeight: 600, fontSize: 12,
                      background: 'transparent', color: 'var(--text-muted)', transition: 'all 0.15s',
                    }}>All</button>
                  )}
                </div>
              </div>
            )}

            {/* View toggle */}
            {teams.length > 0 && (
              <div>
                <div style={{ fontSize: 10, fontWeight: 700, color: TEAL, textTransform: 'uppercase' as const, letterSpacing: '0.1em', marginBottom: 6 }}>View</div>
                <div style={{ display: 'flex', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 9, padding: 3 }}>
                  {(['individual', 'team'] as const).map(v => (
                    <button key={v} onClick={() => setLbView(v)} style={{
                      flex: 1, border: 'none', borderRadius: 6, padding: '6px 4px',
                      fontSize: 12, fontWeight: 700, cursor: 'pointer',
                      background: lbView === v ? `linear-gradient(135deg, ${TEAL}, ${PURPLE})` : 'transparent',
                      color: lbView === v ? '#fff' : 'var(--text-muted)',
                      transition: 'all 0.18s',
                      boxShadow: lbView === v ? `0 2px 8px ${TEAL}44` : 'none',
                    }}>
                      {v === 'team' ? 'Teams' : 'Individual'}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Program filter */}
            {programs.length > 1 && (
              <div>
                <div style={{ fontSize: 10, fontWeight: 700, color: TEAL, textTransform: 'uppercase' as const, letterSpacing: '0.1em', marginBottom: 6 }}>Program</div>
                <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 1 }}>
                  {[null, ...programs].map(prog => (
                    <button key={prog ?? '__all__'} onClick={() => setProgramFilter(prog)} style={{
                      padding: '6px 12px', borderRadius: 9, border: 'none',
                      textAlign: 'left' as const, cursor: 'pointer', fontWeight: 700, fontSize: 12,
                      background: programFilter === prog ? `linear-gradient(135deg, ${TEAL}, ${PURPLE})` : 'transparent',
                      color: programFilter === prog ? '#fff' : 'var(--text-muted)',
                      transition: 'all 0.18s',
                      boxShadow: programFilter === prog ? `0 2px 8px ${TEAL}44` : 'none',
                    }}>
                      {prog ?? 'All Programs'}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Main scrollable content */}
          <div style={{ flex: 1, minWidth: 0 }}>

        {/* Stat cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, marginBottom: 40 }}>
          <StatCard
            label="Total Workouts"
            value={totalWorkouts}
            sub={
              period === 'prog' && selectedWeeks.length > 0
                ? `Week${selectedWeeks.length > 1 ? 's' : ''} ${[...selectedWeeks].sort((a, b) => a - b).join(', ')}`
                : period === 'prog' ? 'Current program' : `Last ${periodLabel[period]}`
            }
            accent={TEAL}
          />
          <StatCard label="Participation Rate" value={employees.length > 0 ? `${participationRate}%` : '—'} sub={`${activeMembers} / ${employees.length} employees`} accent={PURPLE} />
          <StatCard label="Avg Per Person" value={avgWorkouts} sub="workouts in period" />
          <StatCard
            label="Top Streak"
            value={topStreak?.currentStreak ? `${topStreak.currentStreak}d` : '—'}
            sub={topStreak?.currentStreak ? topStreak.employee.name : 'No active streaks'}
            accent={GOLD}
          />
          {topProgram && (
            <div style={{
              background: 'var(--card)',
              border: `1px solid ${TEAL}`,
              borderRadius: 16,
              padding: '24px 28px',
              display: 'flex', flexDirection: 'column', gap: 6,
              boxShadow: `0 0 20px ${TEAL}22`,
            }}>
              <div style={{ fontSize: 13, color: 'var(--text-muted)', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase' }}>Highest Rated Program</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: TEAL, lineHeight: 1.2, wordBreak: 'break-word' }}>{topProgram.name}</div>
              <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                {[
                  topProgram.avgEffectiveness !== null ? `Effectiveness ${topProgram.avgEffectiveness.toFixed(1)}/5` : '',
                  topProgram.avgEnjoyment     !== null ? `Enjoyment ${topProgram.avgEnjoyment.toFixed(1)}/5`        : '',
                ].filter(Boolean).join(' · ')}
              </div>
            </div>
          )}
        </div>

        {/* Time-off requests panel */}
        {timeOffRequests.length > 0 && (
          <div style={{ marginBottom: 28 }}>
            <button
              onClick={() => setTorExpanded(v => !v)}
              style={{
                width: '100%',
                background: 'var(--modal-bg)',
                border: `1px solid ${timeOffRequests.some(r => r.status === 'pending') ? '#F9731650' : 'var(--border)'}`,
                borderRadius: torExpanded ? '16px 16px 0 0' : 16,
                padding: '14px 20px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                cursor: 'pointer',
                color: 'var(--text)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 16 }}>🏖️</span>
                <span style={{ fontWeight: 700, fontSize: 14 }}>Time-Off Requests</span>
                {timeOffRequests.some(r => r.status === 'pending') && (
                  <span style={{
                    background: '#F97316', color: '#fff', borderRadius: 99,
                    padding: '2px 8px', fontSize: 11, fontWeight: 700,
                  }}>
                    {timeOffRequests.filter(r => r.status === 'pending').length} pending
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <label
                  onClick={e => e.stopPropagation()}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-muted)', cursor: 'pointer' }}
                >
                  <input
                    type="checkbox"
                    checked={autoApprove}
                    onChange={toggleAutoApprove}
                    style={{ accentColor: TEAL, width: 14, height: 14 }}
                  />
                  Auto-approve
                </label>
                {timeOffRequests.some(r => r.status === 'pending') && (
                  <button
                    onClick={e => { e.stopPropagation(); approveAll(); }}
                    style={{
                      background: TEAL, color: '#111', border: 'none', borderRadius: 8,
                      padding: '5px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer',
                    }}
                  >
                    Approve All
                  </button>
                )}
                <span style={{ color: 'var(--text-muted)', fontSize: 16 }}>{torExpanded ? '▲' : '▼'}</span>
              </div>
            </button>

            {torExpanded && (
              <div style={{
                background: 'var(--modal-bg)',
                border: `1px solid ${timeOffRequests.some(r => r.status === 'pending') ? '#F9731650' : 'var(--border)'}`,
                borderTop: 'none',
                borderRadius: '0 0 16px 16px',
                overflow: 'hidden',
              }}>
                {timeOffRequests.map((req, idx) => {
                  const empName = employees.find(e => e.id === req.employee_id)?.name ?? 'Unknown';
                  const isPending = req.status === 'pending';
                  return (
                    <div
                      key={req.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '12px 20px',
                        borderTop: idx === 0 ? 'none' : '1px solid var(--border)',
                        gap: 12,
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <Avatar name={empName} size={30} />
                        <div>
                          <div style={{ fontWeight: 600, fontSize: 14 }}>{empName}</div>
                          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                            {fmtDateShort(req.start_date)}
                            {req.start_date !== req.end_date && ` — ${fmtDateShort(req.end_date)}`}
                          </div>
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        {!isPending && (
                          <span style={{
                            fontSize: 12, fontWeight: 700, color: TEAL,
                            background: `${TEAL}18`, borderRadius: 8, padding: '3px 10px',
                          }}>
                            Approved
                          </span>
                        )}
                        {isPending && (
                          <>
                            <button
                              onClick={() => approveRequest(req.id)}
                              style={{
                                background: TEAL, color: '#111', border: 'none', borderRadius: 8,
                                padding: '5px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer',
                              }}
                            >
                              Approve
                            </button>
                            <button
                              onClick={() => denyRequest(req.id)}
                              style={{
                                background: 'transparent', color: 'var(--text-muted)',
                                border: '1px solid var(--border)', borderRadius: 8,
                                padding: '5px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer',
                              }}
                            >
                              Deny
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Set Up Teams nudge */}
        {teams.length === 0 && (
          <div style={{ marginBottom: 28, background: `${PURPLE}10`, border: `1px solid ${PURPLE}30`, borderRadius: 14, padding: '14px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
            <p style={{ color: 'var(--text-dim)', margin: 0, fontSize: 13 }}>Create teams to unlock team-vs-team competition on this leaderboard.</p>
            <a href="/teams" style={{ background: PURPLE, color: '#fff', borderRadius: 8, padding: '7px 16px', fontWeight: 700, fontSize: 13, textDecoration: 'none', whiteSpace: 'nowrap', flexShrink: 0 }}>Set Up Teams →</a>
          </div>
        )}

        {/* Team performance */}
        {lbView === 'team' && teamEntries.length > 0 && (
          <div style={{ marginBottom: 40 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 14 }}>
              Team Performance
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 14 }}>
              {teamEntries.map((te, idx) => {
                const rankMedal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : null;
                const accentColor = idx === 0 ? GOLD : idx === 1 ? SILVER : idx === 2 ? BRONZE : 'var(--border)';
                return (
                  <div key={te.team.id} style={{
                    background: 'var(--card)',
                    border: `1px solid ${idx < 3 ? accentColor + '66' : 'var(--border)'}`,
                    borderRadius: 16,
                    padding: '20px 22px',
                    boxShadow: idx === 0 ? `0 0 20px ${GOLD}22` : '0 2px 8px #0002',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                      {rankMedal && <span style={{ fontSize: 18 }}>{rankMedal}</span>}
                      <span style={{ fontWeight: 800, fontSize: 15, color: 'var(--text)' }}>{te.team.name}</span>
                    </div>
                    <div style={{ fontSize: 36, fontWeight: 900, color: te.totalWorkouts > 0 ? TEAL : 'var(--text-muted)', lineHeight: 1, marginBottom: 6 }}>
                      {te.totalWorkouts}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>
                      workouts this period
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', display: 'flex', flexDirection: 'column', gap: 3 }}>
                      <span>{te.activeMembers} / {te.totalMembers} members active</span>
                      {te.topPerformer && te.topPerformer.workoutCount > 0 && (
                        <span style={{ color: PURPLE, fontWeight: 600 }}>⭐ {te.topPerformer.employee.name}</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {lbView === 'individual' && (
          entries.length === 0 ? (
            <div style={{
              background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 20,
              padding: '60px 40px', textAlign: 'center',
            }}>
              <div style={{ fontSize: 48, marginBottom: 16 }}>📊</div>
              <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>No workout data yet</div>
              <div style={{ color: 'var(--text-muted)' }}>Once team members start logging office workouts, they'll appear here.</div>
            </div>
          ) : (
            <>
              {/* Podium */}
              {top3.length >= 2 && (
                <div style={{
                  background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 24,
                  padding: '40px 40px 0', marginBottom: 24,
                  boxShadow: '0 4px 24px #0002',
                }}>
                  <div style={{ textAlign: 'center', fontSize: 13, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 32 }}>
                    Top Performers
                  </div>
                  <div style={{
                    display: 'flex',
                    alignItems: 'flex-end',
                    justifyContent: 'center',
                    gap: 8,
                  }}>
                    {top3[1] && <PodiumBlock entry={top3[1]} rank={2} height={90} />}
                    {top3[0] && <PodiumBlock entry={top3[0]} rank={1} height={130} />}
                    {top3[2] && <PodiumBlock entry={top3[2]} rank={3} height={65} />}
                  </div>
                </div>
              )}

              {/* Full table */}
              <div style={{
                background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 20,
                overflow: 'hidden', boxShadow: '0 2px 12px #0002',
              }}>
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: '60px 1fr 110px 120px 120px 120px',
                  padding: '12px 24px',
                  borderBottom: '1px solid var(--border)',
                  fontSize: 11, fontWeight: 700, color: 'var(--text-muted)',
                  letterSpacing: '0.06em', textTransform: 'uppercase',
                }}>
                  <div>Rank</div>
                  <div>Member</div>
                  <div style={{ textAlign: 'center' }}>Workouts</div>
                  <div style={{ textAlign: 'center' }}>Active Streak</div>
                  <div style={{ textAlign: 'center' }}>Best Streak</div>
                  <div style={{ textAlign: 'center' }}>Last Active</div>
                </div>

                {activeEntries.map((entry, idx) => {
                  const rank      = idx + 1;
                  const medalEl   = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : null;
                  const isTop     = rank <= 3;
                  const rowAccent = rank === 1 ? `${GOLD}18` : rank === 2 ? `${SILVER}12` : rank === 3 ? `${BRONZE}12` : 'transparent';

                  return (
                    <div
                      key={entry.employee.id}
                      onClick={() => router.push(`/employee/${entry.employee.id}`)}
                      onMouseEnter={() => setHoveredRow(entry.employee.id)}
                      onMouseLeave={() => setHoveredRow(null)}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '60px 1fr 110px 120px 120px 120px',
                        padding: '16px 24px',
                        alignItems: 'center',
                        borderBottom: idx < activeEntries.length - 1 ? '1px solid var(--border)' : 'none',
                        background: hoveredRow === entry.employee.id ? `${TEAL}12` : rowAccent,
                        transition: 'background 0.15s',
                        cursor: 'pointer',
                      }}
                    >
                      <div style={{ fontSize: isTop ? 22 : 15, fontWeight: 700, color: isTop ? undefined : 'var(--text-muted)' }}>
                        {medalEl ?? rank}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <Avatar name={entry.employee.name} size={36} />
                        <span style={{ fontWeight: 600, fontSize: 15 }}>{entry.employee.name}</span>
                      </div>
                      <div style={{ textAlign: 'center', fontWeight: 700, fontSize: 18, color: TEAL }}>
                        {entry.workoutCount}
                      </div>
                      <div style={{ textAlign: 'center', fontWeight: 600, fontSize: 14 }}>
                        {entry.currentStreak > 0
                          ? <span style={{ color: '#F97316' }}>🔥 {entry.currentStreak}d</span>
                          : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                      </div>
                      <div style={{ textAlign: 'center', fontWeight: 600, fontSize: 14 }}>
                        {entry.longestStreak > 0
                          ? <span style={{ color: PURPLE }}>⭐ {entry.longestStreak}d</span>
                          : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                      </div>
                      <div style={{ textAlign: 'center', fontSize: 13, color: 'var(--text-muted)' }}>
                        {entry.lastActive
                          ? new Date(entry.lastActive).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                          : '—'}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Not Yet Started */}
              {notStartedEntries.length > 0 && (
                <div style={{ marginTop: 12, background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 20, overflow: 'hidden', boxShadow: '0 2px 12px #0002' }}>
                  <div style={{ padding: '14px 24px', borderBottom: notStartedEntries.length > 0 ? '1px solid var(--border)' : 'none', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontWeight: 700, fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                      Not Yet Started
                    </span>
                    <span style={{ background: '#F9731622', color: '#F97316', borderRadius: 99, padding: '2px 8px', fontSize: 11, fontWeight: 700 }}>
                      {notStartedEntries.length}
                    </span>
                  </div>
                  {notStartedEntries.map((entry, idx) => (
                    <div
                      key={entry.employee.id}
                      onClick={() => router.push(`/employee/${entry.employee.id}`)}
                      onMouseEnter={() => setHoveredRow(entry.employee.id)}
                      onMouseLeave={() => setHoveredRow(null)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 12,
                        padding: '12px 24px',
                        borderBottom: idx < notStartedEntries.length - 1 ? '1px solid var(--border)' : 'none',
                        background: hoveredRow === entry.employee.id ? `${TEAL}08` : 'transparent',
                        transition: 'background 0.15s',
                        cursor: 'pointer',
                      }}
                    >
                      <Avatar name={entry.employee.name} size={32} />
                      <span style={{ fontSize: 14, color: 'var(--text-muted)' }}>{entry.employee.name}</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )
        )}
          </div>{/* end main content */}
        </div>{/* end two-column layout */}
      </main>
    </div>
  );
}
