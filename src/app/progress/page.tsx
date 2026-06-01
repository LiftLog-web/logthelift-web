'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getSupabase } from '@/lib/supabase';
import { Sk, SkPage, SkNav } from '@/components/Skeleton';

const TEAL   = '#5fcfbf';
const PURPLE = '#C471ED';
const YELLOW = '#F9F295';

/* ── Types ─────────────────────────────────────────────────── */
interface WorkoutSet {
  id?: string;
  reps?: number; weight?: number; unit?: 'kg' | 'lbs';
  duration?: number; cardioduration?: number;
  speed?: number; incline?: number;
}
interface LoggedExercise {
  id: string;
  exercise: { id: string; name: string; muscleGroup?: string; type: string };
  sets: WorkoutSet[];
  targetSets?: WorkoutSet[];
  notes: string;
  practitionerNotes?: string;
}
interface WorkoutLog {
  id: string; date: string;
  exercises: LoggedExercise[];
  notes?: string; duration?: number;
  satisfactionRating?: 1 | 2 | 3 | 4 | 5;
  planId?: string;
}
type ExStatus = 'completed' | 'partial' | 'none';

const STATUS_COLOR: Record<ExStatus, string> = { completed: TEAL, partial: YELLOW, none: '#EF4444' };
const STATUS_LABEL: Record<ExStatus, string> = { completed: 'Completed', partial: 'Partial', none: 'Skipped' };

/* ── Helpers ────────────────────────────────────────────────── */
function exStatus(ex: LoggedExercise): ExStatus {
  const targets = ex.targetSets ?? [];
  if (targets.length === 0) return ex.sets.length > 0 ? 'completed' : 'none';
  let met = 0;
  for (let i = 0; i < targets.length; i++) {
    const t = targets[i]; const a = ex.sets[i];
    if (!a) break;
    if (t.reps !== undefined) { if ((a.reps ?? 0) >= t.reps && (a.weight ?? 0) >= (t.weight ?? 0)) met++; }
    else if (t.duration !== undefined) { if ((a.duration ?? 0) >= t.duration) met++; }
    else if (t.cardioduration !== undefined) { if ((a.cardioduration ?? 0) >= t.cardioduration) met++; }
    else met++;
  }
  if (met === 0 && ex.sets.length === 0) return 'none';
  if (met >= targets.length) return 'completed';
  return 'partial';
}

function setLabel(s: WorkoutSet, type: string): string {
  if (type === 'cardio')   return s.cardioduration ? `${s.cardioduration} min` : '—';
  if (type === 'duration') return s.duration       ? `${s.duration}s`         : '—';
  const w = s.weight !== undefined ? `${s.weight}${s.unit ?? 'kg'}` : '';
  const r = s.reps   !== undefined ? `${s.reps} reps`               : '';
  return [r, w].filter(Boolean).join(' × ') || '—';
}

function renderStars(rating: number): string {
  return '★'.repeat(Math.floor(rating)) + (rating % 1 >= 0.5 ? '½' : '') + '☆'.repeat(5 - Math.floor(rating) - (rating % 1 >= 0.5 ? 1 : 0));
}

function getWeekStartDate(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00');
  const day = d.getDay();
  d.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
  return d.toISOString().split('T')[0];
}

function weekLabel(weekStartStr: string): { range: string; badge: string | null } {
  const start = new Date(weekStartStr + 'T12:00:00');
  const end   = new Date(weekStartStr + 'T12:00:00');
  end.setDate(end.getDate() + 6);
  const today = new Date();
  const curDay = today.getDay();
  const thisMonday = new Date(today);
  thisMonday.setDate(today.getDate() - (curDay === 0 ? 6 : curDay - 1));
  thisMonday.setHours(12, 0, 0, 0);
  const lastMonday = new Date(thisMonday);
  lastMonday.setDate(lastMonday.getDate() - 7);
  const fmt = (d: Date) => d.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });
  const badge =
    start.getTime() === thisMonday.getTime() ? 'This Week' :
    start.getTime() === lastMonday.getTime() ? 'Last Week' : null;
  return { range: `${fmt(start)} – ${fmt(end)}`, badge };
}

/* ── Chart geometry ──────────────────────────────────────── */
const CW = 600, CH = 200;
const PAD = { top: 20, right: 16, bottom: 38, left: 50 };
const IW  = CW - PAD.left - PAD.right;
const IH  = CH - PAD.top  - PAD.bottom;

interface DataPoint     { date: string; value: number; }
interface BodyWeightRow { id: string; date: string; weight_kg: number; }

function fmtDate(d: string) {
  const [, m, day] = d.split('-');
  return `${parseInt(m)}/${parseInt(day)}`;
}

function SvgChart({ data, color, yFmt = (v: number) => String(Math.round(v)), chartId }: {
  data: DataPoint[]; color: string;
  yFmt?: (v: number) => string; chartId: string;
}) {
  if (data.length === 0) return (
    <div style={{ height: 180, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,0.25)', fontSize: 13 }}>
      No data yet — keep logging to see your progress!
    </div>
  );
  if (data.length === 1) return (
    <div style={{ height: 180, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,0.4)', fontSize: 14 }}>
      One session logged — keep going to see your trend!
    </div>
  );
  const ys = data.map(d => d.value);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const range = maxY === minY ? 1 : maxY - minY;
  const pMin = minY - range * 0.1, pMax = maxY + range * 0.1, pRng = pMax - pMin;
  const tx = (i: number) => PAD.left + (i / (data.length - 1)) * IW;
  const ty = (y: number) => PAD.top  + (1 - (y - pMin) / pRng) * IH;
  const linePts = data.map((d, i) => `${tx(i)},${ty(d.value)}`).join(' ');
  const areaPts = [`${PAD.left},${PAD.top + IH}`, ...data.map((d, i) => `${tx(i)},${ty(d.value)}`), `${PAD.left + IW},${PAD.top + IH}`].join(' ');
  const yTicks  = [0, 0.25, 0.5, 0.75, 1].map(t => ({ v: pMin + t * pRng, cy: PAD.top + (1 - t) * IH }));
  const xStep   = Math.max(1, Math.ceil(data.length / 7));
  const xTicks  = data.map((d, i) => ({ d, i })).filter(({ i }) => i % xStep === 0 || i === data.length - 1);
  const gid = `grad-${chartId}`;
  return (
    <svg viewBox={`0 0 ${CW} ${CH}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor={color} stopOpacity={0.28} />
          <stop offset="100%" stopColor={color} stopOpacity={0.02} />
        </linearGradient>
      </defs>
      {yTicks.map((t, i) => (
        <g key={i}>
          <line x1={PAD.left} y1={t.cy} x2={PAD.left + IW} y2={t.cy} stroke="rgba(255,255,255,0.07)" strokeWidth={1} />
          <text x={PAD.left - 6} y={t.cy + 4} textAnchor="end" fontSize={10} fill="rgba(255,255,255,0.35)">{yFmt(t.v)}</text>
        </g>
      ))}
      {xTicks.map(({ d, i }) => (
        <text key={i} x={tx(i)} y={PAD.top + IH + 16} textAnchor="middle" fontSize={10} fill="rgba(255,255,255,0.35)">{fmtDate(d.date)}</text>
      ))}
      <polygon points={areaPts} fill={`url(#${gid})`} />
      <polyline points={linePts} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" />
      {data.map((d, i) => (
        <g key={i}>
          <circle cx={tx(i)} cy={ty(d.value)} r={3.5} fill={color} />
          <title>{d.date}: {yFmt(d.value)}</title>
        </g>
      ))}
    </svg>
  );
}

/* ── Main page ───────────────────────────────────────────── */
export default function ProgressPage() {
  const router = useRouter();

  const [authed,    setAuthed]    = useState(false);
  const [userId,    setUserId]    = useState('');
  const [workouts,  setWorkouts]  = useState<WorkoutLog[]>([]);

  /* collapse state for log section */
  const [expandedWorkouts,  setExpandedWorkouts]  = useState<Set<string>>(new Set());
  const [expandedExs,       setExpandedExs]       = useState<Set<string>>(new Set());
  const [expandedWeeksLog,  setExpandedWeeksLog]  = useState<Set<string>>(new Set());

  /* exercise progress charts */
  const [exercises, setExercises] = useState<{ id: string; name: string; type: string }[]>([]);
  const [exData,    setExData]    = useState<Record<string, DataPoint[]>>({});
  const [selExId,   setSelExId]   = useState('');

  /* body weight */
  const [bodyWts,   setBodyWts]   = useState<BodyWeightRow[]>([]);
  const [newWt,     setNewWt]     = useState('');
  const [newWtDate, setNewWtDate] = useState(new Date().toISOString().split('T')[0]);
  const [wtUnit,    setWtUnit]    = useState<'kg' | 'lbs'>('kg');
  const [savingWt,  setSavingWt]  = useState(false);
  const [wtError,   setWtError]   = useState('');

  useEffect(() => {
    const sb = getSupabase();
    sb.auth.getSession().then(async ({ data }) => {
      if (!data.session) { router.push('/login'); return; }
      const uid = data.session.user.id;

      const { data: prof } = await sb.from('profiles').select('role').eq('id', uid).single();
      if (prof?.role !== 'patient') { router.push('/profile'); return; }

      setUserId(uid);
      setAuthed(true);

      const { data: rows } = await sb
        .from('synced_workouts')
        .select('date, data')
        .eq('user_id', uid)
        .order('date', { ascending: true })
        .limit(500);

      const logs: WorkoutLog[] = (rows ?? []).map((r: any) => r.data as WorkoutLog).filter(Boolean);
      setWorkouts(logs);

      /* restore week collapse state from localStorage */
      const allWeekKeys = new Set(logs.map(w => getWeekStartDate(w.date)));
      const storedCollapsed = localStorage.getItem(`my-progress-weeks-collapsed`);
      const collapsed: Set<string> = storedCollapsed ? new Set(JSON.parse(storedCollapsed)) : new Set();
      setExpandedWeeksLog(new Set([...allWeekKeys].filter(k => !collapsed.has(k))));

      /* build exercise chart data */
      const exMap:   Record<string, { id: string; name: string; type: string }> = {};
      const dataMap: Record<string, DataPoint[]> = {};
      (rows ?? []).forEach((row: any) => {
        const w = row.data; const date: string = row.date || w?.date;
        if (!date) return;
        (w?.exercises ?? []).forEach((e: any) => {
          const ex = e.exercise;
          if (!ex?.id || !ex?.name) return;
          if (!exMap[ex.id]) exMap[ex.id] = { id: ex.id, name: ex.name, type: ex.type ?? 'weighted' };
          const sets: any[] = e.sets ?? [];
          let value = 0;
          if (ex.type === 'weighted')      value = Math.max(0, ...sets.map((s: any) => s.weight ?? 0));
          else if (ex.type === 'duration') value = Math.max(0, ...sets.map((s: any) => s.duration ?? s.seconds ?? 0));
          else if (ex.type === 'cardio')   value = sets.reduce((sum: number, s: any) => sum + (s.cardioduration ?? s.minutes ?? 0), 0);
          if (value > 0) {
            if (!dataMap[ex.id]) dataMap[ex.id] = [];
            const existing = dataMap[ex.id].find(p => p.date === date);
            if (existing) existing.value = Math.max(existing.value, value);
            else dataMap[ex.id].push({ date, value });
          }
        });
      });

      const exList = Object.values(exMap).sort((a, b) => a.name.localeCompare(b.name));
      setExercises(exList);
      setExData(dataMap);
      if (exList.length > 0) setSelExId(exList[0].id);

      const { data: bw } = await sb
        .from('body_weight_logs').select('id, date, weight_kg')
        .eq('user_id', uid).order('date', { ascending: true });
      setBodyWts(bw ?? []);
    });
  }, [router]);

  const saveWeight = async () => {
    if (!newWt || !userId) return;
    setWtError(''); setSavingWt(true);
    const sb = getSupabase();
    const kg = wtUnit === 'kg' ? parseFloat(newWt) : parseFloat(newWt) / 2.20462;
    const rounded = Math.round(kg * 10) / 10;
    const { data, error } = await sb
      .from('body_weight_logs')
      .upsert({ user_id: userId, date: newWtDate, weight_kg: rounded }, { onConflict: 'user_id,date' })
      .select('id, date, weight_kg').single();
    setSavingWt(false);
    if (error) { setWtError(error.message); return; }
    if (data) {
      setBodyWts(prev => {
        const filtered = prev.filter(b => b.date !== (data as BodyWeightRow).date);
        return [...filtered, data as BodyWeightRow].sort((a, b) => a.date.localeCompare(b.date));
      });
      setNewWt('');
    }
  };

  /* ── Toggle handlers ── */
  const toggleWorkout = (id: string) =>
    setExpandedWorkouts(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const toggleEx = (id: string) =>
    setExpandedExs(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const toggleWeekLog = (key: string) =>
    setExpandedWeeksLog(prev => {
      const n = new Set(prev);
      n.has(key) ? n.delete(key) : n.add(key);
      const stored: string[] = JSON.parse(localStorage.getItem('my-progress-weeks-collapsed') ?? '[]');
      const updated = n.has(key) ? stored.filter(k => k !== key) : [...new Set([...stored, key])];
      localStorage.setItem('my-progress-weeks-collapsed', JSON.stringify(updated));
      return n;
    });

  /* ── Week-over-week computation ── */
  const weekMap = new Map<string, WorkoutLog[]>();
  for (const w of workouts) {
    const key = getWeekStartDate(w.date);
    if (!weekMap.has(key)) weekMap.set(key, []);
    weekMap.get(key)!.push(w);
  }
  const sortedWeekKeys  = [...weekMap.keys()].sort().reverse(); // newest first
  const chronoWeekKeys  = [...sortedWeekKeys].reverse();        // oldest first (for charts)

  const weekTrends = chronoWeekKeys.map(key => {
    const ws    = weekMap.get(key)!;
    const exs   = ws.flatMap(w => w.exercises ?? []);
    const withT = exs.filter(e => (e.targetSets ?? []).length > 0);
    const done  = withT.filter(e => exStatus(e) === 'completed').length;
    const rate  = withT.length > 0 ? Math.round((done / withT.length) * 100) : null;
    const totalSets = exs.reduce((a, e) => a + e.sets.length, 0);
    const { badge } = weekLabel(key);
    const shortLabel = new Date(key + 'T12:00:00').toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });
    return { key, shortLabel, badge, rate, totalSets };
  });

  const recentRates = weekTrends.slice(-3).map(wt => wt.rate).filter((r): r is number => r !== null);
  const rateChange  = recentRates.length >= 2 ? recentRates[recentRates.length - 1] - recentRates[recentRates.length - 2] : null;
  const trendSummaryText  = rateChange === null ? null : rateChange > 5 ? 'Completion trending up ↑' : rateChange < -5 ? 'Completion trending down ↓' : 'Completion stable →';
  const trendSummaryColor = rateChange === null ? 'rgba(255,255,255,0.35)' : rateChange > 5 ? TEAL : rateChange < -5 ? '#EF4444' : 'rgba(255,255,255,0.45)';

  const exProgressMap: Record<string, { weekKey: string; best: number; unit?: string; type: string }[]> = {};
  for (const key of chronoWeekKeys) {
    const bestPerEx: Record<string, { best: number; unit?: string; type: string }> = {};
    for (const w of weekMap.get(key)!) {
      for (const ex of w.exercises ?? []) {
        const name = ex.exercise.name; const type = ex.exercise.type;
        if (type === 'weighted') {
          const maxW = Math.max(0, ...ex.sets.map(s => s.weight ?? 0));
          if (maxW > 0) {
            const unit = ex.sets.find(s => s.weight)?.unit ?? 'kg';
            if (!bestPerEx[name] || maxW > bestPerEx[name].best) bestPerEx[name] = { best: maxW, unit, type };
          }
        } else if (type === 'duration') {
          const maxD = Math.max(0, ...ex.sets.map(s => s.duration ?? 0));
          if (maxD > 0) {
            if (!bestPerEx[name] || maxD > bestPerEx[name].best) bestPerEx[name] = { best: maxD, type };
          }
        }
      }
    }
    for (const [name, d] of Object.entries(bestPerEx)) {
      if (!exProgressMap[name]) exProgressMap[name] = [];
      exProgressMap[name].push({ weekKey: key, ...d });
    }
  }
  const progressExercises = Object.entries(exProgressMap)
    .filter(([, e]) => e.length >= 2).sort(([, a], [, b]) => b.length - a.length).slice(0, 8);

  /* ── Overall stats ── */
  const totalWorkouts  = workouts.length;
  const withPlan       = workouts.filter(w => w.planId);
  const allExercises   = workouts.flatMap(w => w.exercises ?? []);
  const withTargets    = allExercises.filter(e => (e.targetSets ?? []).length > 0);
  const completedCount = withTargets.filter(e => exStatus(e) === 'completed').length;
  const completionRate = withTargets.length > 0 ? Math.round((completedCount / withTargets.length) * 100) : null;
  const ratings        = workouts.map(w => w.satisfactionRating).filter((r): r is 1|2|3|4|5 => !!r);
  const avgRating      = ratings.length ? (ratings.reduce((a: number, b: number) => a + b, 0) / ratings.length).toFixed(1) : null;

  /* ── Exercise chart derived ── */
  const selEx     = exercises.find(e => e.id === selExId);
  const chartData = exData[selExId] ?? [];
  const exBest    = chartData.length > 0 ? Math.max(...chartData.map(d => d.value)) : null;
  const exLast    = chartData.length > 0 ? chartData[chartData.length - 1] : null;
  const exYFmt = (v: number) => {
    if (!selEx) return String(Math.round(v));
    if (selEx.type === 'weighted') return `${v % 1 === 0 ? v : v.toFixed(1)}kg`;
    if (selEx.type === 'duration') return `${Math.round(v)}s`;
    return `${Math.round(v)}min`;
  };
  const exMetricLabel =
    selEx?.type === 'weighted' ? 'Max weight per session' :
    selEx?.type === 'duration' ? 'Max duration per session (sec)' : 'Total cardio per session (min)';

  /* ── Body weight derived ── */
  const bwChartData: DataPoint[] = bodyWts.map(b => ({
    date: b.date,
    value: wtUnit === 'kg' ? b.weight_kg : Math.round(b.weight_kg * 2.20462 * 10) / 10,
  }));
  const bwLatest    = bodyWts.length > 0 ? bodyWts[bodyWts.length - 1] : null;
  const bwFirst     = bodyWts.length > 1 ? bodyWts[0] : null;
  const bwChangeKg  = bwLatest && bwFirst ? Math.round((bwLatest.weight_kg - bwFirst.weight_kg) * 10) / 10 : null;
  const bwChangeDisplay = bwChangeKg === null ? null
    : wtUnit === 'kg' ? `${bwChangeKg > 0 ? '+' : ''}${bwChangeKg}kg`
    : `${bwChangeKg > 0 ? '+' : ''}${Math.round(bwChangeKg * 2.20462 * 10) / 10}lbs`;
  const bwYFmt = (v: number) => `${v.toFixed(1)}${wtUnit}`;

  if (!authed) return (
    <SkPage>
      <SkNav />
      <main style={{ maxWidth: 900, margin: '0 auto', padding: '32px 24px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 14, marginBottom: 28 }}>
          {[0,1,2,3].map(i => (
            <div key={i} style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 16, padding: '18px 20px' }}>
              <Sk width={90} height={11} radius={3} style={{ marginBottom: 12 }} />
              <Sk width={60} height={28} radius={6} />
            </div>
          ))}
        </div>
        <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 20, padding: '24px', marginBottom: 16 }}>
          <Sk width={160} height={16} style={{ marginBottom: 20 }} />
          <Sk width="100%" height={120} radius={12} />
        </div>
        <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 20, padding: '24px' }}>
          <Sk width={140} height={16} style={{ marginBottom: 20 }} />
          <Sk width="100%" height={80} radius={12} />
        </div>
      </main>
    </SkPage>
  );

  return (
    <div style={{ minHeight: '100vh', background: '#0f1117', color: '#fff', fontFamily: 'sans-serif' }}>

      {/* Nav */}
      <nav style={{ borderBottom: '1px solid rgba(255,255,255,0.1)', padding: '16px 32px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', maxWidth: 900, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <a href="/profile" style={{ color: TEAL, fontWeight: 800, fontSize: 20, textDecoration: 'none' }}>LiftLog</a>
          <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: 14 }}>/ Progress</span>
        </div>
        <a href="/log" style={{ background: TEAL, color: '#0f1117', borderRadius: 10, padding: '8px 18px', fontSize: 13, fontWeight: 700, textDecoration: 'none' }}>
          + Log Workout
        </a>
      </nav>

      <main style={{ maxWidth: 900, margin: '0 auto', padding: '40px 32px' }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, margin: '0 0 6px' }}>Progress</h1>
        <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 14, margin: '0 0 32px' }}>
          Track your consistency, strength gains, and workout history.
        </p>

        {/* ── Stats cards ── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12, marginBottom: 36 }}>
          {[
            { label: 'Total Workouts',  value: String(totalWorkouts),                                color: TEAL   },
            { label: 'Plan Workouts',   value: String(withPlan.length),                              color: PURPLE },
            { label: 'Completion Rate', value: completionRate !== null ? `${completionRate}%` : '—', color: YELLOW },
            { label: 'Avg Satisfaction',value: avgRating ? `${avgRating}/5` : '—',                  color: TEAL   },
          ].map(s => (
            <div key={s.label} style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 14, padding: '16px 18px' }}>
              <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 6px' }}>{s.label}</p>
              <p style={{ fontSize: 20, fontWeight: 800, color: s.color, margin: 0 }}>{s.value}</p>
            </div>
          ))}
        </div>

        {/* ── Weekly summary ── */}
        {weekTrends.length >= 2 && (
          <section style={{ marginBottom: 52 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 14, flexWrap: 'wrap' }}>
              <h2 style={{ fontWeight: 700, fontSize: 18, margin: 0 }}>Weekly Summary</h2>
              <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.3)' }}>{weekTrends.length} weeks tracked</span>
              {trendSummaryText && <span style={{ fontSize: 12, fontWeight: 700, color: trendSummaryColor, marginLeft: 'auto' }}>{trendSummaryText}</span>}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
              {/* Completion rate */}
              <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 14, padding: '16px 18px' }}>
                <p style={{ margin: '0 0 14px', fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Completion Rate</p>
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: 5, height: 72 }}>
                  {weekTrends.map(wt => {
                    const h   = wt.rate !== null ? Math.max(4, (wt.rate / 100) * 64) : 4;
                    const col = wt.rate === null ? 'rgba(255,255,255,0.08)' : wt.rate >= 80 ? TEAL : wt.rate >= 50 ? YELLOW : '#EF4444';
                    return (
                      <div key={wt.key} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', height: '100%' }}>
                        {wt.rate !== null && <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.4)', marginBottom: 3 }}>{wt.rate}%</span>}
                        <div title={`${wt.shortLabel}: ${wt.rate ?? '—'}%`} style={{ width: '100%', height: h, background: col, borderRadius: 3, opacity: wt.badge ? 1 : 0.55 }} />
                      </div>
                    );
                  })}
                </div>
                <div style={{ display: 'flex', gap: 5, marginTop: 6 }}>
                  {weekTrends.map((wt, i) => {
                    const show = weekTrends.length <= 5 || wt.badge !== null || i === 0;
                    return (
                      <div key={wt.key} style={{ flex: 1, textAlign: 'center' }}>
                        <span style={{ fontSize: 9, color: wt.badge ? TEAL : 'rgba(255,255,255,0.25)' }}>
                          {show ? (wt.badge ?? wt.shortLabel) : ''}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Sets per week */}
              <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 14, padding: '16px 18px' }}>
                <p style={{ margin: '0 0 14px', fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Sets per Week</p>
                {(() => {
                  const max = Math.max(...weekTrends.map(wt => wt.totalSets), 1);
                  return (
                    <>
                      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 5, height: 72 }}>
                        {weekTrends.map(wt => {
                          const h = Math.max(4, (wt.totalSets / max) * 64);
                          const isCurrent = wt.badge === 'This Week';
                          return (
                            <div key={wt.key} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', height: '100%' }}>
                              <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.4)', marginBottom: 3 }}>{wt.totalSets}</span>
                              <div
                                title={`${wt.shortLabel}: ${wt.totalSets} sets${isCurrent ? ' (week in progress)' : ''}`}
                                style={{ width: '100%', height: h, background: isCurrent ? `${PURPLE}35` : PURPLE, borderRadius: 3, opacity: isCurrent ? 1 : wt.badge ? 1 : 0.55, border: isCurrent ? `1.5px dashed ${PURPLE}` : 'none', boxSizing: 'border-box' }}
                              />
                            </div>
                          );
                        })}
                      </div>
                      <div style={{ display: 'flex', gap: 5, marginTop: 6 }}>
                        {weekTrends.map((wt, i) => {
                          const show = weekTrends.length <= 5 || wt.badge !== null || i === 0;
                          return (
                            <div key={wt.key} style={{ flex: 1, textAlign: 'center' }}>
                              {show && (
                                <>
                                  <span style={{ fontSize: 9, color: wt.badge ? PURPLE : 'rgba(255,255,255,0.25)', display: 'block' }}>{wt.badge ?? wt.shortLabel}</span>
                                  {wt.badge === 'This Week' && <span style={{ fontSize: 8, color: 'rgba(255,255,255,0.28)', display: 'block' }}>so far</span>}
                                </>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </>
                  );
                })()}
              </div>
            </div>

            {/* Exercise progression */}
            {progressExercises.length > 0 && (
              <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 14, padding: '16px 18px' }}>
                <p style={{ margin: '0 0 16px', fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Exercise Progression</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  {progressExercises.map(([name, entries]) => {
                    const latest   = entries[entries.length - 1];
                    const prev     = entries[entries.length - 2];
                    const isW      = latest.type === 'weighted';
                    const fmt      = (e: typeof entries[0]) => isW ? `${e.best} ${e.unit ?? 'kg'}` : `${e.best}s`;
                    const delta    = prev.best > 0 ? ((latest.best - prev.best) / prev.best) * 100 : 0;
                    const trend    = delta > 1 ? '↑' : delta < -1 ? '↓' : '→';
                    const trendCol = delta > 1 ? TEAL : delta < -30 ? '#EF4444' : delta < -1 ? YELLOW : 'rgba(255,255,255,0.3)';
                    const maxVal   = Math.max(...entries.map(e => e.best), 1);
                    return (
                      <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</p>
                          <p style={{ margin: '3px 0 0', fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>
                            {fmt(prev)} → <span style={{ color: '#fff', fontWeight: 600 }}>{fmt(latest)}</span>
                            {Math.abs(delta) >= 1 && <span style={{ marginLeft: 8, color: trendCol, fontWeight: 700 }}>{delta > 0 ? '+' : ''}{Math.round(delta)}%</span>}
                          </p>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 32, flexShrink: 0 }}>
                          {entries.map((e, i) => (
                            <div key={i} style={{ width: 7, height: Math.max(3, (e.best / maxVal) * 28), background: i === entries.length - 1 ? TEAL : 'rgba(255,255,255,0.18)', borderRadius: 2 }} />
                          ))}
                        </div>
                        <div style={{ width: 26, textAlign: 'center', fontSize: 20, fontWeight: 800, color: trendCol, flexShrink: 0 }}>{trend}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </section>
        )}

        {/* ── Exercise Progress (detailed line chart) ── */}
        <section style={{ marginBottom: 52 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 20 }}>
            <h2 style={{ fontWeight: 700, fontSize: 18, margin: 0 }}>Exercise Progress</h2>
            {exercises.length > 0 && (
              <select value={selExId} onChange={e => setSelExId(e.target.value)}
                style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 8, padding: '8px 14px', color: '#fff', fontSize: 13, outline: 'none', cursor: 'pointer', minWidth: 220 }}>
                {exercises.map(ex => <option key={ex.id} value={ex.id} style={{ background: '#1a1d26' }}>{ex.name}</option>)}
              </select>
            )}
          </div>
          <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 20, padding: '24px 28px' }}>
            {exercises.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '32px 0' }}>
                <p style={{ color: 'rgba(255,255,255,0.3)', marginBottom: 12 }}>No workout history yet.</p>
                <a href="/log" style={{ color: TEAL, fontSize: 14, textDecoration: 'none', fontWeight: 600 }}>Log your first workout →</a>
              </div>
            ) : (
              <>
                <div style={{ display: 'flex', gap: 28, marginBottom: 24, flexWrap: 'wrap' }}>
                  <div>
                    <p style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 4px' }}>Personal Best</p>
                    <p style={{ fontSize: 24, fontWeight: 800, color: TEAL, margin: 0 }}>{exBest !== null ? exYFmt(exBest) : '—'}</p>
                  </div>
                  <div>
                    <p style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 4px' }}>Sessions</p>
                    <p style={{ fontSize: 24, fontWeight: 800, margin: 0 }}>{chartData.length}</p>
                  </div>
                  <div>
                    <p style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 4px' }}>Last Logged</p>
                    <p style={{ fontSize: 24, fontWeight: 800, margin: 0 }}>{exLast ? fmtDate(exLast.date) : '—'}</p>
                  </div>
                  <div style={{ alignSelf: 'flex-end', paddingBottom: 4 }}>
                    <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.3)', margin: 0 }}>{exMetricLabel}</p>
                  </div>
                </div>
                <SvgChart data={chartData} color={TEAL} yFmt={exYFmt} chartId="exercise" />
              </>
            )}
          </div>
        </section>

        {/* ── Body Weight ── */}
        <section style={{ marginBottom: 52 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 20 }}>
            <h2 style={{ fontWeight: 700, fontSize: 18, margin: 0 }}>Body Weight</h2>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <input type="date" value={newWtDate} onChange={e => setNewWtDate(e.target.value)}
                style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8, padding: '7px 12px', color: '#fff', fontSize: 13, outline: 'none' }} />
              <input type="number" min={0} step={0.1} value={newWt} onChange={e => setNewWt(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && saveWeight()} placeholder={`Weight (${wtUnit})`}
                style={{ width: 130, background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8, padding: '7px 12px', color: '#fff', fontSize: 13, outline: 'none' }} />
              <div style={{ display: 'flex', background: 'rgba(255,255,255,0.06)', borderRadius: 8, border: '1px solid rgba(255,255,255,0.12)', overflow: 'hidden' }}>
                {(['kg', 'lbs'] as const).map(u => (
                  <button key={u} onClick={() => setWtUnit(u)}
                    style={{ padding: '7px 14px', background: wtUnit === u ? PURPLE : 'transparent', color: wtUnit === u ? '#fff' : 'rgba(255,255,255,0.4)', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: wtUnit === u ? 700 : 400 }}>
                    {u}
                  </button>
                ))}
              </div>
              <button onClick={saveWeight} disabled={savingWt || !newWt}
                style={{ background: PURPLE, color: '#fff', borderRadius: 8, padding: '7px 18px', fontWeight: 700, fontSize: 13, border: 'none', cursor: (!newWt || savingWt) ? 'not-allowed' : 'pointer', opacity: (!newWt || savingWt) ? 0.55 : 1 }}>
                {savingWt ? '…' : 'Log'}
              </button>
            </div>
          </div>
          {wtError && <p style={{ color: '#EF4444', fontSize: 13, marginBottom: 12 }}>{wtError}</p>}
          <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 20, padding: '24px 28px' }}>
            {bwLatest && (
              <div style={{ display: 'flex', gap: 28, marginBottom: 24, flexWrap: 'wrap' }}>
                <div>
                  <p style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 4px' }}>Current</p>
                  <p style={{ fontSize: 24, fontWeight: 800, color: PURPLE, margin: 0 }}>
                    {wtUnit === 'kg' ? `${bwLatest.weight_kg}kg` : `${Math.round(bwLatest.weight_kg * 2.20462 * 10) / 10}lbs`}
                  </p>
                </div>
                {bwChangeDisplay !== null && (
                  <div>
                    <p style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 4px' }}>Change since start</p>
                    <p style={{ fontSize: 24, fontWeight: 800, margin: 0, color: bwChangeKg! < 0 ? TEAL : bwChangeKg! > 0 ? YELLOW : 'rgba(255,255,255,0.6)' }}>{bwChangeDisplay}</p>
                  </div>
                )}
                <div>
                  <p style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 4px' }}>Entries</p>
                  <p style={{ fontSize: 24, fontWeight: 800, margin: 0 }}>{bodyWts.length}</p>
                </div>
              </div>
            )}
            <SvgChart data={bwChartData} color={PURPLE} yFmt={bwYFmt} chartId="bodyweight" />
            {bodyWts.length === 0 && (
              <p style={{ color: 'rgba(255,255,255,0.3)', fontSize: 13, textAlign: 'center', marginTop: 8 }}>Log your first weight entry using the form above.</p>
            )}
          </div>
        </section>

        {/* ── Workout Log (week-grouped) ── */}
        <section>
          <h2 style={{ fontWeight: 700, fontSize: 18, margin: '0 0 20px' }}>Workout Log</h2>
          {workouts.length === 0 ? (
            <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 20, padding: 60, textAlign: 'center' }}>
              <p style={{ fontSize: 32, marginBottom: 12 }}>📭</p>
              <p style={{ color: 'rgba(255,255,255,0.4)' }}>No workouts synced yet.</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {sortedWeekKeys.map(weekKey => {
                const weekWorkouts = weekMap.get(weekKey)!;
                const { range, badge } = weekLabel(weekKey);
                const weekOpen = expandedWeeksLog.has(weekKey);

                const weekExercises   = weekWorkouts.flatMap(w => w.exercises ?? []);
                const weekWithTargets = weekExercises.filter(e => (e.targetSets ?? []).length > 0);
                const weekDone        = weekWithTargets.filter(e => exStatus(e) === 'completed').length;
                const weekRate        = weekWithTargets.length > 0 ? Math.round((weekDone / weekWithTargets.length) * 100) : null;
                const weekAllStatuses = weekExercises.map(exStatus);
                const weekOverall: ExStatus =
                  weekAllStatuses.length === 0 ? 'none'
                  : weekAllStatuses.every(s => s === 'completed') ? 'completed'
                  : weekAllStatuses.some(s => s === 'completed' || s === 'partial') ? 'partial'
                  : 'none';

                return (
                  <div key={weekKey}>
                    <button onClick={() => toggleWeekLog(weekKey)}
                      style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: weekOpen ? '12px 12px 0 0' : 12, cursor: 'pointer', textAlign: 'left', borderBottom: weekOpen ? '1px solid rgba(255,255,255,0.06)' : undefined }}>
                      <div style={{ width: 10, height: 10, borderRadius: '50%', background: STATUS_COLOR[weekOverall], flexShrink: 0 }} />
                      <span style={{ fontWeight: 700, fontSize: 15, color: '#fff' }}>{range}</span>
                      {badge && <span style={{ background: `${TEAL}25`, color: TEAL, fontSize: 11, fontWeight: 700, padding: '2px 9px', borderRadius: 999 }}>{badge}</span>}
                      <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)' }}>
                        {weekWorkouts.length} workout{weekWorkouts.length !== 1 ? 's' : ''}
                        {weekRate !== null ? ` · ${weekRate}% completion` : ''}
                      </span>
                      <span style={{ marginLeft: 'auto', color: 'rgba(255,255,255,0.3)', fontSize: 14, transform: weekOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s', display: 'inline-block' }}>▾</span>
                    </button>

                    {weekOpen && (
                      <div style={{ border: '1px solid rgba(255,255,255,0.1)', borderTop: 'none', borderRadius: '0 0 12px 12px', overflow: 'hidden' }}>
                        {weekWorkouts.slice().reverse().map((w, wi) => {
                          const isOpen   = expandedWorkouts.has(w.id);
                          const statuses = (w.exercises ?? []).map(exStatus);
                          const doneCount    = statuses.filter(s => s === 'completed').length;
                          const partialCount = statuses.filter(s => s === 'partial').length;
                          const total        = statuses.length;
                          const overallStatus: ExStatus =
                            total === 0 ? 'none'
                            : doneCount === total ? 'completed'
                            : doneCount + partialCount > 0 ? 'partial'
                            : 'none';

                          return (
                            <div key={w.id} style={{ borderTop: wi > 0 ? '1px solid rgba(255,255,255,0.06)' : undefined }}>
                              <button onClick={() => toggleWorkout(w.id)}
                                style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 16, padding: '14px 22px', background: isOpen ? `${PURPLE}0d` : 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left' }}>
                                <div style={{ width: 9, height: 9, borderRadius: '50%', background: STATUS_COLOR[overallStatus], flexShrink: 0 }} />
                                <span style={{ fontWeight: 700, fontSize: 14, minWidth: 110 }}>
                                  {new Date(w.date + 'T12:00:00').toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric' })}
                                </span>
                                {(w.duration ?? 0) > 0 && (
                                  <span style={{ background: 'rgba(255,255,255,0.07)', borderRadius: 6, padding: '2px 8px', fontSize: 12, color: 'rgba(255,255,255,0.45)' }}>{w.duration} min</span>
                                )}
                                {w.satisfactionRating && (
                                  <span style={{ fontSize: 12, color: YELLOW, fontWeight: 600 }}>{renderStars(w.satisfactionRating)} {w.satisfactionRating}/5</span>
                                )}
                                {total > 0 && (
                                  <div style={{ display: 'flex', gap: 4 }}>
                                    {(w.exercises ?? []).map((ex, i) => (
                                      <div key={i} title={`${ex.exercise.name}: ${STATUS_LABEL[statuses[i]]}`}
                                        style={{ width: 8, height: 8, borderRadius: 2, background: STATUS_COLOR[statuses[i]], flexShrink: 0 }} />
                                    ))}
                                  </div>
                                )}
                                <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.3)', whiteSpace: 'nowrap', marginLeft: 'auto' }}>
                                  {total > 0 ? `${doneCount}/${total} done${partialCount > 0 ? `, ${partialCount} partial` : ''}` : 'No exercises'}
                                </span>
                                <span style={{ color: 'rgba(255,255,255,0.25)', fontSize: 13, transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s', display: 'inline-block', flexShrink: 0 }}>▾</span>
                              </button>

                              {isOpen && (
                                <div style={{ borderTop: '1px solid rgba(255,255,255,0.07)', padding: '18px 22px', background: 'rgba(0,0,0,0.15)' }}>
                                  {w.notes?.trim() && (
                                    <div style={{ background: `${TEAL}10`, border: `1px solid ${TEAL}30`, borderRadius: 10, padding: '10px 14px', marginBottom: 16, display: 'flex', gap: 10 }}>
                                      <span style={{ fontSize: 14 }}>💬</span>
                                      <p style={{ margin: 0, fontSize: 14, color: 'rgba(255,255,255,0.75)', fontStyle: 'italic' }}>"{w.notes}"</p>
                                    </div>
                                  )}
                                  {(w.exercises ?? []).length === 0 ? (
                                    <p style={{ color: 'rgba(255,255,255,0.3)', fontSize: 14 }}>No exercises recorded.</p>
                                  ) : (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                      {(w.exercises ?? []).map(ex => {
                                        const st     = exStatus(ex);
                                        const exOpen = expandedExs.has(ex.id);
                                        const hasNote = ex.notes?.trim();
                                        const hasSets = ex.sets?.length > 0;
                                        return (
                                          <div key={ex.id} style={{ border: `1px solid ${STATUS_COLOR[st]}30`, borderRadius: 10, overflow: 'hidden' }}>
                                            <button onClick={() => toggleEx(ex.id)}
                                              style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '11px 16px', background: `${STATUS_COLOR[st]}08`, border: 'none', cursor: 'pointer', textAlign: 'left' }}>
                                              <span style={{ background: `${STATUS_COLOR[st]}25`, color: STATUS_COLOR[st], fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 999, whiteSpace: 'nowrap', flexShrink: 0 }}>{STATUS_LABEL[st]}</span>
                                              <span style={{ fontWeight: 600, fontSize: 14, flex: 1 }}>{ex.exercise.name}</span>
                                              <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)' }}>
                                                {ex.sets.length} set{ex.sets.length !== 1 ? 's' : ''}{(ex.targetSets ?? []).length > 0 ? ` / ${ex.targetSets!.length} target` : ''}
                                              </span>
                                              {hasNote && <span title="Note" style={{ fontSize: 13 }}>💬</span>}
                                              <span style={{ color: 'rgba(255,255,255,0.25)', fontSize: 12, transform: exOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s', display: 'inline-block', flexShrink: 0 }}>▾</span>
                                            </button>
                                            {exOpen && (
                                              <div style={{ borderTop: `1px solid ${STATUS_COLOR[st]}20`, padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                                                {hasSets && (
                                                  <div>
                                                    <p style={{ margin: '0 0 8px', fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Sets</p>
                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                                      {ex.sets.map((s, si) => {
                                                        const target = ex.targetSets?.[si];
                                                        const actual = setLabel(s, ex.exercise.type);
                                                        const tLabel = target ? setLabel(target, ex.exercise.type) : null;
                                                        let setMet: boolean | null = null;
                                                        if (target) {
                                                          if (target.reps !== undefined) setMet = (s.reps ?? 0) >= target.reps && (s.weight ?? 0) >= (target.weight ?? 0);
                                                          else if (target.duration !== undefined) setMet = (s.duration ?? 0) >= target.duration;
                                                          else if (target.cardioduration !== undefined) setMet = (s.cardioduration ?? 0) >= target.cardioduration;
                                                        }
                                                        return (
                                                          <div key={si} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13 }}>
                                                            <span style={{ width: 18, color: 'rgba(255,255,255,0.3)', flexShrink: 0, textAlign: 'right' }}>{si + 1}</span>
                                                            <span style={{ color: '#fff', minWidth: 100 }}>{actual}</span>
                                                            {tLabel && (
                                                              <>
                                                                <span style={{ color: 'rgba(255,255,255,0.25)', fontSize: 12 }}>target: {tLabel}</span>
                                                                {setMet !== null && <span style={{ color: setMet ? TEAL : '#EF4444', fontSize: 12 }}>{setMet ? '✓' : '✗'}</span>}
                                                              </>
                                                            )}
                                                          </div>
                                                        );
                                                      })}
                                                    </div>
                                                  </div>
                                                )}
                                                {hasNote && (
                                                  <div style={{ background: `${TEAL}0d`, border: `1px solid ${TEAL}25`, borderRadius: 8, padding: '8px 12px', display: 'flex', gap: 8 }}>
                                                    <span style={{ fontSize: 13 }}>💬</span>
                                                    <p style={{ margin: 0, fontSize: 13, color: 'rgba(255,255,255,0.7)', fontStyle: 'italic' }}>"{ex.notes}"</p>
                                                  </div>
                                                )}
                                              </div>
                                            )}
                                          </div>
                                        );
                                      })}
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
