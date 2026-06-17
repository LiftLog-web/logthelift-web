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

interface Employee {
  id: string;
  name: string;
}

interface LeaderboardEntry {
  employee: Employee;
  workoutCount: number;
  currentStreak: number;
  longestStreak: number;
  lastActive: string | null;
}

function getPeriodStart(period: Period): Date {
  const now = new Date();
  if (period === '7d') return new Date(now.getTime() - 7 * 86400000);
  if (period === '1m') return new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
  return new Date(now.getFullYear(), now.getMonth() - 4, now.getDate());
}

function calcCurrentStreak(sortedDates: string[]): number {
  if (!sortedDates.length) return 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today.getTime() - 86400000);
  const dateSet = new Set(sortedDates);

  const todayStr   = today.toISOString().slice(0, 10);
  const yestStr    = yesterday.toISOString().slice(0, 10);
  if (!dateSet.has(todayStr) && !dateSet.has(yestStr)) return 0;

  let cursor = dateSet.has(todayStr) ? today : yesterday;
  let streak = 0;
  while (true) {
    const key = cursor.toISOString().slice(0, 10);
    if (!dateSet.has(key)) break;
    streak++;
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
  const [companyName, setCompanyName] = useState('');
  const [employees, setEmployees]     = useState<Employee[]>([]);
  const [allDates, setAllDates]       = useState<Record<string, string[]>>({});

  useEffect(() => {
    (async () => {
      const supabase = getSupabase();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.replace('/login'); return; }

      const { data: prof } = await supabase
        .from('profiles')
        .select('role, is_employer, company_name')
        .eq('id', user.id)
        .single();

      if (!prof || prof.role !== 'practitioner' || !prof.is_employer) {
        router.replace('/plans');
        return;
      }
      setCompanyName(prof.company_name ?? 'Your Company');

      const { data: links } = await supabase
        .from('patient_links')
        .select('patient_id, profiles!patient_links_patient_id_fkey(display_name)')
        .eq('practitioner_id', user.id);

      if (!links || links.length === 0) { setLoading(false); return; }

      const empList: Employee[] = links.map((l: any) => ({
        id: l.patient_id,
        name: l.profiles?.display_name ?? 'Unknown',
      }));
      setEmployees(empList);

      const { data: plans } = await supabase
        .from('workout_plans')
        .select('id, patient_id')
        .eq('practitioner_id', user.id);

      const ptPlanIds = new Set((plans ?? []).map((p: any) => p.id));
      const patientIds = empList.map(e => e.id);

      const { data: workouts } = await supabase
        .from('synced_workouts')
        .select('user_id, date, data')
        .in('user_id', patientIds);

      const dateMap: Record<string, string[]> = {};
      for (const emp of empList) dateMap[emp.id] = [];

      for (const w of workouts ?? []) {
        const planId = w.data?.planId;
        if (!planId) continue;
        if (ptPlanIds.has(planId)) {
          dateMap[w.user_id]?.push(w.date);
        }
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
          currentStreak: calcCurrentStreak([...dates].sort()),
          longestStreak: calcLongestStreak([...periodDates].sort()),
          lastActive: dates.length ? [...dates].sort().at(-1)! : null,
        };
      })
      .sort((a, b) => b.workoutCount - a.workoutCount || b.currentStreak - a.currentStreak);
  }, [employees, allDates, period]);

  const totalWorkouts  = useMemo(() => entries.reduce((s, e) => s + e.workoutCount, 0), [entries]);
  const activeMembers  = useMemo(() => entries.filter(e => e.workoutCount > 0).length, [entries]);
  const avgWorkouts    = useMemo(() => employees.length > 0 ? (totalWorkouts / employees.length).toFixed(1) : '0', [totalWorkouts, employees]);
  const topStreak      = useMemo(() => entries.reduce((best, e) => e.currentStreak > best.currentStreak ? e : best, entries[0] ?? null), [entries]);

  const periodLabel: Record<Period, string> = { '7d': '7 Days', '1m': '1 Month', '4m': '4 Months' };

  const top3    = entries.slice(0, 3);
  const restRows = entries.slice(3);

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
              Team Leaderboard
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

        {entries.length === 0 ? (
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
                <div>Team Member</div>
                <div style={{ textAlign: 'center' }}>Workouts</div>
                <div style={{ textAlign: 'center' }}>Active Streak</div>
                <div style={{ textAlign: 'center' }}>Last Active</div>
              </div>

              {entries.map((entry, idx) => {
                const rank     = idx + 1;
                const medalEl  = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : null;
                const isTop    = rank <= 3;
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
        )}
      </main>
    </div>
  );
}
