'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { getSupabase } from '@/lib/supabase';
import { checkPractitionerAccess } from '@/lib/checkPractitionerAccess';

const TEAL   = '#1EDBA8';
const PURPLE = '#C471ED';


interface WorkoutSet {
  reps?: number; weight?: number;
  duration?: number; cardioduration?: number;
}
interface LoggedExercise {
  exercise: { name: string; muscleGroup?: string; type: string };
  sets: WorkoutSet[];
}
interface WorkoutLog {
  exercises: LoggedExercise[];
  planId?: string;
}

function StatCard({ label, value, sub, accent, icon }: {
  label: string; value: string | number | React.ReactNode;
  sub?: string; accent?: string; icon?: string;
}) {
  return (
    <div style={{
      background: 'var(--card)',
      border: `1px solid ${accent ? `${accent}44` : 'var(--border)'}`,
      borderRadius: 16,
      padding: '24px 24px 20px',
      display: 'flex', flexDirection: 'column', gap: 8,
      boxShadow: accent ? `0 0 20px ${accent}18` : '0 2px 8px #0001',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {icon && <span style={{ fontSize: 20 }}>{icon}</span>}
        <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase' }}>{label}</span>
      </div>
      <div style={{ fontSize: 34, fontWeight: 800, color: accent ?? 'var(--text)', lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{sub}</div>}
    </div>
  );
}

function expandDateRange(start: string, end: string): string[] {
  const out: string[] = [];
  const cursor = new Date(start + 'T00:00:00');
  const endDate = new Date(end   + 'T00:00:00');
  while (cursor <= endDate) { out.push(cursor.toISOString().slice(0, 10)); cursor.setDate(cursor.getDate() + 1); }
  return out;
}

function calcCurrentStreak(sortedDates: string[], scheduleType = 'fixed', workDays: number[] = [1,2,3,4,5], approvedOffDates: string[] = []): number {
  if (!sortedDates.length) return 0;
  const dateSet = new Set(sortedDates);
  const offSet  = new Set(approvedOffDates);
  const today = new Date(); today.setHours(0, 0, 0, 0);

  if (scheduleType === 'flexible') {
    let cursor = new Date(today), streak = 0, misses = 0;
    for (let i = 0; i < 800; i++) {
      const s = cursor.toISOString().slice(0, 10);
      if (offSet.has(s)) { /* skip */ }
      else if (dateSet.has(s)) { streak++; misses = 0; }
      else if (++misses >= 3) break;
      cursor = new Date(cursor.getTime() - 86400000);
    }
    return streak;
  }

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

function calcLongestStreak(sortedDates: string[]): number {
  if (!sortedDates.length) return 0;
  const unique = [...new Set(sortedDates)].sort();
  let longest = 1, current = 1;
  for (let i = 1; i < unique.length; i++) {
    const prev = new Date(unique[i - 1]).getTime();
    const curr = new Date(unique[i]).getTime();
    if (curr - prev === 86400000) { current++; if (current > longest) longest = current; }
    else current = 1;
  }
  return longest;
}

function fmtDateShort(d: string) {
  return new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

interface TimeOffEntry {
  id: string;
  start_date: string;
  end_date: string;
  status: 'pending' | 'approved' | 'denied';
}

const PERSONAL_COLOR = '#64748b';
const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function ActivityGrid({ dates, employerDates }: { dates: string[]; employerDates: string[] }) {
  const allSet = new Set(dates);
  const empSet = new Set(employerDates);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = today.toISOString().slice(0, 10);

  // Find the Monday of the current week (Mon=0 … Sun=6)
  const todayDow = (today.getDay() + 6) % 7;
  const thisMonday = new Date(today.getTime() - todayDow * 86400000);

  // Build 5 full weeks (Mon → Sun), newest last
  type DayInfo = {
    date: string; dayNum: number; month: number;
    isFuture: boolean; isToday: boolean;
    hasEmployer: boolean; hasPersonal: boolean;
  };
  const weeks: DayInfo[][] = [];
  for (let w = 4; w >= 0; w--) {
    const week: DayInfo[] = [];
    for (let d = 0; d < 7; d++) {
      const dt = new Date(thisMonday.getTime() - w * 7 * 86400000 + d * 86400000);
      const s = dt.toISOString().slice(0, 10);
      week.push({
        date: s, dayNum: dt.getDate(), month: dt.getMonth(),
        isFuture: dt > today, isToday: s === todayStr,
        hasEmployer: empSet.has(s),
        hasPersonal: allSet.has(s) && !empSet.has(s),
      });
    }
    weeks.push(week);
  }

  const weekLabel = (wi: number) => {
    if (wi === 4) return 'This week';
    if (wi === 3) return 'Last week';
    const d = new Date(weeks[wi][0].date);
    return `${MONTHS_SHORT[d.getMonth()]} ${d.getDate()}`;
  };

  const DAY_COLS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  return (
    <div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: 16 }}>
        Activity — last 5 weeks
      </div>

      {/* Day-of-week header */}
      <div style={{ display: 'grid', gridTemplateColumns: '72px repeat(7, 1fr)', gap: '4px 6px', marginBottom: 6 }}>
        <div />
        {DAY_COLS.map(d => (
          <div key={d} style={{ textAlign: 'center', fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.03em' }}>
            {d}
          </div>
        ))}
      </div>

      {/* Week rows */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        {weeks.map((week, wi) => (
          <div key={wi} style={{ display: 'grid', gridTemplateColumns: '72px repeat(7, 1fr)', gap: '0 6px', alignItems: 'center' }}>
            <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', textAlign: 'right', paddingRight: 10, whiteSpace: 'nowrap' }}>
              {weekLabel(wi)}
            </div>
            {week.map(day => {
              const bg = day.isFuture ? 'var(--border)'
                : day.hasEmployer ? TEAL
                : day.hasPersonal ? PERSONAL_COLOR
                : 'var(--border)';
              const opacity = day.isFuture ? 0.12
                : day.hasEmployer ? 1
                : day.hasPersonal ? 1
                : 0.28;
              const color = (day.hasEmployer || day.hasPersonal) && !day.isFuture
                ? '#fff'
                : 'var(--text-muted)';
              const tooltip = day.hasEmployer ? `${day.date} · employer plan`
                : day.hasPersonal ? `${day.date} · personal workout`
                : day.isFuture ? '' : `${day.date} · no workout`;
              return (
                <div
                  key={day.date}
                  title={tooltip}
                  style={{
                    borderRadius: 6, padding: '7px 0',
                    background: bg, opacity,
                    textAlign: 'center', fontSize: 12, fontWeight: day.isToday ? 800 : 500,
                    color,
                    outline: day.isToday ? `2px solid ${TEAL}` : 'none',
                    outlineOffset: 1,
                    transition: 'opacity 0.12s',
                  }}
                >
                  {day.isFuture ? '' : day.dayNum}
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 16, fontSize: 11, color: 'var(--text-muted)', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <div style={{ width: 12, height: 12, borderRadius: 2, background: 'var(--border)', opacity: 0.28 }} />
          <span>No workout</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <div style={{ width: 12, height: 12, borderRadius: 2, background: PERSONAL_COLOR }} />
          <span>Personal workout</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <div style={{ width: 12, height: 12, borderRadius: 2, background: TEAL }} />
          <span>Employer plan</span>
        </div>
      </div>
    </div>
  );
}

export default function EmployeeOverviewPage() {
  const router     = useRouter();
  const { employeeId } = useParams<{ employeeId: string }>();

  const [loading,       setLoading]       = useState(true);
  const [employeeName,  setEmployeeName]  = useState('');
  const [employeeEmail, setEmployeeEmail] = useState('');
  const [totalWorkouts,  setTotalWorkouts]  = useState(0);
  const [totalStretches, setTotalStretches] = useState(0);

  const [activityDates,    setActivityDates]     = useState<string[]>([]);
  const [employerDates,    setEmployerDates]     = useState<string[]>([]);
  const [assignedPlans,    setAssignedPlans]     = useState<{ id: string; name: string }[]>([]);
  const [currentStreak,    setCurrentStreak]     = useState(0);
  const [longestStreak,    setLongestStreak]     = useState(0);
  const [timeOffHistory,   setTimeOffHistory]    = useState<TimeOffEntry[]>([]);
  const [torExpanded,      setTorExpanded]       = useState(false);

  useEffect(() => {
    (async () => {
      const supabase = getSupabase();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.replace('/login'); return; }

      const { data: prof } = await supabase
        .from('profiles')
        .select('role, is_employer')
        .eq('id', user.id)
        .single();

      if (!prof || prof.role !== 'practitioner' || !prof.is_employer) {
        router.replace('/plans');
        return;
      }
      const hasAccess = await checkPractitionerAccess(supabase, user.id);
      if (!hasAccess) { router.push('/profile?subscription=expired'); return; }

      // Verify this employee is actually linked to this employer
      const { data: link } = await supabase
        .from('patient_links')
        .select('profiles!patient_links_patient_id_fkey(display_name, email)')
        .eq('practitioner_id', user.id)
        .eq('patient_id', employeeId)
        .single();

      if (!link) { router.replace('/plans'); return; }

      const empProfile = Array.isArray(link.profiles) ? link.profiles[0] : link.profiles;
      setEmployeeName(empProfile?.display_name ?? 'Unknown');
      setEmployeeEmail(empProfile?.email ?? '');

      const todayStr = new Date().toISOString().slice(0, 10);

      // Get employer's plan IDs, active program schedule, and this employee's time-off
      const [{ data: plans }, { data: activeSched }, { data: torRows }] = await Promise.all([
        supabase.from('workout_plans').select('id, name').eq('practitioner_id', user.id).eq('patient_id', employeeId),
        supabase.from('employer_programs').select('schedule_type, work_days').eq('employer_id', user.id).lte('started_at', todayStr).gte('ends_at', todayStr).order('started_at', { ascending: false }).limit(1).maybeSingle(),
        supabase.from('time_off_requests').select('id, start_date, end_date, status').eq('employer_id', user.id).eq('employee_id', employeeId).in('status', ['pending', 'approved']).order('start_date', { ascending: false }),
      ]);

      const planList = plans ?? [];
      setAssignedPlans(planList.map((p: any) => ({ id: p.id, name: p.name })));
      const ptPlanIds = new Set(planList.map((p: any) => p.id as string));

      const torList = (torRows ?? []) as TimeOffEntry[];
      setTimeOffHistory(torList);

      // Fetch workouts for this employee
      const { data: workouts } = await supabase
        .from('synced_workouts')
        .select('date, data')
        .eq('user_id', employeeId);

      const all = workouts ?? [];

      // Employer-plan workouts only — used for exercises completed count
      const employerWorkouts = all.filter((w: any) => {
        const pid = w.data?.planId;
        return pid && ptPlanIds.has(pid);
      });

      let strCount = 0;
      for (const w of employerWorkouts) {
        const log = w.data as WorkoutLog;
        strCount += (log.exercises ?? []).length;
      }

      // Total workouts and activity = all logged workouts (count only, no details)
      const allDates = all.map((w: any) => w.date as string);

      setTotalWorkouts(all.length);
      setTotalStretches(strCount);
      const uniqueAllDates     = [...new Set(allDates)].sort();
      const uniqueEmployerDates = [...new Set(employerWorkouts.map((w: any) => w.date as string))].sort();
      setActivityDates(uniqueAllDates);
      setEmployerDates(uniqueEmployerDates);

      // Compute streaks using employer-plan dates (engagement metric)
      const approvedOffDates = torList
        .filter(t => t.status === 'approved')
        .flatMap(t => expandDateRange(t.start_date, t.end_date));
      const schedType  = (activeSched as any)?.schedule_type ?? 'flexible';
      const workDaysRaw = (activeSched as any)?.work_days;
      const workDays   = Array.isArray(workDaysRaw) ? workDaysRaw as number[] : [1, 2, 3, 4, 5];
      setCurrentStreak(calcCurrentStreak(uniqueEmployerDates, schedType, workDays, approvedOffDates));
      setLongestStreak(calcLongestStreak(uniqueEmployerDates));
      setLoading(false);
    })();
  }, [router, employeeId]);

  const initials = employeeName.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ color: TEAL, fontSize: 16, fontWeight: 600 }}>Loading…</div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', color: 'var(--text)', fontFamily: 'sans-serif' }}>
      <main style={{ maxWidth: 900, margin: '0 auto', padding: '40px 32px' }}>

        {/* Back */}
        <button
          onClick={() => router.back()}
          style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 14, fontWeight: 600, padding: 0, marginBottom: 28, display: 'flex', alignItems: 'center', gap: 6 }}
        >
          ← Back
        </button>

        {/* Header */}
        <div style={{
          background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 20,
          padding: '32px 36px', marginBottom: 28, display: 'flex', alignItems: 'center', gap: 24,
        }}>
          <div style={{
            width: 72, height: 72, borderRadius: '50%', flexShrink: 0,
            background: `linear-gradient(135deg, ${TEAL}, ${PURPLE})`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#fff', fontWeight: 800, fontSize: 26,
          }}>
            {initials}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 24, fontWeight: 800, marginBottom: 4 }}>{employeeName}</div>
            <div style={{ color: 'var(--text-muted)', fontSize: 14 }}>{employeeEmail}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Assigned Plans</div>
            {assignedPlans.length === 0
              ? <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>None yet</span>
              : assignedPlans.map(p => (
                  <div key={p.id} style={{ fontSize: 13, fontWeight: 600, color: TEAL }}>{p.name}</div>
                ))}
          </div>
        </div>

        {/* Stat cards */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 28 }}>
          <StatCard label="Workouts Logged" value={totalWorkouts} sub="all activity" accent={TEAL} icon="🏃" />
          <StatCard label="Exercises Completed" value={totalStretches} sub="from employer plans" accent={PURPLE} icon="🧘" />
        </div>

        {/* Streak stats */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 28 }}>
          <StatCard label="Current Streak" value={`${currentStreak}d`} sub="employer-plan workouts" accent={TEAL} icon="🔥" />
          <StatCard label="Longest Streak" value={`${longestStreak}d`} sub="employer-plan workouts" accent={PURPLE} icon="🏆" />
        </div>

        {/* Activity dots */}
        <div style={{
          background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16,
          padding: '24px 28px', marginBottom: 28,
        }}>
          <ActivityGrid dates={activityDates} employerDates={employerDates} />
        </div>

        {/* Time-off history */}
        <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16, overflow: 'hidden' }}>
          <button
            onClick={() => setTorExpanded(v => !v)}
            style={{
              width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '20px 24px', background: 'none', border: 'none', cursor: 'pointer',
              color: 'var(--text)', fontWeight: 700, fontSize: 14,
            }}
          >
            <span>🗓 Time-off History</span>
            <span style={{ fontSize: 12, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 8 }}>
              {timeOffHistory.length} request{timeOffHistory.length !== 1 ? 's' : ''}
              <span style={{ fontSize: 16 }}>{torExpanded ? '▲' : '▼'}</span>
            </span>
          </button>

          {torExpanded && (
            <div style={{ borderTop: '1px solid var(--border)', padding: '4px 0 8px' }}>
              {timeOffHistory.length === 0 ? (
                <div style={{ padding: '16px 24px', color: 'var(--text-muted)', fontSize: 13 }}>No time-off requests on record.</div>
              ) : timeOffHistory.map(t => (
                <div
                  key={t.id}
                  style={{
                    display: 'grid', gridTemplateColumns: '1fr auto', alignItems: 'center',
                    padding: '12px 24px', borderBottom: '1px solid var(--border)',
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{fmtDateShort(t.start_date)} – {fmtDateShort(t.end_date)}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                      {expandDateRange(t.start_date, t.end_date).length} day{expandDateRange(t.start_date, t.end_date).length !== 1 ? 's' : ''}
                    </div>
                  </div>
                  <span style={{
                    fontSize: 11, fontWeight: 700, letterSpacing: '0.04em', padding: '3px 10px', borderRadius: 20,
                    background: t.status === 'approved' ? '#10b98122' : t.status === 'pending' ? '#f59e0b22' : '#ef444422',
                    color:      t.status === 'approved' ? '#10b981'   : t.status === 'pending' ? '#f59e0b'   : '#ef4444',
                    textTransform: 'uppercase',
                  }}>
                    {t.status}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

      </main>
    </div>
  );
}
