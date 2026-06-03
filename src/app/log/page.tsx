'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState, useCallback, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { getSupabase } from '@/lib/supabase';
import { Sk, SkPage, SkNav } from '@/components/Skeleton';
import { EXERCISES, MUSCLE_GROUPS } from '@/data/exercises';

const TEAL   = '#5fcfbf';
const PURPLE = '#C471ED';
const YELLOW = '#F9F295';

interface WorkoutSet {
  id: string;
  reps?: number;
  weight?: number;
  unit?: 'kg' | 'lbs';
  duration?: number;       // seconds
  cardioduration?: number; // minutes
  speed?: number;
  incline?: number;
}

interface Exercise {
  id: string;
  name: string;
  muscleGroup: string;
  equipment: string;
  type: 'weighted' | 'duration' | 'cardio';
}

interface PlanExercise {
  id: string;
  exercise: Exercise;
  sets: { reps?: number; weight?: number; seconds?: number; minutes?: number; rest?: number }[];
  targetSets: number;
  notes: string;
}

interface LoggedExercise {
  id: string;
  exercise: Exercise;
  sets: WorkoutSet[];
  notes: string;
  practitionerNotes?: string;
  targetSets?: { reps?: number; weight?: number; duration?: number; cardioduration?: number }[];
}

interface Plan {
  id: string;
  name: string;
  description: string | null;
  exercises: any;
}

function renderStars(rating: number, onClick: (v: number) => void) {
  return (
    <div style={{ display: 'flex', gap: 4 }}>
      {[1, 2, 3, 4, 5].map(star => {
        const full = rating >= star;
        const half = !full && rating >= star - 0.5;
        return (
          <div key={star} style={{ position: 'relative', width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ fontSize: 28, color: full ? YELLOW : half ? YELLOW : 'var(--border-strong)' }}>
              {full ? '★' : half ? '⯨' : '☆'}
            </span>
            <button onClick={() => onClick(star - 0.5)} style={{ position: 'absolute', left: 0, top: 0, width: '50%', height: '100%', background: 'transparent', border: 'none', cursor: 'pointer' }} />
            <button onClick={() => onClick(star)} style={{ position: 'absolute', right: 0, top: 0, width: '50%', height: '100%', background: 'transparent', border: 'none', cursor: 'pointer' }} />
          </div>
        );
      })}
    </div>
  );
}

function buildLoggedExs(flatExs: PlanExercise[]): LoggedExercise[] {
  return flatExs.map((pe: PlanExercise) => ({
    id: pe.id,
    exercise: pe.exercise,
    sets: pe.sets.map((_, i) => ({ id: `${pe.id}-${i}` })),
    notes: '',
    practitionerNotes: pe.notes || undefined,
    targetSets: pe.sets.map(s => ({
      reps: s.reps,
      weight: s.weight,
      duration: s.seconds,
      cardioduration: s.minutes,
    })),
  }));
}

function LogWorkoutInner() {
  const router       = useRouter();
  const searchParams = useSearchParams();
  const presetPlanId = searchParams.get('planId');

  const [userId,          setUserId]          = useState('');
  const [authed,          setAuthed]          = useState(false);
  const [plans,           setPlans]           = useState<Plan[]>([]);
  const [selectedPlan,    setSelectedPlan]    = useState<Plan | null>(null);
  const [pendingMultiDay, setPendingMultiDay] = useState<Plan | null>(null);
  const [loggedExs,       setLoggedExs]       = useState<LoggedExercise[]>([]);
  const [notes,           setNotes]           = useState('');
  const [rating,          setRating]          = useState<number | null>(null);
  const [startTime]                           = useState(Date.now());
  const [saving,          setSaving]          = useState(false);
  const [saveError,       setSaveError]       = useState('');
  const [saved,           setSaved]           = useState(false);
  const [exSearch,        setExSearch]        = useState('');
  const [exMuscle,        setExMuscle]        = useState('All');

  useEffect(() => {
    const sb = getSupabase();
    sb.auth.getSession().then(async ({ data }) => {
      if (!data.session) { router.push('/login'); return; }
      const uid = data.session.user.id;

      const { data: prof } = await sb.from('profiles').select('role').eq('id', uid).single();
      if (prof?.role !== 'patient') { router.push('/profile'); return; }

      setUserId(uid);
      setAuthed(true);

      const { data: rawPlans } = await sb
        .from('workout_plans')
        .select('id, name, description, exercises')
        .eq('patient_id', uid)
        .order('created_at', { ascending: false });

      const loadedPlans = (rawPlans ?? []) as Plan[];
      setPlans(loadedPlans);

      if (presetPlanId) {
        const preset = loadedPlans.find(p => p.id === presetPlanId);
        if (preset) {
          const raw = preset.exercises;
          if (raw && !Array.isArray(raw) && raw.days) {
            setPendingMultiDay(preset);
          } else {
            const flatExs = (Array.isArray(raw) ? raw : []) as PlanExercise[];
            setSelectedPlan(preset);
            setLoggedExs(buildLoggedExs(flatExs));
          }
        }
      }
    });
  }, [router]);

  const selectPlan = useCallback((plan: Plan) => {
    const raw = plan.exercises;
    if (raw && !Array.isArray(raw) && raw.days) {
      setPendingMultiDay(plan);
      return;
    }
    const flatExs = (Array.isArray(raw) ? raw : []) as PlanExercise[];
    setSelectedPlan(plan);
    setLoggedExs(buildLoggedExs(flatExs));
  }, []);

  const updateSet = (exId: string, setIdx: number, field: keyof WorkoutSet, value: number) => {
    setLoggedExs(prev => prev.map(ex => {
      if (ex.id !== exId) return ex;
      const sets = ex.sets.map((s, i) => i === setIdx ? { ...s, [field]: value } : s);
      return { ...ex, sets };
    }));
  };

  const addSet = (exId: string) => {
    setLoggedExs(prev => prev.map(ex => {
      if (ex.id !== exId) return ex;
      return { ...ex, sets: [...ex.sets, { id: String(Date.now()) }] };
    }));
  };

  const removeSet = (exId: string, setIdx: number) => {
    setLoggedExs(prev => prev.map(ex => {
      if (ex.id !== exId) return ex;
      return { ...ex, sets: ex.sets.filter((_, i) => i !== setIdx) };
    }));
  };

  const addFreeExercise = useCallback((ex: typeof EXERCISES[0]) => {
    setLoggedExs(prev => {
      if (prev.some(e => e.exercise.id === ex.id)) return prev;
      return [...prev, { id: `free-${ex.id}`, exercise: ex, sets: [{ id: String(Date.now()) }], notes: '' }];
    });
  }, []);

  const removeFreeExercise = (exId: string) => {
    setLoggedExs(prev => prev.filter(e => e.id !== exId));
  };

  const handleSave = async () => {
    if (!userId) return;
    setSaving(true);
    setSaveError('');

    const sb = getSupabase();
    const today = new Date().toISOString().split('T')[0];
    const duration = Math.round((Date.now() - startTime) / 60000);

    const log = {
      id: crypto.randomUUID(),
      date: today,
      exercises: loggedExs,
      notes: notes.trim(),
      duration,
      planId: selectedPlan?.id,
      satisfactionRating: rating ?? undefined,
    };

    const { error } = await sb.from('synced_workouts').insert({
      user_id: userId,
      date: today,
      data: log,
    });

    setSaving(false);
    if (error) { setSaveError(error.message); return; }
    setSaved(true);
  };

  if (!authed) {
    return (
      <SkPage>
        <SkNav />
        <main style={{ maxWidth: 800, margin: '0 auto', padding: '32px 24px' }}>
          <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16, padding: '20px 24px', marginBottom: 20 }}>
            <Sk width={120} height={13} radius={4} style={{ marginBottom: 12 }} />
            <Sk width="100%" height={42} radius={10} />
          </div>
          {[0,1,2].map(i => (
            <div key={i} style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16, padding: '20px 24px', marginBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
                <Sk width={160} height={15} />
                <Sk width={70} height={22} radius={999} style={{ marginLeft: 'auto' }} />
              </div>
              {[0,1,2].map(j => (
                <div key={j} style={{ display: 'flex', gap: 10, marginBottom: 8 }}>
                  <Sk width={50} height={34} radius={8} />
                  <Sk width={80} height={34} radius={8} />
                  <Sk width={80} height={34} radius={8} />
                </div>
              ))}
            </div>
          ))}
        </main>
      </SkPage>
    );
  }

  if (saved) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--bg)', color: 'var(--text)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 20 }}>
        <p style={{ fontSize: 56 }}>✅</p>
        <h2 style={{ fontWeight: 800, fontSize: 24, margin: 0 }}>Workout saved!</h2>
        <p style={{ color: 'var(--text-muted)', margin: 0 }}>Great work. Your progress has been recorded.</p>
        <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
          <button onClick={() => { setSaved(false); setSelectedPlan(null); setLoggedExs([]); setNotes(''); setRating(null); }}
            style={{ background: 'var(--input-bg)', border: '1px solid var(--border-strong)', color: 'var(--text)', borderRadius: 12, padding: '12px 24px', fontSize: 14, cursor: 'pointer', fontWeight: 600 }}>
            Log Another
          </button>
          <button onClick={() => router.push('/profile')}
            style={{ background: TEAL, color: '#0f1117', borderRadius: 12, padding: '12px 24px', fontSize: 14, cursor: 'pointer', fontWeight: 700, border: 'none' }}>
            Back to Profile
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', color: 'var(--text)', fontFamily: 'sans-serif' }}>

      {/* Nav */}
      <nav style={{ borderBottom: '1px solid var(--border)', padding: '16px 32px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <a href="/profile" style={{ color: TEAL, fontWeight: 800, fontSize: 20, textDecoration: 'none' }}>LiftLog</a>
        <span style={{ color: 'var(--text-muted)', fontSize: 14 }}>Log Workout</span>
      </nav>

      <main style={{ maxWidth: 760, margin: '0 auto', padding: '32px 24px' }}>

        {/* Day selector (multi-day plans) */}
        {!selectedPlan && pendingMultiDay ? (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 24 }}>
              <button onClick={() => setPendingMultiDay(null)}
                style={{ background: 'transparent', border: `1px solid ${TEAL}`, color: TEAL, borderRadius: 8, padding: '6px 14px', fontSize: 13, cursor: 'pointer', fontWeight: 600, flexShrink: 0 }}>
                ← Back
              </button>
              <div>
                <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>{pendingMultiDay.name}</h1>
                {pendingMultiDay.description && <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: '2px 0 0' }}>{pendingMultiDay.description}</p>}
              </div>
            </div>
            <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 14 }}>Choose a Day</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {(pendingMultiDay.exercises.days as { id: string; label: string; exercises: PlanExercise[] }[]).map((day, idx) => (
                <button key={day.id} onClick={() => {
                  setSelectedPlan({ ...pendingMultiDay, name: `${pendingMultiDay.name} — ${day.label}` });
                  setLoggedExs(buildLoggedExs(day.exercises));
                  setPendingMultiDay(null);
                }}
                  style={{ textAlign: 'left', background: 'var(--card)', borderTop: `1px solid ${TEAL}30`, borderRight: `1px solid ${TEAL}30`, borderBottom: `1px solid ${TEAL}30`, borderLeft: `3px solid ${TEAL}`, borderRadius: 14, padding: '18px 22px', cursor: 'pointer' }}
                  onMouseEnter={e => { (e.currentTarget.style.borderTopColor = TEAL); (e.currentTarget.style.borderRightColor = TEAL); (e.currentTarget.style.borderBottomColor = TEAL); }}
                  onMouseLeave={e => { (e.currentTarget.style.borderTopColor = `${TEAL}30`); (e.currentTarget.style.borderRightColor = `${TEAL}30`); (e.currentTarget.style.borderBottomColor = `${TEAL}30`); }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <span style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--badge-teal-bg)', color: 'var(--badge-teal-text)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 13, flexShrink: 0 }}>{idx + 1}</span>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--text)' }}>{day.label}</div>
                      <div style={{ fontSize: 12, color: TEAL, marginTop: 2 }}>{day.exercises.length} exercises</div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </>

        ) : !selectedPlan ? (
          <>
            <h1 style={{ fontSize: 24, fontWeight: 800, marginBottom: 8 }}>Start a Workout</h1>
            <p style={{ color: 'var(--text-muted)', marginBottom: 28, fontSize: 14 }}>Choose a plan from your practitioner or log a free workout.</p>

            {plans.length > 0 && (
              <>
                <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 12 }}>Your Plans</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 24 }}>
                  {plans.map(plan => (
                    <button key={plan.id} onClick={() => selectPlan(plan)}
                      style={{ textAlign: 'left', background: 'var(--card)', border: `1px solid ${PURPLE}40`, borderRadius: 14, padding: '18px 22px', cursor: 'pointer', transition: 'border-color 0.15s' }}
                      onMouseEnter={e => (e.currentTarget.style.borderColor = PURPLE)}
                      onMouseLeave={e => (e.currentTarget.style.borderColor = `${PURPLE}40`)}
                    >
                      <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--text)', marginBottom: 4 }}>{plan.name}</div>
                      {plan.description && <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 6 }}>{plan.description}</div>}
                      <div style={{ fontSize: 12, color: TEAL }}>
                        {plan.exercises && !Array.isArray(plan.exercises) && plan.exercises.days
                          ? `${plan.exercises.days.length} day split`
                          : `${Array.isArray(plan.exercises) ? plan.exercises.length : 0} exercises`}
                      </div>
                    </button>
                  ))}
                </div>
              </>
            )}

            <button onClick={() => { setSelectedPlan({ id: '', name: 'Free Workout', description: null, exercises: [] }); setLoggedExs([]); }}
              style={{ width: '100%', background: 'var(--btn-teal-bg)', border: '1px solid var(--btn-teal-border)', borderRadius: 14, padding: '16px 22px', cursor: 'pointer', color: 'var(--btn-teal-text)', fontWeight: 700, fontSize: 15 }}>
              + Free Workout (no plan)
            </button>
          </>

        ) : (
          <>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
              <div>
                <h1 style={{ fontSize: 22, fontWeight: 800, margin: '0 0 4px' }}>{selectedPlan.name}</h1>
                {selectedPlan.description && <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: 0 }}>{selectedPlan.description}</p>}
              </div>
              <button onClick={() => { setSelectedPlan(null); setLoggedExs([]); }}
                style={{ background: 'var(--btn-teal-bg)', border: '1px solid var(--btn-teal-border)', color: 'var(--btn-teal-text)', borderRadius: 8, padding: '6px 14px', fontSize: 13, cursor: 'pointer', fontWeight: 600, flexShrink: 0 }}>
                ← Change Plan
              </button>
            </div>

            {/* Exercise picker — free workout only */}
            {selectedPlan.id === '' && (() => {
              const filtered = EXERCISES.filter(ex => {
                const matchMuscle = exMuscle === 'All' || ex.muscleGroup === exMuscle;
                const matchSearch = ex.name.toLowerCase().includes(exSearch.toLowerCase());
                return matchMuscle && matchSearch;
              });
              return (
                <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, padding: '16px 20px', marginBottom: 24 }}>
                  <p style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-muted)', margin: '0 0 12px' }}>Add Exercises</p>
                  <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                    <input
                      value={exSearch}
                      onChange={e => setExSearch(e.target.value)}
                      placeholder="Search exercises…"
                      style={{ flex: 1, background: 'var(--card-alt)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px', color: 'var(--text)', fontSize: 13, outline: 'none' }}
                    />
                    <select
                      value={exMuscle}
                      onChange={e => setExMuscle(e.target.value)}
                      style={{ background: 'var(--card-alt)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px', color: 'var(--text)', fontSize: 13, outline: 'none', cursor: 'pointer' }}
                    >
                      <option value="All" style={{ background: 'var(--card)' }}>All muscles</option>
                      {MUSCLE_GROUPS.map(mg => <option key={mg} value={mg} style={{ background: 'var(--card)' }}>{mg}</option>)}
                    </select>
                  </div>
                  <div style={{ maxHeight: 220, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
                    {filtered.map(ex => {
                      const added = loggedExs.some(e => e.exercise.id === ex.id);
                      return (
                        <button
                          key={ex.id}
                          onClick={() => addFreeExercise(ex)}
                          disabled={added}
                          style={{
                            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                            textAlign: 'left', background: added ? `${TEAL}0d` : 'transparent',
                            border: `1px solid ${added ? `${TEAL}40` : 'transparent'}`,
                            borderRadius: 8, padding: '8px 12px', cursor: added ? 'default' : 'pointer',
                          }}
                          onMouseEnter={e => { if (!added) (e.currentTarget as HTMLButtonElement).style.background = 'var(--card-alt)'; }}
                          onMouseLeave={e => { if (!added) (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
                        >
                          <div>
                            <span style={{ fontSize: 13, fontWeight: 600, color: added ? TEAL : 'var(--text)' }}>{ex.name}</span>
                            <span style={{ fontSize: 11, color: 'var(--text-dim)', marginLeft: 8 }}>{ex.muscleGroup} · {ex.equipment}</span>
                          </div>
                          {added ? <span style={{ fontSize: 11, color: TEAL }}>✓ Added</span> : <span style={{ fontSize: 18, color: TEAL, lineHeight: 1 }}>+</span>}
                        </button>
                      );
                    })}
                    {filtered.length === 0 && <p style={{ color: 'var(--text-dim)', fontSize: 13, textAlign: 'center', padding: 16 }}>No exercises found</p>}
                  </div>
                </div>
              );
            })()}

            {loggedExs.length === 0 && selectedPlan.id === '' && (
              <div style={{ background: 'var(--card)', border: '1px solid var(--border-subtle)', borderRadius: 14, padding: 32, textAlign: 'center', color: 'var(--text-dim)', fontSize: 14, marginBottom: 24 }}>
                Search and add exercises above to get started.
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginBottom: 28 }}>
              {loggedExs.map(ex => (
                <div key={ex.id} style={{ background: 'var(--card)', borderTop: `1px solid ${PURPLE}40`, borderRight: `1px solid ${PURPLE}40`, borderBottom: `1px solid ${PURPLE}40`, borderLeft: `3px solid ${PURPLE}`, borderRadius: 14, padding: '18px 20px', boxShadow: '0 2px 8px rgba(0,0,0,0.05)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
                    <div style={{ fontWeight: 700, fontSize: 15 }}>{ex.exercise.name}</div>
                    {selectedPlan.id === '' && (
                      <button onClick={() => removeFreeExercise(ex.id)}
                        style={{ background: 'var(--btn-red-bg)', border: '1px solid var(--btn-red-border)', color: 'var(--btn-red-text)', borderRadius: 6, padding: '2px 10px', fontSize: 11, cursor: 'pointer', fontWeight: 600 }}>
                        Remove
                      </button>
                    )}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: ex.practitionerNotes ? 8 : 14 }}>
                    {ex.exercise.muscleGroup} · {ex.exercise.equipment}
                  </div>
                  {ex.practitionerNotes && (
                    <div style={{ background: 'var(--badge-purple-bg)', border: '1px solid var(--btn-purple-border)', borderRadius: 8, padding: '8px 12px', fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
                      Note from PT: {ex.practitionerNotes}
                    </div>
                  )}

                  {/* Target reference */}
                  {(ex.targetSets ?? []).length > 0 && (
                    <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 11, color: TEAL, fontWeight: 700, alignSelf: 'center' }}>TARGET:</span>
                      {(ex.targetSets ?? []).map((t, i) => (
                        <span key={i} style={{ background: 'var(--badge-teal-bg)', border: '1px solid var(--btn-teal-border)', borderRadius: 6, padding: '3px 8px', fontSize: 11, color: 'var(--text-muted)' }}>
                          {ex.exercise.type === 'cardio' ? `${t.cardioduration ?? '?'} min`
                           : ex.exercise.type === 'duration' ? `${t.duration ?? '?'}s`
                           : `${t.reps ?? '?'} reps × ${t.weight ?? 0}kg`}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Set rows */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 10 }}>
                    {ex.sets.map((s, si) => (
                      <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span style={{ fontSize: 12, color: TEAL, fontWeight: 700, flexShrink: 0 }}>Set {si + 1}</span>

                        {ex.exercise.type === 'weighted' && (
                          <>
                            <label style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Reps</span>
                              <input type="number" min={0} value={s.reps ?? ''}
                                placeholder="0"
                                onChange={e => updateSet(ex.id, si, 'reps', Number(e.target.value))}
                                style={{ width: 64, background: 'var(--input-bg)', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 8px', color: 'var(--text)', fontSize: 13, outline: 'none', textAlign: 'center' }}
                              />
                            </label>
                            <label style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>kg</span>
                              <input type="number" min={0} step={0.5} value={s.weight ?? ''}
                                placeholder="0"
                                onChange={e => updateSet(ex.id, si, 'weight', Number(e.target.value))}
                                style={{ width: 70, background: 'var(--input-bg)', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 8px', color: 'var(--text)', fontSize: 13, outline: 'none', textAlign: 'center' }}
                              />
                            </label>
                          </>
                        )}

                        {ex.exercise.type === 'duration' && (
                          <label style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Seconds</span>
                            <input type="number" min={0} value={s.duration ?? ''}
                              placeholder="0"
                              onChange={e => updateSet(ex.id, si, 'duration', Number(e.target.value))}
                              style={{ width: 80, background: 'var(--input-bg)', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 8px', color: 'var(--text)', fontSize: 13, outline: 'none', textAlign: 'center' }}
                            />
                          </label>
                        )}

                        {ex.exercise.type === 'cardio' && (
                          <>
                            <label style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Min</span>
                              <input type="number" min={0} value={s.cardioduration ?? ''}
                                placeholder="0"
                                onChange={e => updateSet(ex.id, si, 'cardioduration', Number(e.target.value))}
                                style={{ width: 64, background: 'var(--input-bg)', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 8px', color: 'var(--text)', fontSize: 13, outline: 'none', textAlign: 'center' }}
                              />
                            </label>
                            <label style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>km/h</span>
                              <input type="number" min={0} step={0.1} value={s.speed ?? ''}
                                placeholder="0"
                                onChange={e => updateSet(ex.id, si, 'speed', Number(e.target.value))}
                                style={{ width: 64, background: 'var(--input-bg)', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 8px', color: 'var(--text)', fontSize: 13, outline: 'none', textAlign: 'center' }}
                              />
                            </label>
                          </>
                        )}

                        <button onClick={() => removeSet(ex.id, si)}
                          style={{ background: 'transparent', border: 'none', color: 'rgba(239,68,68,0.6)', fontSize: 16, cursor: 'pointer', padding: '0 4px', lineHeight: 1, marginLeft: 'auto' }}>
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>

                  <button onClick={() => addSet(ex.id)}
                    style={{ background: 'transparent', border: `1px dashed rgba(95,207,191,0.3)`, color: TEAL, borderRadius: 8, padding: '6px 16px', fontSize: 12, cursor: 'pointer', fontWeight: 600 }}>
                    + Add Set
                  </button>
                </div>
              ))}
            </div>

            {/* Notes */}
            <div style={{ marginBottom: 24 }}>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 8 }}>Workout Notes</label>
              <textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="How did it go? Any notes for your practitioner…"
                rows={3}
                style={{ width: '100%', background: 'var(--card-alt)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 14px', color: 'var(--text)', fontSize: 14, outline: 'none', boxSizing: 'border-box', resize: 'vertical', fontFamily: 'sans-serif' }}
              />
            </div>

            {/* Satisfaction rating */}
            <div style={{ marginBottom: 32 }}>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 12 }}>How was your workout?</label>
              {renderStars(rating ?? 0, (v) => setRating(rating === v ? null : v))}
              {rating !== null && <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 8 }}>{rating}/5 stars</p>}
            </div>

            {/* Save */}
            {saveError && <p style={{ color: '#EF4444', fontSize: 13, marginBottom: 12 }}>{saveError}</p>}
            <button
              onClick={handleSave}
              disabled={saving}
              style={{ width: '100%', background: TEAL, color: '#0f1117', borderRadius: 12, padding: '14px', fontWeight: 800, fontSize: 16, border: 'none', cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.7 : 1 }}
            >
              {saving ? 'Saving…' : 'Save Workout'}
            </button>
          </>
        )}
      </main>
    </div>
  );
}

export default function LogWorkoutPage() {
  return (
    <Suspense>
      <LogWorkoutInner />
    </Suspense>
  );
}
