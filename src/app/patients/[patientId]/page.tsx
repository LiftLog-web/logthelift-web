'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { getSupabase } from '@/lib/supabase';

const TEAL   = '#5fcfbf';
const PURPLE = '#C471ED';
const YELLOW = '#F9F295';

/* ── Types matching GymTracker's WorkoutLog ─────────────────────── */
interface WorkoutSet {
  id?: string;
  reps?: number;
  weight?: number;
  unit?: 'kg' | 'lbs';
  duration?: number;       // seconds (duration exercises)
  cardioduration?: number; // minutes (cardio)
  speed?: number;
  incline?: number;
}

interface LoggedExercise {
  id: string;
  exercise: { id: string; name: string; muscleGroup: string; type: string };
  sets: WorkoutSet[];
  targetSets?: WorkoutSet[];
  notes: string;
  practitionerNotes?: string;
}

interface WorkoutLog {
  id: string;
  date: string;
  exercises: LoggedExercise[];
  notes: string;
  duration: number;
  planId?: string;
  satisfactionRating?: 1 | 2 | 3 | 4 | 5;
}

type ExStatus = 'completed' | 'partial' | 'none';

/* ── Completion logic (mirrors GymTracker/src/lib/completion.ts) ── */
function exStatus(ex: LoggedExercise): ExStatus {
  const targets = ex.targetSets ?? [];
  if (targets.length === 0) return ex.sets.length > 0 ? 'completed' : 'none';

  let met = 0;
  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    const a = ex.sets[i];
    if (!a) break;
    if (t.reps !== undefined) {
      if ((a.reps ?? 0) >= t.reps && (a.weight ?? 0) >= (t.weight ?? 0)) met++;
    } else if (t.duration !== undefined) {
      if ((a.duration ?? 0) >= t.duration) met++;
    } else if (t.cardioduration !== undefined) {
      if ((a.cardioduration ?? 0) >= t.cardioduration) met++;
    } else {
      met++;
    }
  }

  if (met === 0 && ex.sets.length === 0) return 'none';
  if (met >= targets.length) return 'completed';
  return 'partial';
}

const SATISFACTION = ['', '😫', '😕', '😐', '💪', '🔥'];
const STATUS_COLOR: Record<ExStatus, string> = {
  completed: TEAL,
  partial:   YELLOW,
  none:      '#EF4444',
};
const STATUS_LABEL: Record<ExStatus, string> = {
  completed: 'Completed',
  partial:   'Partial',
  none:      'Skipped',
};

function setLabel(s: WorkoutSet, type: string): string {
  if (type === 'cardio')    return s.cardioduration ? `${s.cardioduration} min` : '—';
  if (type === 'duration')  return s.duration       ? `${s.duration}s`          : '—';
  const w = s.weight !== undefined ? `${s.weight}${s.unit ?? 'kg'}` : '';
  const r = s.reps    !== undefined ? `${s.reps} reps`                : '';
  return [r, w].filter(Boolean).join(' × ') || '—';
}

/* ── Component ──────────────────────────────────────────────────── */
export default function PatientProgressPage() {
  const router    = useRouter();
  const { patientId } = useParams<{ patientId: string }>();

  const [authed,       setAuthed]       = useState(false);
  const [patientName,  setPatientName]  = useState('');
  const [workouts,     setWorkouts]     = useState<WorkoutLog[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [expanded,     setExpanded]     = useState<Set<string>>(new Set());
  const [expandedEx,   setExpandedEx]   = useState<Set<string>>(new Set());
  const [noAccess,     setNoAccess]     = useState(false);

  useEffect(() => {
    if (!patientId) return;
    const sb = getSupabase();

    sb.auth.getSession().then(async ({ data }) => {
      if (!data.session) { router.push('/login'); return; }

      const uid = data.session.user.id;
      const { data: prof } = await sb.from('profiles').select('role, is_gym_owner').eq('id', uid).single();
      if (prof?.role !== 'practitioner' && !prof?.is_gym_owner) { router.push('/profile'); return; }

      // Verify this patient is linked to the practitioner
      const { data: link } = await sb
        .from('patient_links')
        .select('patient_id')
        .eq('practitioner_id', uid)
        .eq('patient_id', patientId)
        .single();

      if (!link) { setNoAccess(true); setLoading(false); return; }

      // Load patient name
      const { data: patProf } = await sb.from('profiles').select('display_name').eq('id', patientId).single();
      setPatientName(patProf?.display_name ?? 'Patient');

      // Load workouts
      const { data: rows } = await sb
        .from('synced_workouts')
        .select('data, date')
        .eq('user_id', patientId)
        .order('date', { ascending: false })
        .limit(100);

      const logs: WorkoutLog[] = (rows ?? [])
        .map((r: any) => r.data as WorkoutLog)
        .filter(Boolean);

      setWorkouts(logs);
      setAuthed(true);
      setLoading(false);
    });
  }, [patientId, router]);

  const toggleWorkout = (id: string) =>
    setExpanded(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const toggleEx = (id: string) =>
    setExpandedEx(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  /* ── Stats ── */
  const totalWorkouts  = workouts.length;
  const withPlan       = workouts.filter(w => w.planId);
  const allExercises   = workouts.flatMap(w => w.exercises ?? []);
  const withTargets    = allExercises.filter(e => (e.targetSets ?? []).length > 0);
  const completedCount = withTargets.filter(e => exStatus(e) === 'completed').length;
  const completionRate = withTargets.length > 0 ? Math.round((completedCount / withTargets.length) * 100) : null;
  const ratings        = workouts.map(w => w.satisfactionRating).filter((r): r is 1|2|3|4|5 => !!r);
  const avgRating      = ratings.length ? (ratings.reduce((a: number, b: number) => a + b, 0) / ratings.length).toFixed(1) : null;

  /* ── Loading / error ── */
  if (loading || !authed) {
    return (
      <div style={{ minHeight: '100vh', background: '#0f1117', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {noAccess
          ? <p style={{ color: 'rgba(255,255,255,0.5)' }}>You don't have access to this patient's data.</p>
          : <><div style={{ width: 32, height: 32, border: `3px solid ${TEAL}`, borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} /><style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style></>
        }
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: '#0f1117', color: '#fff', fontFamily: 'sans-serif' }}>

      {/* Nav */}
      <nav style={{ borderBottom: '1px solid rgba(255,255,255,0.1)', padding: '16px 32px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', maxWidth: 1100, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <a href="/" style={{ color: TEAL, fontWeight: 800, fontSize: 20, textDecoration: 'none' }}>LiftLog</a>
          <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: 14 }}>
            / <a href="/plans" style={{ color: 'rgba(255,255,255,0.5)', textDecoration: 'none' }}>Plans</a> / {patientName}
          </span>
        </div>
        <button
          onClick={() => router.push('/plans')}
          style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.15)', color: 'rgba(255,255,255,0.6)', borderRadius: 10, padding: '8px 16px', fontSize: 13, cursor: 'pointer' }}
        >
          ← Back to Plans
        </button>
      </nav>

      <main style={{ maxWidth: 1100, margin: '0 auto', padding: '40px 32px' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 20, marginBottom: 32 }}>
          <div style={{ width: 56, height: 56, borderRadius: '50%', background: `${PURPLE}30`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, flexShrink: 0 }}>
            🏋️
          </div>
          <div>
            <h1 style={{ fontSize: 26, fontWeight: 800, margin: 0 }}>{patientName}</h1>
            <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 14, margin: '4px 0 0' }}>Workout Progress</p>
          </div>
        </div>

        {/* Stats row */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12, marginBottom: 36 }}>
          {[
            { label: 'Total Workouts',   value: String(totalWorkouts),                    color: TEAL   },
            { label: 'Plan Workouts',    value: String(withPlan.length),                  color: PURPLE },
            { label: 'Completion Rate',  value: completionRate !== null ? `${completionRate}%` : '—', color: YELLOW },
            { label: 'Avg Satisfaction', value: avgRating ? `${SATISFACTION[Math.round(Number(avgRating))]} ${avgRating}` : '—', color: TEAL },
          ].map(s => (
            <div key={s.label} style={{ background: 'rgba(255,255,255,0.04)', border: `1px solid rgba(255,255,255,0.08)`, borderRadius: 14, padding: '18px 20px' }}>
              <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 6px' }}>{s.label}</p>
              <p style={{ fontSize: 22, fontWeight: 800, color: s.color, margin: 0 }}>{s.value}</p>
            </div>
          ))}
        </div>

        {/* Workout list */}
        {workouts.length === 0 ? (
          <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 20, padding: 60, textAlign: 'center' }}>
            <p style={{ fontSize: 36, marginBottom: 12 }}>📭</p>
            <p style={{ color: 'rgba(255,255,255,0.4)' }}>No workouts synced yet for this patient.</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {workouts.map(w => {
              const isOpen       = expanded.has(w.id);
              const statuses     = (w.exercises ?? []).map(exStatus);
              const doneCount    = statuses.filter(s => s === 'completed').length;
              const partialCount = statuses.filter(s => s === 'partial').length;
              const noneCount    = statuses.filter(s => s === 'none').length;
              const total        = statuses.length;

              const overallStatus: ExStatus =
                total === 0          ? 'none'
                : doneCount === total  ? 'completed'
                : doneCount + partialCount > 0 ? 'partial'
                : 'none';

              return (
                <div key={w.id} style={{ border: `1px solid ${isOpen ? PURPLE + '50' : 'rgba(255,255,255,0.09)'}`, borderRadius: 14, overflow: 'hidden' }}>

                  {/* Workout header */}
                  <button
                    onClick={() => toggleWorkout(w.id)}
                    style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 16, padding: '16px 22px', background: isOpen ? `${PURPLE}0d` : 'rgba(255,255,255,0.02)', border: 'none', cursor: 'pointer', textAlign: 'left' }}
                  >
                    {/* Status dot */}
                    <div style={{ width: 10, height: 10, borderRadius: '50%', background: STATUS_COLOR[overallStatus], flexShrink: 0 }} />

                    {/* Date */}
                    <span style={{ fontWeight: 700, fontSize: 15, minWidth: 110 }}>
                      {new Date(w.date + 'T12:00:00').toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric' })}
                    </span>

                    {/* Duration */}
                    {w.duration > 0 && (
                      <span style={{ background: 'rgba(255,255,255,0.07)', borderRadius: 6, padding: '3px 9px', fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>
                        {w.duration} min
                      </span>
                    )}

                    {/* Satisfaction */}
                    {w.satisfactionRating && (
                      <span style={{ fontSize: 16 }}>{SATISFACTION[w.satisfactionRating]}</span>
                    )}

                    {/* Mini completion bars */}
                    {total > 0 && (
                      <div style={{ display: 'flex', gap: 4, flex: 1 }}>
                        {(w.exercises ?? []).map((ex, i) => (
                          <div key={i} title={`${ex.exercise.name}: ${STATUS_LABEL[statuses[i]]}`} style={{ width: 8, height: 8, borderRadius: 2, background: STATUS_COLOR[statuses[i]], flexShrink: 0 }} />
                        ))}
                      </div>
                    )}

                    {/* Summary text */}
                    <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)', whiteSpace: 'nowrap', marginLeft: 'auto' }}>
                      {total > 0 ? `${doneCount}/${total} done${partialCount > 0 ? `, ${partialCount} partial` : ''}` : 'No exercises'}
                    </span>

                    <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: 14, transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s', display: 'inline-block', flexShrink: 0 }}>▾</span>
                  </button>

                  {/* Workout detail */}
                  {isOpen && (
                    <div style={{ borderTop: '1px solid rgba(255,255,255,0.07)', padding: '18px 22px' }}>

                      {/* Workout notes */}
                      {w.notes?.trim() && (
                        <div style={{ background: `${TEAL}10`, border: `1px solid ${TEAL}30`, borderRadius: 10, padding: '10px 14px', marginBottom: 16, display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                          <span style={{ fontSize: 14 }}>💬</span>
                          <p style={{ margin: 0, fontSize: 14, color: 'rgba(255,255,255,0.75)', fontStyle: 'italic' }}>"{w.notes}"</p>
                        </div>
                      )}

                      {/* Exercise list */}
                      {(w.exercises ?? []).length === 0 ? (
                        <p style={{ color: 'rgba(255,255,255,0.3)', fontSize: 14 }}>No exercises recorded.</p>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                          {(w.exercises ?? []).map(ex => {
                            const st      = exStatus(ex);
                            const exOpen  = expandedEx.has(ex.id);
                            const hasNote = ex.notes?.trim();
                            const hasSets = ex.sets?.length > 0;

                            return (
                              <div key={ex.id} style={{ border: `1px solid ${STATUS_COLOR[st]}30`, borderRadius: 10, overflow: 'hidden' }}>
                                <button
                                  onClick={() => toggleEx(ex.id)}
                                  style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '11px 16px', background: `${STATUS_COLOR[st]}08`, border: 'none', cursor: 'pointer', textAlign: 'left' }}
                                >
                                  {/* Status badge */}
                                  <span style={{ background: `${STATUS_COLOR[st]}25`, color: STATUS_COLOR[st], fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 999, whiteSpace: 'nowrap', flexShrink: 0 }}>
                                    {STATUS_LABEL[st]}
                                  </span>

                                  <span style={{ fontWeight: 600, fontSize: 14, flex: 1 }}>{ex.exercise.name}</span>

                                  <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)' }}>
                                    {ex.sets.length} set{ex.sets.length !== 1 ? 's' : ''}
                                    {(ex.targetSets ?? []).length > 0 ? ` / ${ex.targetSets!.length} target` : ''}
                                  </span>

                                  {hasNote && <span title="Patient note" style={{ fontSize: 13 }}>💬</span>}

                                  <span style={{ color: 'rgba(255,255,255,0.25)', fontSize: 12, transform: exOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s', display: 'inline-block', flexShrink: 0 }}>▾</span>
                                </button>

                                {/* Exercise detail */}
                                {exOpen && (
                                  <div style={{ borderTop: `1px solid ${STATUS_COLOR[st]}20`, padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>

                                    {/* Sets table */}
                                    {hasSets && (
                                      <div>
                                        <p style={{ margin: '0 0 8px', fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Sets</p>
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                          {ex.sets.map((s, si) => {
                                            const target  = ex.targetSets?.[si];
                                            const actual  = setLabel(s, ex.exercise.type);
                                            const tLabel  = target ? setLabel(target, ex.exercise.type) : null;

                                            let setMet: boolean | null = null;
                                            if (target) {
                                              if (target.reps !== undefined)        setMet = (s.reps ?? 0) >= target.reps && (s.weight ?? 0) >= (target.weight ?? 0);
                                              else if (target.duration !== undefined)    setMet = (s.duration ?? 0) >= target.duration;
                                              else if (target.cardioduration !== undefined) setMet = (s.cardioduration ?? 0) >= target.cardioduration;
                                            }

                                            return (
                                              <div key={si} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13 }}>
                                                <span style={{ width: 18, color: 'rgba(255,255,255,0.3)', flexShrink: 0, textAlign: 'right' }}>{si + 1}</span>
                                                <span style={{ color: '#fff', minWidth: 100 }}>{actual}</span>
                                                {tLabel && (
                                                  <>
                                                    <span style={{ color: 'rgba(255,255,255,0.25)', fontSize: 12 }}>target: {tLabel}</span>
                                                    {setMet !== null && (
                                                      <span style={{ color: setMet ? TEAL : '#EF4444', fontSize: 12 }}>{setMet ? '✓' : '✗'}</span>
                                                    )}
                                                  </>
                                                )}
                                              </div>
                                            );
                                          })}
                                        </div>
                                      </div>
                                    )}

                                    {/* Patient note */}
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
      </main>
    </div>
  );
}
