'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { getSupabase } from '@/lib/supabase';

const TEAL   = '#1EDBA8';
const PURPLE = '#C471ED';
const GOLD   = '#FFD700';
const SILVER = '#94A3B8';
const BRONZE = '#CD7F32';

type Period = '7d' | '1m' | '4m';

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

function getPeriodStart(period: Period): Date {
  const now = new Date();
  if (period === '7d') return new Date(now.getTime() - 7 * 86400000);
  if (period === '1m') return new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
  return new Date(now.getFullYear(), now.getMonth() - 4, now.getDate());
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
  const [period, setPeriod]     = useState<Period>('1m');
  const [lbView, setLbView]     = useState<'team' | 'individual'>('individual');
  const [companyName, setCompanyName] = useState('');
  const [teams, setTeams]             = useState<Team[]>([]);
  const [employees, setEmployees]     = useState<Employee[]>([]);
  const [allDates, setAllDates]       = useState<Record<string, string[]>>({});
  const [scheduleType, setScheduleType]   = useState<string>('fixed');
  const [workDays, setWorkDays]           = useState<number[]>([1, 2, 3, 4, 5]);
  const [sessionToken, setSessionToken]   = useState('');
  const [emailStatus, setEmailStatus]     = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [emailMsg, setEmailMsg]           = useState('');
  const [userId, setUserId]               = useState('');
  const [timeOffRequests, setTimeOffRequests] = useState<TimeOffRequest[]>([]);
  const [approvedOffMap, setApprovedOffMap]   = useState<Record<string, string[]>>({});
  const [autoApprove, setAutoApprove]         = useState(false);
  const [torExpanded, setTorExpanded]         = useState(false);

  useEffect(() => { setEmailStatus('idle'); setEmailMsg(''); }, [period]);

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
        .select('role, is_employer, company_name, auto_approve_time_off')
        .eq('id', user.id)
        .single();

      if (!prof || prof.role !== 'practitioner' || !prof.is_employer) {
        router.replace('/plans');
        return;
      }
      setCompanyName(prof.company_name ?? 'Your Company');
      setAutoApprove(!!(prof as any).auto_approve_time_off);

      const todayStr = new Date().toISOString().slice(0, 10);
      const [{ data: links }, { data: teamsData }, { data: planRows }, { data: activeSched }, { data: torRows }] = await Promise.all([
        supabase.from('patient_links').select('patient_id, team_id, profiles!patient_links_patient_id_fkey(display_name)').eq('practitioner_id', user.id),
        supabase.from('employer_teams').select('id, name').eq('employer_id', user.id).order('name'),
        supabase.from('workout_plans').select('id').eq('practitioner_id', user.id),
        supabase.from('employer_programs').select('schedule_type, work_days').eq('employer_id', user.id).lte('started_at', todayStr).gte('ends_at', todayStr).order('started_at', { ascending: false }).limit(1).maybeSingle(),
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

      setScheduleType((activeSched as any)?.schedule_type ?? 'fixed');
      setWorkDays((activeSched as any)?.work_days ?? [1, 2, 3, 4, 5]);

      if (!links || links.length === 0) { setLoading(false); return; }
      setTeams((teamsData ?? []) as Team[]);

      const empList: Employee[] = links.map((l: any) => ({
        id: l.patient_id,
        name: l.profiles?.display_name ?? 'Unknown',
        teamId: l.team_id ?? null,
      }));
      setEmployees(empList);

      const planIds = (planRows ?? []).map((p: any) => p.id as string);
      let workouts: { user_id: string; date: string }[] = [];
      if (planIds.length > 0 && empList.length > 0) {
        const { data } = await supabase
          .from('synced_workouts')
          .select('user_id, date')
          .in('user_id', empList.map(e => e.id))
          .filter('data->>planId', 'in', `(${planIds.join(',')})`);
        workouts = data ?? [];
      }

      const dateMap: Record<string, string[]> = {};
      for (const emp of empList) dateMap[emp.id] = [];

      for (const w of workouts) {
        dateMap[w.user_id]?.push(w.date);
      }

      setAllDates(dateMap);
      setLoading(false);
    })();
  }, [router]);

  const entries = useMemo<LeaderboardEntry[]>(() => {
    const start = getPeriodStart(period);
    const startStr = start.toISOString().slice(0, 10);

    return employees
      .map(emp => {
        const dates = allDates[emp.id] ?? [];
        const periodDates = dates.filter(d => d >= startStr);
        return {
          employee: emp,
          workoutCount: periodDates.length,
          currentStreak: calcCurrentStreak([...dates].sort(), scheduleType, workDays, approvedOffMap[emp.id] ?? []),
          longestStreak: calcLongestStreak([...periodDates].sort()),
          lastActive: dates.length ? [...dates].sort().at(-1)! : null,
        };
      })
      .sort((a, b) => b.workoutCount - a.workoutCount || b.currentStreak - a.currentStreak);
  }, [employees, allDates, period, scheduleType, workDays, approvedOffMap]);

  const totalWorkouts  = useMemo(() => entries.reduce((s, e) => s + e.workoutCount, 0), [entries]);
  const activeMembers  = useMemo(() => entries.filter(e => e.workoutCount > 0).length, [entries]);
  const avgWorkouts    = useMemo(() => employees.length > 0 ? (totalWorkouts / employees.length).toFixed(1) : '0', [totalWorkouts, employees]);
  const topStreak      = useMemo(() => entries.reduce((best, e) => e.currentStreak > best.currentStreak ? e : best, entries[0] ?? null), [entries]);

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

  const periodLabel: Record<Period, string> = { '7d': '7 Days', '1m': '1 Month', '4m': '4 Months' };

  const top3 = entries.slice(0, 3);

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

        {/* Hero banner */}
        <div style={{
          borderRadius: 24,
          padding: '48px 40px',
          marginBottom: 36,
          background: `radial-gradient(ellipse at 20% 50%, ${TEAL}22 0%, transparent 60%),
                       radial-gradient(ellipse at 80% 30%, ${PURPLE}22 0%, transparent 55%),
                       var(--card)`,
          border: '1px solid var(--border)',
          boxShadow: `0 0 60px ${TEAL}18, 0 4px 32px #0003`,
          display: 'flex',
          flexDirection: 'column' as const,
          alignItems: 'center',
          gap: 16,
          textAlign: 'center' as const,
          position: 'relative' as const,
          overflow: 'hidden',
        }}>
          <div style={{ fontSize: 52 }}>🏆</div>
          <div>
            <div style={{ fontSize: 36, fontWeight: 900, letterSpacing: '-0.02em', background: `linear-gradient(135deg, ${TEAL}, ${PURPLE})`, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
              Leaderboard
            </div>
            <div style={{ fontSize: 16, color: 'var(--text-muted)', marginTop: 6 }}>{companyName}</div>
          </div>

          {/* Period toggle */}
          <div style={{ display: 'flex', gap: 8, background: 'var(--bg)', borderRadius: 12, padding: 4, border: '1px solid var(--border)' }}>
            {(['7d', '1m', '4m'] as Period[]).map(p => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                style={{
                  padding: '8px 20px',
                  borderRadius: 9,
                  border: 'none',
                  cursor: 'pointer',
                  fontWeight: 700,
                  fontSize: 14,
                  background: period === p ? `linear-gradient(135deg, ${TEAL}, ${PURPLE})` : 'transparent',
                  color: period === p ? '#fff' : 'var(--text-muted)',
                  transition: 'all 0.2s',
                  boxShadow: period === p ? `0 2px 12px ${TEAL}44` : 'none',
                }}
              >
                {periodLabel[p]}
              </button>
            ))}
          </div>

          {/* Teams / Individual toggle — only when teams exist */}
          {teams.length > 0 && (
            <div style={{ display: 'flex', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 10, padding: 3 }}>
              {(['individual', 'team'] as const).map(v => (
                <button
                  key={v}
                  onClick={() => setLbView(v)}
                  style={{
                    border: 'none', borderRadius: 7, padding: '6px 18px',
                    fontSize: 13, fontWeight: 700, cursor: 'pointer',
                    background: lbView === v ? `linear-gradient(135deg, ${TEAL}, ${PURPLE})` : 'transparent',
                    color: lbView === v ? '#fff' : 'var(--text-muted)',
                    transition: 'all 0.2s',
                    boxShadow: lbView === v ? `0 2px 10px ${TEAL}44` : 'none',
                  }}
                >
                  {v === 'team' ? 'Teams' : 'Individual'}
                </button>
              ))}
            </div>
          )}

          {/* On-demand email report */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
            <button
              onClick={sendReport}
              disabled={emailStatus === 'sending'}
              style={{
                background: 'transparent',
                border: `1px solid ${emailStatus === 'error' ? '#F9731660' : `${TEAL}50`}`,
                borderRadius: 10,
                padding: '8px 22px',
                fontSize: 13,
                fontWeight: 700,
                color: emailStatus === 'sent'
                  ? TEAL
                  : emailStatus === 'error'
                  ? '#F97316'
                  : 'var(--text-muted)',
                cursor: emailStatus === 'sending' ? 'wait' : 'pointer',
                transition: 'all 0.2s',
              }}
            >
              {emailStatus === 'sending'
                ? '⏳ Sending…'
                : emailStatus === 'sent'
                ? '✓ Report Sent'
                : emailStatus === 'error'
                ? '⚠ Failed — Retry'
                : '📧 Email Report'}
            </button>
            {emailMsg && (
              <p style={{ margin: 0, fontSize: 12, color: emailStatus === 'error' ? '#F97316' : TEAL }}>
                {emailMsg}
              </p>
            )}
          </div>
        </div>

        {/* Stat cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 40 }}>
          <StatCard label="Total Workouts" value={totalWorkouts} sub={`Last ${periodLabel[period]}`} accent={TEAL} />
          <StatCard label="Active Members" value={activeMembers} sub={`of ${employees.length} total`} accent={PURPLE} />
          <StatCard label="Avg Per Person" value={avgWorkouts} sub="workouts in period" />
          <StatCard
            label="Top Streak"
            value={topStreak?.currentStreak ? `${topStreak.currentStreak}d` : '—'}
            sub={topStreak?.currentStreak ? topStreak.employee.name : 'No active streaks'}
            accent={GOLD}
          />
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
                  gridTemplateColumns: '60px 1fr 140px 140px 140px',
                  padding: '12px 24px',
                  borderBottom: '1px solid var(--border)',
                  fontSize: 11, fontWeight: 700, color: 'var(--text-muted)',
                  letterSpacing: '0.06em', textTransform: 'uppercase',
                }}>
                  <div>Rank</div>
                  <div>Member</div>
                  <div style={{ textAlign: 'center' }}>Workouts</div>
                  <div style={{ textAlign: 'center' }}>Active Streak</div>
                  <div style={{ textAlign: 'center' }}>Last Active</div>
                </div>

                {entries.map((entry, idx) => {
                  const rank      = idx + 1;
                  const medalEl   = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : null;
                  const isTop     = rank <= 3;
                  const rowAccent = rank === 1 ? `${GOLD}18` : rank === 2 ? `${SILVER}12` : rank === 3 ? `${BRONZE}12` : 'transparent';

                  return (
                    <div
                      key={entry.employee.id}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '60px 1fr 140px 140px 140px',
                        padding: '16px 24px',
                        alignItems: 'center',
                        borderBottom: idx < entries.length - 1 ? '1px solid var(--border)' : 'none',
                        background: rowAccent,
                        transition: 'background 0.15s',
                      }}
                    >
                      <div style={{ fontSize: isTop ? 22 : 15, fontWeight: 700, color: isTop ? undefined : 'var(--text-muted)' }}>
                        {medalEl ?? rank}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <Avatar name={entry.employee.name} size={36} />
                        <span style={{ fontWeight: 600, fontSize: 15 }}>{entry.employee.name}</span>
                      </div>
                      <div style={{ textAlign: 'center', fontWeight: 700, fontSize: 18, color: entry.workoutCount > 0 ? TEAL : 'var(--text-muted)' }}>
                        {entry.workoutCount}
                      </div>
                      <div style={{ textAlign: 'center', fontWeight: 600, fontSize: 14 }}>
                        {entry.currentStreak > 0
                          ? <span style={{ color: '#F97316' }}>🔥 {entry.currentStreak}d</span>
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
            </>
          )
        )}
      </main>
    </div>
  );
}
