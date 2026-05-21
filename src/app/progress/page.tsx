'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getSupabase } from '@/lib/supabase';

const TEAL   = '#5fcfbf';
const PURPLE = '#C471ED';
const YELLOW = '#F9F295';

/* ── Chart geometry ──────────────────────────────────────── */
const CW = 600, CH = 200;
const PAD = { top: 20, right: 16, bottom: 38, left: 50 };
const IW  = CW - PAD.left - PAD.right;
const IH  = CH - PAD.top  - PAD.bottom;

interface DataPoint      { date: string; value: number; }
interface BodyWeightRow  { id: string; date: string; weight_kg: number; }

function fmtDate(d: string) {
  const [, m, day] = d.split('-');
  return `${parseInt(m)}/${parseInt(day)}`;
}

function SvgChart({ data, color, yFmt = (v: number) => String(Math.round(v)), chartId }: {
  data: DataPoint[];
  color: string;
  yFmt?: (v: number) => string;
  chartId: string;
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

  const ys    = data.map(d => d.value);
  const minY  = Math.min(...ys), maxY = Math.max(...ys);
  const range = maxY === minY ? 1 : maxY - minY;
  const pMin  = minY - range * 0.1;
  const pMax  = maxY + range * 0.1;
  const pRng  = pMax - pMin;

  const tx = (i: number) => PAD.left + (i / (data.length - 1)) * IW;
  const ty = (y: number) => PAD.top  + (1 - (y - pMin) / pRng) * IH;

  const linePts = data.map((d, i) => `${tx(i)},${ty(d.value)}`).join(' ');
  const areaPts = [
    `${PAD.left},${PAD.top + IH}`,
    ...data.map((d, i) => `${tx(i)},${ty(d.value)}`),
    `${PAD.left + IW},${PAD.top + IH}`,
  ].join(' ');

  const yTicks  = [0, 0.25, 0.5, 0.75, 1].map(t => ({ v: pMin + t * pRng, cy: PAD.top + (1 - t) * IH }));
  const xStep   = Math.max(1, Math.ceil(data.length / 7));
  const xTicks  = data.map((d, i) => ({ d, i })).filter(({ i }) => i % xStep === 0 || i === data.length - 1);
  const gid     = `grad-${chartId}`;

  return (
    <svg viewBox={`0 0 ${CW} ${CH}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor={color} stopOpacity={0.28} />
          <stop offset="100%" stopColor={color} stopOpacity={0.02} />
        </linearGradient>
      </defs>

      {/* Grid + y-labels */}
      {yTicks.map((t, i) => (
        <g key={i}>
          <line x1={PAD.left} y1={t.cy} x2={PAD.left + IW} y2={t.cy}
            stroke="rgba(255,255,255,0.07)" strokeWidth={1} />
          <text x={PAD.left - 6} y={t.cy + 4} textAnchor="end" fontSize={10} fill="rgba(255,255,255,0.35)">
            {yFmt(t.v)}
          </text>
        </g>
      ))}

      {/* X-labels */}
      {xTicks.map(({ d, i }) => (
        <text key={i} x={tx(i)} y={PAD.top + IH + 16} textAnchor="middle" fontSize={10} fill="rgba(255,255,255,0.35)">
          {fmtDate(d.date)}
        </text>
      ))}

      {/* Area + line */}
      <polygon points={areaPts} fill={`url(#${gid})`} />
      <polyline points={linePts} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" />

      {/* Dots */}
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

  /* exercise progress */
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

      /* ── Load workout history ── */
      const { data: rows } = await sb
        .from('synced_workouts')
        .select('date, data')
        .eq('user_id', uid)
        .order('date', { ascending: true })
        .limit(500);

      const exMap:  Record<string, { id: string; name: string; type: string }> = {};
      const dataMap: Record<string, DataPoint[]> = {};

      (rows ?? []).forEach((row: any) => {
        const w    = row.data;
        const date: string = row.date || w?.date;
        if (!date) return;

        (w?.exercises ?? []).forEach((e: any) => {
          const ex = e.exercise;
          if (!ex?.id || !ex?.name) return;

          if (!exMap[ex.id]) exMap[ex.id] = { id: ex.id, name: ex.name, type: ex.type ?? 'weighted' };

          const sets: any[] = e.sets ?? [];
          let value = 0;
          if (ex.type === 'weighted') {
            value = Math.max(0, ...sets.map((s: any) => s.weight ?? 0));
          } else if (ex.type === 'duration') {
            value = Math.max(0, ...sets.map((s: any) => s.duration ?? s.seconds ?? 0));
          } else if (ex.type === 'cardio') {
            value = sets.reduce((sum: number, s: any) => sum + (s.cardioduration ?? s.minutes ?? 0), 0);
          }

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

      /* ── Load body weight ── */
      const { data: bw } = await sb
        .from('body_weight_logs')
        .select('id, date, weight_kg')
        .eq('user_id', uid)
        .order('date', { ascending: true });
      setBodyWts(bw ?? []);
    });
  }, [router]);

  const saveWeight = async () => {
    if (!newWt || !userId) return;
    setWtError('');
    setSavingWt(true);
    const sb  = getSupabase();
    const kg  = wtUnit === 'kg' ? parseFloat(newWt) : parseFloat(newWt) / 2.20462;
    const rounded = Math.round(kg * 10) / 10;

    const { data, error } = await sb
      .from('body_weight_logs')
      .upsert({ user_id: userId, date: newWtDate, weight_kg: rounded }, { onConflict: 'user_id,date' })
      .select('id, date, weight_kg')
      .single();

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

  /* ── Derived ── */
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
    selEx?.type === 'duration' ? 'Max duration per session (sec)' :
    'Total cardio per session (min)';

  const bwChartData: DataPoint[] = bodyWts.map(b => ({
    date: b.date,
    value: wtUnit === 'kg' ? b.weight_kg : Math.round(b.weight_kg * 2.20462 * 10) / 10,
  }));
  const bwLatest = bodyWts.length > 0 ? bodyWts[bodyWts.length - 1] : null;
  const bwFirst  = bodyWts.length > 1 ? bodyWts[0] : null;
  const bwChangeKg = bwLatest && bwFirst ? Math.round((bwLatest.weight_kg - bwFirst.weight_kg) * 10) / 10 : null;
  const bwChangeDisplay = bwChangeKg === null ? null
    : wtUnit === 'kg' ? `${bwChangeKg > 0 ? '+' : ''}${bwChangeKg}kg`
    : `${bwChangeKg > 0 ? '+' : ''}${Math.round(bwChangeKg * 2.20462 * 10) / 10}lbs`;

  const bwYFmt = (v: number) => `${v.toFixed(1)}${wtUnit}`;

  if (!authed) return (
    <div style={{ minHeight: '100vh', background: '#0f1117', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ width: 32, height: 32, border: `3px solid ${TEAL}`, borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
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
        <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 14, margin: '0 0 44px' }}>
          Track your strength gains and body weight over time.
        </p>

        {/* ── Exercise Progress ─────────────────────────── */}
        <section style={{ marginBottom: 52 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 20 }}>
            <h2 style={{ fontWeight: 700, fontSize: 18, margin: 0 }}>Exercise Progress</h2>
            {exercises.length > 0 && (
              <select
                value={selExId}
                onChange={e => setSelExId(e.target.value)}
                style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 8, padding: '8px 14px', color: '#fff', fontSize: 13, outline: 'none', cursor: 'pointer', minWidth: 220 }}
              >
                {exercises.map(ex => (
                  <option key={ex.id} value={ex.id} style={{ background: '#1a1d26' }}>{ex.name}</option>
                ))}
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
                {/* Stat pills */}
                <div style={{ display: 'flex', gap: 28, marginBottom: 24, flexWrap: 'wrap' }}>
                  <div>
                    <p style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 4px' }}>Personal Best</p>
                    <p style={{ fontSize: 24, fontWeight: 800, color: TEAL, margin: 0 }}>
                      {exBest !== null ? exYFmt(exBest) : '—'}
                    </p>
                  </div>
                  <div>
                    <p style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 4px' }}>Sessions</p>
                    <p style={{ fontSize: 24, fontWeight: 800, margin: 0 }}>{chartData.length}</p>
                  </div>
                  <div>
                    <p style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 4px' }}>Last Logged</p>
                    <p style={{ fontSize: 24, fontWeight: 800, margin: 0 }}>
                      {exLast ? fmtDate(exLast.date) : '—'}
                    </p>
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

        {/* ── Body Weight ───────────────────────────────── */}
        <section>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 20 }}>
            <h2 style={{ fontWeight: 700, fontSize: 18, margin: 0 }}>Body Weight</h2>

            {/* Log weight controls */}
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <input
                type="date"
                value={newWtDate}
                onChange={e => setNewWtDate(e.target.value)}
                style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8, padding: '7px 12px', color: '#fff', fontSize: 13, outline: 'none' }}
              />
              <input
                type="number" min={0} step={0.1}
                value={newWt}
                onChange={e => setNewWt(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && saveWeight()}
                placeholder={`Weight (${wtUnit})`}
                style={{ width: 130, background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8, padding: '7px 12px', color: '#fff', fontSize: 13, outline: 'none' }}
              />
              {/* kg / lbs toggle */}
              <div style={{ display: 'flex', background: 'rgba(255,255,255,0.06)', borderRadius: 8, border: '1px solid rgba(255,255,255,0.12)', overflow: 'hidden' }}>
                {(['kg', 'lbs'] as const).map(u => (
                  <button key={u} onClick={() => setWtUnit(u)}
                    style={{ padding: '7px 14px', background: wtUnit === u ? PURPLE : 'transparent', color: wtUnit === u ? '#fff' : 'rgba(255,255,255,0.4)', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: wtUnit === u ? 700 : 400 }}>
                    {u}
                  </button>
                ))}
              </div>
              <button
                onClick={saveWeight}
                disabled={savingWt || !newWt}
                style={{ background: PURPLE, color: '#fff', borderRadius: 8, padding: '7px 18px', fontWeight: 700, fontSize: 13, border: 'none', cursor: (!newWt || savingWt) ? 'not-allowed' : 'pointer', opacity: (!newWt || savingWt) ? 0.55 : 1 }}
              >
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
                    {wtUnit === 'kg'
                      ? `${bwLatest.weight_kg}kg`
                      : `${Math.round(bwLatest.weight_kg * 2.20462 * 10) / 10}lbs`}
                  </p>
                </div>
                {bwChangeDisplay !== null && (
                  <div>
                    <p style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 4px' }}>
                      Change since start
                    </p>
                    <p style={{ fontSize: 24, fontWeight: 800, margin: 0, color: bwChangeKg! < 0 ? TEAL : bwChangeKg! > 0 ? YELLOW : 'rgba(255,255,255,0.6)' }}>
                      {bwChangeDisplay}
                    </p>
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
              <p style={{ color: 'rgba(255,255,255,0.3)', fontSize: 13, textAlign: 'center', marginTop: 8 }}>
                Log your first weight entry using the form above.
              </p>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
