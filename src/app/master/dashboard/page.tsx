'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { getSupabase } from '@/lib/supabase';

const TEAL   = '#5fcfbf';
const PURPLE = '#C471ED';
const MASTER_ID = process.env.NEXT_PUBLIC_FEATURED_PRACTITIONER_ID || '969ea6c6-ba6d-4ee4-8bb8-a7cee267f40c';

interface Stats {
  avg_effectiveness:     number | null;
  effectiveness_count:   number;
  avg_enjoyment:         number | null;
  enjoyment_count:       number;
  active_employer_count: number;
  total_employee_count:  number;
}

interface DayRating {
  plan_name:         string;
  day_id:            string;
  day_label:         string;
  day_order:         number;
  avg_effectiveness: number | null;
  avg_enjoyment:     number | null;
  rating_count:      number;
}

interface PlanTemplateExercise {
  exercise:   { name: string; muscleGroup: string; type: string };
  targetSets: number;
}

interface PlanTemplateDay {
  id:        string;
  label:     string;
  exercises: PlanTemplateExercise[];
}

interface UpcomingProgram {
  id:                      string;
  name:                    string;
  catalog_available_from:  string;
  catalog_available_until: string | null;
  featured_duration_days:  number | null;
}

function ScoreDisplay({ value, color, size = 44 }: { value: number; color: string; size?: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 3 }}>
      <span style={{ fontSize: size, fontWeight: 900, letterSpacing: '-0.03em', lineHeight: 1, color, fontVariantNumeric: 'tabular-nums' }}>
        {value.toFixed(1)}
      </span>
      <span style={{ fontSize: Math.round(size * 0.38), fontWeight: 700, color, opacity: 0.45 }}>
        /5
      </span>
    </div>
  );
}

function StarBar({ value, color }: { value: number; color: string }) {
  const filled = Math.round(value);
  return (
    <div style={{ display: 'flex', gap: 3 }}>
      {[1, 2, 3, 4, 5].map(i => (
        <div key={i} style={{ width: 22, height: 4, borderRadius: 99, background: i <= filled ? color : `${color}25` }} />
      ))}
    </div>
  );
}

function fmtDate(d: string) {
  return new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtMonth(d: string) {
  return new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

function isLive(p: UpcomingProgram): boolean {
  const today = new Date().toISOString().slice(0, 10);
  return p.catalog_available_from <= today && (!p.catalog_available_until || p.catalog_available_until >= today);
}

export default function MasterDashboardPage() {
  const router = useRouter();
  const [displayName, setDisplayName]       = useState('');
  const [email, setEmail]                   = useState('');
  const [stats, setStats]                   = useState<Stats | null>(null);
  const [upcoming, setUpcoming]             = useState<UpcomingProgram[]>([]);
  const [loading, setLoading]               = useState(true);
  const [monthlyWorkouts, setMonthlyWorkouts] = useState<number | null>(null);
  const [drillMetric, setDrillMetric]       = useState<'effectiveness' | 'enjoyment' | null>(null);
  const [drillData, setDrillData]           = useState<DayRating[] | null>(null);
  const [drillLoading, setDrillLoading]     = useState(false);
  const [templateMap, setTemplateMap]       = useState<Map<string, PlanTemplateDay[]>>(new Map());
  const [expandedDayKey, setExpandedDayKey] = useState<string | null>(null);
  const drillRef = useRef<HTMLDivElement>(null);

  const closeDrill = useCallback(() => {
    setDrillMetric(null);
    setDrillData(null);
    setExpandedDayKey(null);
  }, []);

  const openDrill = useCallback(async (metric: 'effectiveness' | 'enjoyment') => {
    setDrillMetric(metric);
    setDrillData(null);
    setDrillLoading(true);
    setExpandedDayKey(null);
    const sb = getSupabase();
    const [{ data: ratingsData }, { data: templates }] = await Promise.all([
      sb.rpc('get_featured_program_day_ratings', { p_practitioner_id: MASTER_ID }),
      sb.from('plan_templates').select('name, exercises').eq('practitioner_id', MASTER_ID).eq('is_featured', true),
    ]);
    setDrillData((ratingsData as DayRating[]) ?? []);
    const tMap = new Map<string, PlanTemplateDay[]>();
    (templates ?? []).forEach((t: any) => {
      tMap.set(t.name as string, (t.exercises?.days ?? []) as PlanTemplateDay[]);
    });
    setTemplateMap(tMap);
    setDrillLoading(false);
  }, []);

  useEffect(() => {
    if (!drillMetric) return;
    const handler = (e: MouseEvent) => {
      if (drillRef.current && !drillRef.current.contains(e.target as Node)) {
        closeDrill();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [drillMetric, closeDrill]);

  useEffect(() => {
    const sb = getSupabase();
    sb.auth.getSession().then(async ({ data }) => {
      if (!data.session || data.session.user.id !== MASTER_ID) {
        router.push('/login');
        return;
      }

      const today = new Date().toISOString().slice(0, 10);

      const [profResult, statsResult, upcomingResult] = await Promise.all([
        sb.from('profiles').select('display_name, email').eq('id', MASTER_ID).single(),
        sb.rpc('get_featured_program_stats', { p_practitioner_id: MASTER_ID }),
        sb
          .from('plan_templates')
          .select('id, name, catalog_available_from, catalog_available_until, featured_duration_days')
          .eq('practitioner_id', MASTER_ID)
          .eq('is_featured', true)
          .not('catalog_available_from', 'is', null)
          .gte('catalog_available_until', today)
          .order('catalog_available_from', { ascending: true })
          .limit(6),
      ]);

      setDisplayName((profResult.data as any)?.display_name ?? '');
      setEmail((profResult.data as any)?.email ?? '');
      setStats((statsResult.data as Stats[])?.[0] ?? null);
      setUpcoming((upcomingResult.data as UpcomingProgram[]) ?? []);
      setLoading(false);

      // Non-blocking: total workouts logged this month across all employer employees
      (async () => {
        const monthStart = new Date(); monthStart.setDate(1);
        const monthStartStr = monthStart.toISOString().slice(0, 10);
        const { data: tplData } = await sb.from('plan_templates').select('id').eq('practitioner_id', MASTER_ID).eq('is_featured', true);
        const tplIds = (tplData ?? []).map((t: any) => t.id as string);
        if (!tplIds.length) { setMonthlyWorkouts(0); return; }
        const { data: progData } = await sb.from('employer_programs').select('employer_id').in('plan_template_id', tplIds);
        const employerIds = [...new Set((progData ?? []).map((p: any) => p.employer_id as string))];
        if (!employerIds.length) { setMonthlyWorkouts(0); return; }
        const { data: linkData } = await sb.from('patient_links').select('patient_id').in('practitioner_id', employerIds);
        const patientIds = [...new Set((linkData ?? []).map((l: any) => l.patient_id as string))];
        if (!patientIds.length) { setMonthlyWorkouts(0); return; }
        const { count } = await sb.from('synced_workouts')
          .select('id', { count: 'exact', head: true })
          .in('user_id', patientIds)
          .gte('date', monthStartStr);
        setMonthlyWorkouts(count ?? 0);
      })();
    });
  }, [router]);

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p style={{ color: 'var(--text-muted)' }}>Loading…</p>
      </div>
    );
  }

  const noData = !stats || (stats.effectiveness_count === 0 && stats.enjoyment_count === 0);

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', color: 'var(--text)', fontFamily: 'sans-serif' }}>
      <main style={{ maxWidth: 900, margin: '0 auto', padding: '40px 32px' }}>

        {/* Header */}
        <div style={{ marginBottom: 36 }}>
          <h1 style={{ fontSize: 28, fontWeight: 800, margin: '0 0 6px', letterSpacing: '-0.02em' }}>Dashboard</h1>
          <p style={{ color: 'var(--text-muted)', margin: 0, fontSize: 14 }}>
            {displayName} · {email}
          </p>
        </div>

        {/* Row 1: operational stats */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, marginBottom: 14 }}>
          <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16, padding: '20px 22px' }}>
            <p style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-dim)', margin: '0 0 10px' }}>Active Clients</p>
            <p style={{ fontSize: 36, fontWeight: 900, color: 'var(--text)', margin: '0 0 6px', letterSpacing: '-0.025em', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
              {stats?.active_employer_count ?? '—'}
            </p>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>running a program</p>
          </div>

          <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16, padding: '20px 22px' }}>
            <p style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-dim)', margin: '0 0 10px' }}>Total Employees</p>
            <p style={{ fontSize: 36, fontWeight: 900, color: 'var(--text)', margin: '0 0 6px', letterSpacing: '-0.025em', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
              {stats?.total_employee_count ?? '—'}
            </p>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>across all clients</p>
          </div>

          <div style={{ background: `linear-gradient(135deg, var(--card) 50%, ${TEAL}08 100%)`, border: `1px solid ${TEAL}30`, borderRadius: 16, padding: '20px 22px' }}>
            <p style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-dim)', margin: '0 0 10px' }}>Workouts This Month</p>
            <p style={{ fontSize: 36, fontWeight: 900, color: TEAL, margin: '0 0 6px', letterSpacing: '-0.025em', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
              {monthlyWorkouts != null ? monthlyWorkouts : '—'}
            </p>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>across all employees</p>
          </div>
        </div>

        {/* Row 2: rating cards (clickable) */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 32 }}>
          {/* Avg Effectiveness */}
          <div
            onClick={() => stats?.avg_effectiveness != null && openDrill('effectiveness')}
            style={{
              background: `linear-gradient(135deg, var(--card) 40%, ${PURPLE}0c 100%)`,
              border: `1px solid ${PURPLE}35`,
              borderRadius: 16,
              padding: '22px 24px',
              cursor: stats?.avg_effectiveness != null ? 'pointer' : 'default',
              userSelect: 'none',
            }}
          >
            <p style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-dim)', margin: '0 0 12px' }}>Avg Effectiveness</p>
            {stats?.avg_effectiveness != null ? (
              <>
                <ScoreDisplay value={Number(stats.avg_effectiveness)} color={PURPLE} size={44} />
                <div style={{ height: 3, background: `${PURPLE}18`, borderRadius: 99, margin: '14px 0 12px', maxWidth: 170 }}>
                  <div style={{ width: `${(Number(stats.avg_effectiveness) / 5) * 100}%`, height: '100%', background: `linear-gradient(90deg, ${PURPLE}70, ${PURPLE})`, borderRadius: 99 }} />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <StarBar value={Number(stats.avg_effectiveness)} color={PURPLE} />
                  <span style={{ fontSize: 12, color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
                    {stats.effectiveness_count} rating{stats.effectiveness_count !== 1 ? 's' : ''}
                  </span>
                </div>
                <p style={{ fontSize: 11, color: PURPLE, margin: '12px 0 0', fontWeight: 700, letterSpacing: '0.02em' }}>View breakdown →</p>
              </>
            ) : (
              <p style={{ fontSize: 28, fontWeight: 900, color: 'var(--text-dim)', margin: '6px 0 0', letterSpacing: '-0.02em' }}>—</p>
            )}
          </div>

          {/* Avg Enjoyment */}
          <div
            onClick={() => stats?.avg_enjoyment != null && openDrill('enjoyment')}
            style={{
              background: `linear-gradient(135deg, var(--card) 40%, ${TEAL}0a 100%)`,
              border: `1px solid ${TEAL}35`,
              borderRadius: 16,
              padding: '22px 24px',
              cursor: stats?.avg_enjoyment != null ? 'pointer' : 'default',
              userSelect: 'none',
            }}
          >
            <p style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-dim)', margin: '0 0 12px' }}>Avg Enjoyment</p>
            {stats?.avg_enjoyment != null ? (
              <>
                <ScoreDisplay value={Number(stats.avg_enjoyment)} color={TEAL} size={44} />
                <div style={{ height: 3, background: `${TEAL}18`, borderRadius: 99, margin: '14px 0 12px', maxWidth: 170 }}>
                  <div style={{ width: `${(Number(stats.avg_enjoyment) / 5) * 100}%`, height: '100%', background: `linear-gradient(90deg, ${TEAL}70, ${TEAL})`, borderRadius: 99 }} />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <StarBar value={Number(stats.avg_enjoyment)} color={TEAL} />
                  <span style={{ fontSize: 12, color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
                    {stats.enjoyment_count} rating{stats.enjoyment_count !== 1 ? 's' : ''}
                  </span>
                </div>
                <p style={{ fontSize: 11, color: TEAL, margin: '12px 0 0', fontWeight: 700, letterSpacing: '0.02em' }}>View breakdown →</p>
              </>
            ) : (
              <p style={{ fontSize: 28, fontWeight: 900, color: 'var(--text-dim)', margin: '6px 0 0', letterSpacing: '-0.02em' }}>—</p>
            )}
          </div>
        </div>

        {noData && (
          <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16, padding: '28px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 14 }}>
            No rating data yet. Ratings appear once employees complete workouts and submit feedback in the app.
          </div>
        )}

        {/* Program Schedule */}
        <div style={{ marginTop: 32 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>Program Schedule</h2>
            <a href="/master/programs" style={{ fontSize: 13, color: TEAL, textDecoration: 'none', fontWeight: 600 }}>
              Manage →
            </a>
          </div>

          {upcoming.length === 0 ? (
            <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16, padding: '28px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 14 }}>
              No programs scheduled. Head to Programs to set catalog dates.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {upcoming.map(p => {
                const live = isLive(p);
                return (
                  <div
                    key={p.id}
                    style={{
                      background: 'var(--card)',
                      border: `1px solid ${live ? TEAL + '40' : 'var(--border)'}`,
                      borderRadius: 14,
                      padding: '16px 20px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 14,
                    }}
                  >
                    <div style={{
                      width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                      background: live ? TEAL : 'var(--border-strong)',
                      boxShadow: live ? `0 0 6px ${TEAL}80` : 'none',
                    }} />

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontSize: 14, fontWeight: 700, margin: '0 0 3px', color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {p.name}
                      </p>
                      <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>
                        {fmtDate(p.catalog_available_from)}
                        {p.catalog_available_until && ` → ${fmtDate(p.catalog_available_until)}`}
                      </p>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                      {p.featured_duration_days && (
                        <span style={{ fontSize: 11, fontWeight: 600, color: PURPLE, background: PURPLE + '18', borderRadius: 999, padding: '2px 8px' }}>
                          {p.featured_duration_days}d
                        </span>
                      )}
                      <span style={{
                        fontSize: 11, fontWeight: 700, borderRadius: 999, padding: '3px 10px',
                        background: live ? TEAL + '18' : `${TEAL}08`,
                        color: live ? TEAL : 'var(--text-dim)',
                        border: `1px solid ${live ? TEAL + '40' : 'var(--border-strong)'}`,
                      }}>
                        {live ? 'LIVE' : fmtMonth(p.catalog_available_from)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

      </main>

      {/* Ratings drill-down modal */}
      {drillMetric && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1001, padding: '40px 24px' }}>
          <div
            ref={drillRef}
            style={{ background: 'var(--modal-bg)', border: '1px solid var(--border)', borderRadius: 24, width: '100%', maxWidth: 700, display: 'flex', flexDirection: 'column', maxHeight: 'calc(100vh - 80px)' }}
          >
            {/* Modal header */}
            <div style={{ padding: '22px 28px 18px', flexShrink: 0, borderBottom: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
              <div>
                <h2 style={{ fontSize: 18, fontWeight: 800, margin: '0 0 4px', color: 'var(--text)', letterSpacing: '-0.015em' }}>
                  {drillMetric === 'effectiveness' ? 'Effectiveness' : 'Enjoyment'} Breakdown
                </h2>
                <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>
                  Plans ranked by score · tap a day to see its exercises
                </p>
              </div>
              <button
                onClick={closeDrill}
                style={{ background: 'none', border: 'none', fontSize: 22, color: 'var(--text-muted)', cursor: 'pointer', lineHeight: 1, padding: 0, flexShrink: 0 }}
              >×</button>
            </div>

            {/* Scrollable content */}
            <div style={{ overflowY: 'auto', padding: '20px 28px 28px', flex: 1 }}>
              {drillLoading && (
                <p style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '40px 0', margin: 0 }}>Loading…</p>
              )}
              {!drillLoading && drillData?.length === 0 && (
                <p style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '40px 0', margin: 0, fontSize: 14 }}>No rated workouts found.</p>
              )}
              {!drillLoading && drillData && drillData.length > 0 && (() => {
                const color      = drillMetric === 'effectiveness' ? PURPLE : TEAL;
                const otherColor = drillMetric === 'effectiveness' ? TEAL : PURPLE;
                const metricKey  = drillMetric === 'effectiveness' ? 'avg_effectiveness' as const : 'avg_enjoyment' as const;
                const otherKey   = drillMetric === 'effectiveness' ? 'avg_enjoyment' as const : 'avg_effectiveness' as const;
                const otherLabel = drillMetric === 'effectiveness' ? 'enj' : 'eff';

                // Group by plan
                const planMap = new Map<string, DayRating[]>();
                drillData.forEach(row => {
                  const existing = planMap.get(row.plan_name);
                  if (existing) existing.push(row);
                  else planMap.set(row.plan_name, [row]);
                });

                // Sort plans by weighted avg of focused metric (best first)
                const sortedPlans = [...planMap.entries()].sort((a, b) => {
                  const wavg = (rows: DayRating[], key: typeof metricKey) => {
                    let total = 0, count = 0;
                    rows.forEach(r => { if (r[key] != null) { total += (r[key] as number) * r.rating_count; count += r.rating_count; } });
                    return count > 0 ? total / count : 0;
                  };
                  return wavg(b[1], metricKey) - wavg(a[1], metricKey);
                });

                return (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
                    {/* Column header */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <span style={{ width: 16, flexShrink: 0 }} />
                      <span style={{ width: 120, flexShrink: 0, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text-dim)' }}>Day</span>
                      <span style={{ flex: 1, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text-dim)' }}>Score</span>
                      <span style={{ width: 36, textAlign: 'right', flexShrink: 0, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color }}>★</span>
                      <span style={{ width: 44, textAlign: 'right', flexShrink: 0, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: otherColor }}>{otherLabel}</span>
                      <span style={{ width: 24, textAlign: 'right', flexShrink: 0, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text-dim)' }}>#</span>
                    </div>

                    {sortedPlans.map(([planName, days]) => {
                      const sortedDays    = [...days].sort((a, b) => (a.day_order ?? 0) - (b.day_order ?? 0));
                      const sortedByScore = [...days].sort((a, b) => ((b[metricKey] ?? 0) - (a[metricKey] ?? 0)));
                      const totalCount    = days.reduce((s, r) => s + r.rating_count, 0);
                      const wavgNum       = days.reduce((s, r) => s + ((r[metricKey] ?? 0) * r.rating_count), 0) / (totalCount || 1);
                      const planDays      = templateMap.get(planName) ?? [];
                      const topDay        = sortedByScore[0];
                      const bottomDay     = sortedByScore[sortedByScore.length - 1];
                      const hasTpl        = planDays.length > 0;

                      const getExercises = (dayId: string): PlanTemplateExercise[] => {
                        const tmplDay = planDays.find(td => td.id === dayId);
                        return tmplDay?.exercises ?? [];
                      };

                      return (
                        <div key={planName}>
                          {/* Plan header */}
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, paddingBottom: 12, borderBottom: '1px solid var(--border-subtle)' }}>
                            <span style={{ flex: 1, fontSize: 14, fontWeight: 800, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', letterSpacing: '-0.01em' }}>
                              {planName}
                            </span>
                            <span style={{ fontSize: 11, color: 'var(--text-muted)', flexShrink: 0 }}>{totalCount} ratings</span>
                            <div style={{ display: 'flex', alignItems: 'baseline', gap: 2, flexShrink: 0 }}>
                              <span style={{ fontSize: 20, fontWeight: 900, color, letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums' }}>
                                {wavgNum.toFixed(1)}
                              </span>
                              <span style={{ fontSize: 11, fontWeight: 700, color, opacity: 0.45 }}>/5</span>
                            </div>
                          </div>

                          {/* Top / bottom highlights */}
                          {hasTpl && topDay && bottomDay && topDay.day_id !== bottomDay.day_id && (
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
                              <div style={{ background: `${color}0b`, border: `1px solid ${color}22`, borderRadius: 10, padding: '10px 12px' }}>
                                <div style={{ display: 'flex', alignItems: 'center', marginBottom: 5 }}>
                                  <span style={{ fontSize: 9, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.07em', color, opacity: 0.85, flex: 1 }}>Top Rated</span>
                                  <span style={{ fontSize: 11, fontWeight: 700, color, fontVariantNumeric: 'tabular-nums' }}>{(topDay[metricKey] ?? 0).toFixed(1)}★</span>
                                </div>
                                <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--text)', margin: '0 0 3px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                  {topDay.day_label || `Day ${topDay.day_order}`}
                                </p>
                                <p style={{ fontSize: 10, color: 'var(--text-muted)', margin: 0, lineHeight: 1.5 }}>
                                  {getExercises(topDay.day_id).slice(0, 3).map(e => e.exercise.name).join(' · ') || '—'}
                                </p>
                              </div>
                              <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 12px' }}>
                                <div style={{ display: 'flex', alignItems: 'center', marginBottom: 5 }}>
                                  <span style={{ fontSize: 9, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text-dim)', flex: 1 }}>Needs Attention</span>
                                  <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>{(bottomDay[metricKey] ?? 0).toFixed(1)}★</span>
                                </div>
                                <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--text)', margin: '0 0 3px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                  {bottomDay.day_label || `Day ${bottomDay.day_order}`}
                                </p>
                                <p style={{ fontSize: 10, color: 'var(--text-muted)', margin: 0, lineHeight: 1.5 }}>
                                  {getExercises(bottomDay.day_id).slice(0, 3).map(e => e.exercise.name).join(' · ') || '—'}
                                </p>
                              </div>
                            </div>
                          )}

                          {/* Day rows */}
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                            {sortedDays.map(day => {
                              const score      = day[metricKey];
                              const otherScore = day[otherKey];
                              const barPct     = score != null ? Math.round((score / 5) * 100) : 0;
                              const dayKey     = `${planName}::${day.day_id}`;
                              const isExpanded = expandedDayKey === dayKey;
                              const exercises  = getExercises(day.day_id);

                              return (
                                <div key={day.day_id} style={{ borderRadius: 8, overflow: 'hidden' }}>
                                  {/* Clickable row */}
                                  <div
                                    onClick={() => setExpandedDayKey(isExpanded ? null : dayKey)}
                                    style={{
                                      display: 'flex', alignItems: 'center', gap: 12,
                                      padding: '8px 10px',
                                      cursor: 'pointer',
                                      background: isExpanded ? `${color}08` : 'transparent',
                                    }}
                                  >
                                    <span style={{ width: 16, flexShrink: 0, fontSize: 8, color: 'var(--text-dim)', display: 'inline-block', transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.15s' }}>▶</span>
                                    <span style={{ width: 120, flexShrink: 0, fontSize: 12, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                      {day.day_label || `Day ${day.day_order}`}
                                    </span>
                                    <div style={{ flex: 1, height: 6, background: `${color}18`, borderRadius: 99, overflow: 'hidden' }}>
                                      <div style={{ width: `${barPct}%`, height: '100%', background: `linear-gradient(90deg, ${color}70, ${color})`, borderRadius: 99 }} />
                                    </div>
                                    <span style={{ width: 36, textAlign: 'right', flexShrink: 0, fontSize: 13, fontWeight: 700, color, fontVariantNumeric: 'tabular-nums' }}>
                                      {score != null ? score.toFixed(1) : '—'}
                                    </span>
                                    <span style={{ width: 44, textAlign: 'right', flexShrink: 0, fontSize: 11, fontWeight: 600, color: otherColor, fontVariantNumeric: 'tabular-nums' }}>
                                      {otherScore != null ? otherScore.toFixed(1) : '—'}
                                    </span>
                                    <span style={{ width: 24, textAlign: 'right', flexShrink: 0, fontSize: 11, color: 'var(--text-dim)', fontVariantNumeric: 'tabular-nums' }}>
                                      {day.rating_count}
                                    </span>
                                  </div>

                                  {/* Exercise list (expanded) */}
                                  {isExpanded && (
                                    <div style={{ marginLeft: 28, marginTop: 0, marginBottom: 6, paddingLeft: 12, paddingTop: 4, borderLeft: `2px solid ${color}30` }}>
                                      {exercises.length === 0 ? (
                                        <p style={{ fontSize: 11, color: 'var(--text-dim)', margin: '6px 0', fontStyle: 'italic' }}>No exercise data available</p>
                                      ) : exercises.map((pe, i) => (
                                        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 8px', borderRadius: 6 }}>
                                          <span style={{ width: 5, height: 5, borderRadius: '50%', background: color, flexShrink: 0, opacity: 0.65 }} />
                                          <span style={{ flex: 1, fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>{pe.exercise.name}</span>
                                          <span style={{ fontSize: 11, color: 'var(--text-muted)', flexShrink: 0 }}>{pe.exercise.muscleGroup}</span>
                                          <span style={{ fontSize: 10, color: 'var(--text-dim)', flexShrink: 0 }}>{pe.targetSets}×</span>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}