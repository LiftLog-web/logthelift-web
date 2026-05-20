'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState, useCallback, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { getSupabase } from '@/lib/supabase';
import { EXERCISES, MUSCLE_GROUPS, Exercise } from '@/data/exercises';

const TEAL   = '#5fcfbf';
const PURPLE = '#C471ED';

interface WorkoutSet {
  reps?: number;
  weight?: number;
  seconds?: number;
  minutes?: number;
}

interface PlanExercise {
  id: string;
  exercise: Exercise;
  sets: WorkoutSet[];
  targetSets: number;
  notes: string;
}

interface Patient {
  id: string;
  display_name: string;
  email: string;
}

const defaultSet = (ex: Exercise): WorkoutSet => {
  if (ex.type === 'cardio')   return { minutes: 20 };
  if (ex.type === 'duration') return { seconds: 30 };
  return { reps: 10, weight: 0 };
};

function NewPlanInner() {
  const router       = useRouter();
  const searchParams = useSearchParams();
  const editId       = searchParams.get('edit');

  const [authed,       setAuthed]       = useState(false);
  const [practId,      setPractId]      = useState('');
  const [patients,     setPatients]     = useState<Patient[]>([]);
  const [patientId,    setPatientId]    = useState('');
  const [planName,     setPlanName]     = useState('');
  const [description,  setDescription]  = useState('');
  const [planExercises,setPlanExercises]= useState<PlanExercise[]>([]);
  const [search,       setSearch]       = useState('');
  const [muscleFilter, setMuscleFilter] = useState('All');
  const [saving,       setSaving]       = useState(false);
  const [saveError,    setSaveError]    = useState('');

  useEffect(() => {
    const sb = getSupabase();
    sb.auth.getSession().then(async ({ data }) => {
      if (!data.session) { router.push('/login'); return; }

      const { data: prof } = await sb.from('profiles').select('role, is_gym_owner').eq('id', data.session.user.id).single();
      if (prof?.role !== 'practitioner' && !prof?.is_gym_owner) { router.push('/profile'); return; }

      const uid = data.session.user.id;
      setPractId(uid);
      setAuthed(true);

      const { data: links } = await sb
        .from('patient_links')
        .select('profiles:patient_id(id, display_name, email)')
        .eq('practitioner_id', uid);
      const pats: Patient[] = (links ?? [])
        .map((l: any) => Array.isArray(l.profiles) ? l.profiles[0] : l.profiles)
        .filter(Boolean);
      setPatients(pats);

      if (editId) {
        const { data: plan } = await sb
          .from('workout_plans')
          .select('*')
          .eq('id', editId)
          .eq('practitioner_id', uid)
          .single();
        if (plan) {
          setPlanName(plan.name);
          setDescription(plan.description ?? '');
          setPatientId(plan.patient_id);
          const loaded: PlanExercise[] = (plan.exercises ?? []).map((e: any) => ({
            id: e.id ?? String(Math.random()),
            exercise: e.exercise,
            sets: e.sets ?? [],
            targetSets: e.targetSets ?? e.sets?.length ?? 3,
            notes: e.notes ?? '',
          }));
          setPlanExercises(loaded);
        }
      }
    });
  }, [router, editId]);

  const filteredExercises = EXERCISES.filter(ex => {
    const matchesMuscle = muscleFilter === 'All' || ex.muscleGroup === muscleFilter;
    const matchesSearch = ex.name.toLowerCase().includes(search.toLowerCase());
    return matchesMuscle && matchesSearch;
  });

  const addExercise = useCallback((ex: Exercise) => {
    setPlanExercises(prev => {
      if (prev.some(pe => pe.exercise.id === ex.id)) return prev;
      const sets = [defaultSet(ex), defaultSet(ex), defaultSet(ex)];
      return [...prev, { id: String(Date.now()), exercise: ex, sets, targetSets: 3, notes: '' }];
    });
  }, []);

  const removeExercise = (id: string) => setPlanExercises(prev => prev.filter(pe => pe.id !== id));

  const updateSet = (peId: string, setIdx: number, field: keyof WorkoutSet, value: number) => {
    setPlanExercises(prev => prev.map(pe => {
      if (pe.id !== peId) return pe;
      const sets = pe.sets.map((s, i) => i === setIdx ? { ...s, [field]: value } : s);
      return { ...pe, sets };
    }));
  };

  const updateTargetSets = (peId: string, count: number) => {
    setPlanExercises(prev => prev.map(pe => {
      if (pe.id !== peId) return pe;
      const ex = pe.exercise;
      let sets = [...pe.sets];
      while (sets.length < count) sets.push(defaultSet(ex));
      sets = sets.slice(0, count);
      return { ...pe, sets, targetSets: count };
    }));
  };

  const updateNotes = (peId: string, notes: string) => {
    setPlanExercises(prev => prev.map(pe => pe.id === peId ? { ...pe, notes } : pe));
  };

  const handleSave = async () => {
    if (!planName.trim())   { setSaveError('Plan name is required.'); return; }
    if (!patientId)         { setSaveError('Please select a patient.'); return; }
    if (planExercises.length === 0) { setSaveError('Add at least one exercise.'); return; }

    setSaving(true);
    setSaveError('');
    const sb = getSupabase();

    const payload = {
      practitioner_id: practId,
      patient_id:      patientId,
      name:            planName.trim(),
      description:     description.trim() || null,
      exercises:       planExercises,
      updated_at:      new Date().toISOString(),
    };

    let error;
    if (editId) {
      ({ error } = await sb.from('workout_plans').update(payload).eq('id', editId));
    } else {
      ({ error } = await sb.from('workout_plans').insert({ ...payload, created_at: new Date().toISOString() }));
    }

    setSaving(false);
    if (error) { setSaveError(error.message); return; }
    router.push('/plans');
  };

  if (!authed) {
    return (
      <div style={{ minHeight: '100vh', background: '#0f1117', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ width: 32, height: 32, border: `3px solid ${TEAL}`, borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: '#0f1117', color: '#fff', fontFamily: 'sans-serif' }}>

      {/* Nav */}
      <nav style={{ borderBottom: '1px solid rgba(255,255,255,0.1)', padding: '16px 32px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <a href="/" style={{ color: TEAL, fontWeight: 800, fontSize: 20, textDecoration: 'none' }}>LiftLog</a>
          <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: 14 }}>/ <a href="/plans" style={{ color: 'rgba(255,255,255,0.5)', textDecoration: 'none' }}>Plans</a> / {editId ? 'Edit' : 'New'}</span>
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          {saveError && <span style={{ color: '#EF4444', fontSize: 13 }}>{saveError}</span>}
          <button onClick={() => router.push('/plans')} style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.2)', color: 'rgba(255,255,255,0.6)', borderRadius: 10, padding: '8px 16px', fontSize: 14, cursor: 'pointer' }}>
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            style={{ background: TEAL, color: '#0f1117', borderRadius: 10, padding: '8px 20px', fontWeight: 700, fontSize: 14, border: 'none', cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.7 : 1 }}
          >
            {saving ? 'Saving…' : editId ? 'Save Changes' : 'Create Plan'}
          </button>
        </div>
      </nav>

      {/* Plan meta */}
      <div style={{ borderBottom: '1px solid rgba(255,255,255,0.08)', padding: '20px 32px', display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div style={{ flex: '1 1 220px', minWidth: 0 }}>
          <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Plan Name *</label>
          <input
            value={planName}
            onChange={e => setPlanName(e.target.value)}
            placeholder="e.g. Week 1 Strength Program"
            style={{ width: '100%', background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 10, padding: '10px 14px', color: '#fff', fontSize: 14, outline: 'none', boxSizing: 'border-box' }}
          />
        </div>
        <div style={{ flex: '1 1 180px', minWidth: 0 }}>
          <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Patient *</label>
          <select
            value={patientId}
            onChange={e => setPatientId(e.target.value)}
            style={{ width: '100%', background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 10, padding: '10px 14px', color: patientId ? '#fff' : 'rgba(255,255,255,0.4)', fontSize: 14, outline: 'none', boxSizing: 'border-box', cursor: 'pointer' }}
          >
            <option value="">Select patient…</option>
            {patients.map(p => (
              <option key={p.id} value={p.id} style={{ background: '#1a1d26' }}>{p.display_name}</option>
            ))}
          </select>
        </div>
        <div style={{ flex: '2 1 300px', minWidth: 0 }}>
          <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Description</label>
          <input
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="Optional notes about this plan…"
            style={{ width: '100%', background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 10, padding: '10px 14px', color: '#fff', fontSize: 14, outline: 'none', boxSizing: 'border-box' }}
          />
        </div>
      </div>

      {/* Two-column builder */}
      <div style={{ display: 'flex', height: 'calc(100vh - 170px)', overflow: 'hidden' }}>

        {/* Left: Exercise Library */}
        <div style={{ width: 320, flexShrink: 0, borderRight: '1px solid rgba(255,255,255,0.08)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ padding: '16px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
            <p style={{ fontWeight: 700, fontSize: 14, margin: '0 0 10px', color: 'rgba(255,255,255,0.7)' }}>Exercise Library</p>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search exercises…"
              style={{ width: '100%', background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8, padding: '8px 12px', color: '#fff', fontSize: 13, outline: 'none', boxSizing: 'border-box', marginBottom: 8 }}
            />
            <select
              value={muscleFilter}
              onChange={e => setMuscleFilter(e.target.value)}
              style={{ width: '100%', background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8, padding: '7px 12px', color: '#fff', fontSize: 13, outline: 'none', boxSizing: 'border-box', cursor: 'pointer' }}
            >
              <option value="All" style={{ background: '#1a1d26' }}>All muscle groups</option>
              {MUSCLE_GROUPS.map(mg => (
                <option key={mg} value={mg} style={{ background: '#1a1d26' }}>{mg}</option>
              ))}
            </select>
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: '8px' }}>
            {filteredExercises.map(ex => {
              const alreadyAdded = planExercises.some(pe => pe.exercise.id === ex.id);
              return (
                <button
                  key={ex.id}
                  onClick={() => addExercise(ex)}
                  disabled={alreadyAdded}
                  style={{
                    display: 'block', width: '100%', textAlign: 'left', background: alreadyAdded ? 'rgba(95,207,191,0.08)' : 'transparent',
                    border: `1px solid ${alreadyAdded ? `${TEAL}40` : 'transparent'}`,
                    borderRadius: 8, padding: '9px 12px', marginBottom: 2, cursor: alreadyAdded ? 'default' : 'pointer',
                    transition: 'background 0.15s',
                  }}
                  onMouseEnter={e => { if (!alreadyAdded) (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.05)'; }}
                  onMouseLeave={e => { if (!alreadyAdded) (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: alreadyAdded ? TEAL : '#fff' }}>{ex.name}</span>
                    {alreadyAdded && <span style={{ fontSize: 11, color: TEAL }}>✓</span>}
                  </div>
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginTop: 2 }}>
                    {ex.muscleGroup} · {ex.equipment}
                  </div>
                </button>
              );
            })}
            {filteredExercises.length === 0 && (
              <p style={{ color: 'rgba(255,255,255,0.3)', fontSize: 13, textAlign: 'center', padding: 20 }}>No exercises found</p>
            )}
          </div>
        </div>

        {/* Right: Plan builder */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 28px' }}>
          {planExercises.length === 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '60%', gap: 12, opacity: 0.5 }}>
              <p style={{ fontSize: 36 }}>+</p>
              <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 14 }}>Click exercises on the left to add them to this plan</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {planExercises.map((pe, exIdx) => (
                <div key={pe.id} style={{ background: 'rgba(255,255,255,0.04)', border: `1px solid ${PURPLE}30`, borderRadius: 14, padding: '18px 20px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                    <div>
                      <span style={{ fontWeight: 700, fontSize: 15 }}>{exIdx + 1}. {pe.exercise.name}</span>
                      <span style={{ marginLeft: 10, fontSize: 12, color: 'rgba(255,255,255,0.35)' }}>
                        {pe.exercise.muscleGroup} · {pe.exercise.equipment}
                      </span>
                    </div>
                    <button
                      onClick={() => removeExercise(pe.id)}
                      style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.3)', color: '#EF4444', borderRadius: 8, padding: '4px 12px', fontSize: 12, cursor: 'pointer', fontWeight: 700 }}
                    >
                      Remove
                    </button>
                  </div>

                  {/* Sets header */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                    <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', fontWeight: 600 }}>SETS</span>
                    <div style={{ display: 'flex', gap: 4 }}>
                      {[1, 2, 3, 4, 5].map(n => (
                        <button
                          key={n}
                          onClick={() => updateTargetSets(pe.id, n)}
                          style={{
                            width: 28, height: 28, borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 700,
                            background: pe.targetSets === n ? TEAL : 'rgba(255,255,255,0.08)',
                            color: pe.targetSets === n ? '#0f1117' : 'rgba(255,255,255,0.5)',
                          }}
                        >
                          {n}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Set rows */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {pe.sets.map((s, si) => (
                      <div key={si} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span style={{ width: 20, fontSize: 12, color: 'rgba(255,255,255,0.3)', textAlign: 'center', flexShrink: 0 }}>{si + 1}</span>

                        {pe.exercise.type === 'weighted' && (
                          <>
                            <label style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1 }}>
                              <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', whiteSpace: 'nowrap' }}>Reps</span>
                              <input
                                type="number" min={1} value={s.reps ?? 10}
                                onChange={e => updateSet(pe.id, si, 'reps', Number(e.target.value))}
                                style={{ width: 60, background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 6, padding: '5px 8px', color: '#fff', fontSize: 13, outline: 'none', textAlign: 'center' }}
                              />
                            </label>
                            <label style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1 }}>
                              <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', whiteSpace: 'nowrap' }}>Weight (kg)</span>
                              <input
                                type="number" min={0} step={0.5} value={s.weight ?? 0}
                                onChange={e => updateSet(pe.id, si, 'weight', Number(e.target.value))}
                                style={{ width: 70, background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 6, padding: '5px 8px', color: '#fff', fontSize: 13, outline: 'none', textAlign: 'center' }}
                              />
                            </label>
                          </>
                        )}

                        {pe.exercise.type === 'duration' && (
                          <label style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1 }}>
                            <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', whiteSpace: 'nowrap' }}>Seconds</span>
                            <input
                              type="number" min={1} value={s.seconds ?? 30}
                              onChange={e => updateSet(pe.id, si, 'seconds', Number(e.target.value))}
                              style={{ width: 70, background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 6, padding: '5px 8px', color: '#fff', fontSize: 13, outline: 'none', textAlign: 'center' }}
                            />
                          </label>
                        )}

                        {pe.exercise.type === 'cardio' && (
                          <label style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1 }}>
                            <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', whiteSpace: 'nowrap' }}>Minutes</span>
                            <input
                              type="number" min={1} value={s.minutes ?? 20}
                              onChange={e => updateSet(pe.id, si, 'minutes', Number(e.target.value))}
                              style={{ width: 70, background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 6, padding: '5px 8px', color: '#fff', fontSize: 13, outline: 'none', textAlign: 'center' }}
                            />
                          </label>
                        )}
                      </div>
                    ))}
                  </div>

                  {/* Practitioner notes */}
                  <div style={{ marginTop: 12 }}>
                    <input
                      value={pe.notes}
                      onChange={e => updateNotes(pe.id, e.target.value)}
                      placeholder="Practitioner notes (e.g. focus on form, keep elbows tucked)…"
                      style={{ width: '100%', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, padding: '8px 12px', color: '#fff', fontSize: 13, outline: 'none', boxSizing: 'border-box' }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function NewPlanPage() {
  return (
    <Suspense>
      <NewPlanInner />
    </Suspense>
  );
}
