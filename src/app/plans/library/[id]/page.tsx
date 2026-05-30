'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState, useCallback } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { getSupabase } from '@/lib/supabase';
import { EXERCISES, MUSCLE_GROUPS, Exercise } from '@/data/exercises';

const TEAL   = '#5fcfbf';
const PURPLE = '#C471ED';
const RED    = '#EF4444';

// ── Types ─────────────────────────────────────────────────────────────────────

interface WorkoutSet {
  reps?: number;
  weight?: number;
  seconds?: number;
  rest?: number;
}

interface WeekData {
  week: number;
  sets: WorkoutSet[];
  exerciseOverride?: Exercise; // different exercise for this week only
}

interface TemplateExercise {
  id: string;
  exercise: Exercise;
  sets: WorkoutSet[];     // Week 1 baseline
  notes?: string;
  weeks?: WeekData[];     // Weeks 2+ overrides
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function numWeeks(exercises: TemplateExercise[]): number {
  let max = 1;
  for (const ex of exercises) {
    for (const w of ex.weeks ?? []) {
      if (w.week > max) max = w.week;
    }
  }
  return max;
}

function getWeekSets(ex: TemplateExercise, week: number): WorkoutSet[] {
  if (week === 1) return ex.sets;
  return ex.weeks?.find(w => w.week === week)?.sets ?? [...ex.sets];
}

function getWeekExercise(ex: TemplateExercise, week: number): Exercise {
  if (week === 1) return ex.exercise;
  return ex.weeks?.find(w => w.week === week)?.exerciseOverride ?? ex.exercise;
}

function setWeekSets(ex: TemplateExercise, week: number, sets: WorkoutSet[]): TemplateExercise {
  if (week === 1) return { ...ex, sets };
  const weeks = ex.weeks ? [...ex.weeks] : [];
  const idx = weeks.findIndex(w => w.week === week);
  if (idx >= 0) {
    weeks[idx] = { ...weeks[idx], sets };
  } else {
    weeks.push({ week, sets });
  }
  return { ...ex, weeks };
}

function defaultSet(ex: Exercise): WorkoutSet {
  if (ex.type === 'cardio')   return { seconds: 1200 };
  if (ex.type === 'duration') return { seconds: 30 };
  return { reps: 10, weight: 0 };
}

function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function TemplateEditorPage() {
  const router = useRouter();
  const params = useParams();
  const templateId = params.id as string;

  const [authed,      setAuthed]      = useState(false);
  const [loading,     setLoading]     = useState(true);
  const [saving,      setSaving]      = useState(false);
  const [name,        setName]        = useState('');
  const [description, setDescription] = useState('');
  const [exercises,   setExercises]   = useState<TemplateExercise[]>([]);
  const [activeWeek,  setActiveWeek]  = useState(1);

  // Add exercise modal
  const [showAddModal,   setShowAddModal]   = useState(false);
  const [exSearch,       setExSearch]       = useState('');
  const [exMuscle,       setExMuscle]       = useState('All');

  // Substitution modal
  const [subTarget,   setSubTarget]   = useState<{ exId: string; scope: 'template' | 'week' } | null>(null);
  const [subSearch,   setSubSearch]   = useState('');

  useEffect(() => {
    const sb = getSupabase();
    sb.auth.getSession().then(async ({ data }) => {
      if (!data.session) { router.push('/login'); return; }
      const { data: prof } = await sb.from('profiles').select('role, is_gym_owner').eq('id', data.session.user.id).single();
      if (prof?.role !== 'practitioner' && !prof?.is_gym_owner) { router.push('/profile'); return; }
      setAuthed(true);

      const { data: tpl } = await sb
        .from('plan_templates')
        .select('*')
        .eq('id', templateId)
        .single();
      if (!tpl) { router.push('/plans/library'); return; }

      setName(tpl.name);
      setDescription(tpl.description ?? '');
      setExercises((tpl.exercises ?? []).map((e: any) => ({
        id: e.id ?? uid(),
        exercise: e.exercise,
        sets: e.sets ?? [defaultSet(e.exercise)],
        notes: e.notes ?? '',
        weeks: e.weeks ?? [],
      })));
      setLoading(false);
    });
  }, [router, templateId]);

  const totalWeeks = numWeeks(exercises);

  // ── Week management ────────────────────────────────────────────────────────

  const handleAddWeek = () => {
    const newWeek = totalWeeks + 1;
    setExercises(prev => prev.map(ex => {
      const lastSets = getWeekSets(ex, totalWeeks);
      const weeks = [...(ex.weeks ?? []), { week: newWeek, sets: lastSets.map(s => ({ ...s })) }];
      return { ...ex, weeks };
    }));
    setActiveWeek(newWeek);
  };

  const handleRemoveLastWeek = () => {
    if (totalWeeks <= 1) return;
    const removing = totalWeeks;
    setExercises(prev => prev.map(ex => ({
      ...ex,
      weeks: (ex.weeks ?? []).filter(w => w.week !== removing),
    })));
    setActiveWeek(Math.min(activeWeek, removing - 1));
  };

  // ── Set editing ───────────────────────────────────────────────────────────

  const updateSet = (exId: string, setIdx: number, field: keyof WorkoutSet, value: number) => {
    setExercises(prev => prev.map(ex => {
      if (ex.id !== exId) return ex;
      const sets = getWeekSets(ex, activeWeek).map((s, i) =>
        i === setIdx ? { ...s, [field]: value } : s
      );
      return setWeekSets(ex, activeWeek, sets);
    }));
  };

  const addSet = (exId: string) => {
    setExercises(prev => prev.map(ex => {
      if (ex.id !== exId) return ex;
      const current = getWeekSets(ex, activeWeek);
      const last = current[current.length - 1] ?? defaultSet(ex.exercise);
      return setWeekSets(ex, activeWeek, [...current, { ...last }]);
    }));
  };

  const removeSet = (exId: string, setIdx: number) => {
    setExercises(prev => prev.map(ex => {
      if (ex.id !== exId) return ex;
      const current = getWeekSets(ex, activeWeek);
      if (current.length <= 1) return ex;
      return setWeekSets(ex, activeWeek, current.filter((_, i) => i !== setIdx));
    }));
  };

  const removeExercise = (exId: string) => {
    setExercises(prev => prev.filter(ex => ex.id !== exId));
  };

  const moveExercise = (exId: string, dir: -1 | 1) => {
    setExercises(prev => {
      const idx = prev.findIndex(e => e.id === exId);
      if (idx < 0) return prev;
      const next = [...prev];
      const swapIdx = idx + dir;
      if (swapIdx < 0 || swapIdx >= next.length) return prev;
      [next[idx], next[swapIdx]] = [next[swapIdx], next[idx]];
      return next;
    });
  };

  // ── Add exercise ──────────────────────────────────────────────────────────

  const handleAddExercise = (ex: Exercise) => {
    if (exercises.some(e => e.exercise.id === ex.id)) return;
    const baseSet = defaultSet(ex);
    const newEx: TemplateExercise = {
      id: uid(),
      exercise: ex,
      sets: [baseSet, baseSet, baseSet].map(s => ({ ...s })),
      weeks: Array.from({ length: totalWeeks - 1 }, (_, i) => ({
        week: i + 2,
        sets: [baseSet, baseSet, baseSet].map(s => ({ ...s })),
      })),
    };
    setExercises(prev => [...prev, newEx]);
    setShowAddModal(false);
    setExSearch('');
    setExMuscle('All');
  };

  // ── Substitution ──────────────────────────────────────────────────────────

  const handleSubstitute = (newExercise: Exercise) => {
    if (!subTarget) return;
    const { exId, scope } = subTarget;
    setExercises(prev => prev.map(ex => {
      if (ex.id !== exId) return ex;
      if (scope === 'template') {
        // Replace exercise across all weeks
        return { ...ex, exercise: newExercise, sets: ex.sets.map(_ => defaultSet(newExercise)) };
      } else {
        // Replace exercise for active week only
        if (activeWeek === 1) {
          return { ...ex, exercise: newExercise, sets: ex.sets.map(_ => defaultSet(newExercise)) };
        }
        const weeks = (ex.weeks ?? []).map(w => {
          if (w.week !== activeWeek) return w;
          return { ...w, exerciseOverride: newExercise, sets: w.sets.map(_ => defaultSet(newExercise)) };
        });
        if (!weeks.find(w => w.week === activeWeek)) {
          weeks.push({ week: activeWeek, sets: [defaultSet(newExercise)], exerciseOverride: newExercise });
        }
        return { ...ex, weeks };
      }
    }));
    setSubTarget(null);
    setSubSearch('');
  };

  // ── Save ──────────────────────────────────────────────────────────────────

  const handleSave = async () => {
    if (!name.trim()) { alert('Please give this template a name.'); return; }
    setSaving(true);
    const { error } = await getSupabase()
      .from('plan_templates')
      .update({ name: name.trim(), description: description.trim() || null, exercises })
      .eq('id', templateId);
    setSaving(false);
    if (error) { alert('Could not save: ' + error.message); return; }
    router.push('/plans/library');
  };

  // ── Render helpers ────────────────────────────────────────────────────────

  const renderSetRow = (ex: TemplateExercise, set: WorkoutSet, setIdx: number, totalSets: number) => {
    const exType = getWeekExercise(ex, activeWeek).type;
    return (
      <div key={setIdx} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: setIdx < totalSets - 1 ? '1px solid rgba(255,255,255,0.05)' : 'none' }}>
        <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: 12, width: 24, flexShrink: 0 }}>
          {setIdx + 1}
        </span>

        {exType === 'weighted' && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <input
                type="number"
                value={set.reps ?? ''}
                onChange={e => updateSet(ex.id, setIdx, 'reps', Number(e.target.value))}
                style={inputStyle}
                placeholder="0"
              />
              <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: 12 }}>reps</span>
            </div>
            <span style={{ color: 'rgba(255,255,255,0.2)', fontSize: 12 }}>@</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <input
                type="number"
                value={set.weight ?? ''}
                onChange={e => updateSet(ex.id, setIdx, 'weight', Number(e.target.value))}
                style={inputStyle}
                placeholder="0"
              />
              <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: 12 }}>kg</span>
            </div>
          </>
        )}

        {(exType === 'duration' || exType === 'cardio') && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <input
              type="number"
              value={set.seconds ?? ''}
              onChange={e => updateSet(ex.id, setIdx, 'seconds', Number(e.target.value))}
              style={inputStyle}
              placeholder="0"
            />
            <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: 12 }}>sec</span>
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginLeft: 8 }}>
          <input
            type="number"
            value={set.rest ?? ''}
            onChange={e => updateSet(ex.id, setIdx, 'rest', Number(e.target.value))}
            style={{ ...inputStyle, width: 44 }}
            placeholder="0"
          />
          <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: 12 }}>s rest</span>
        </div>

        <button
          onClick={() => removeSet(ex.id, setIdx)}
          disabled={totalSets <= 1}
          style={{ marginLeft: 'auto', color: 'rgba(239,68,68,0.6)', background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, padding: '0 4px', opacity: totalSets <= 1 ? 0.3 : 1 }}
          title="Remove set"
        >
          ×
        </button>
      </div>
    );
  };

  if (!authed || loading) {
    return (
      <div style={{ minHeight: '100vh', background: '#0f1117', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ width: 32, height: 32, border: `3px solid ${TEAL}`, borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  // Substitution target exercise info
  const subEx = subTarget ? exercises.find(e => e.id === subTarget.exId) : null;
  const subMuscle = subEx ? getWeekExercise(subEx, subTarget?.scope === 'week' ? activeWeek : 1).muscleGroup : '';
  const subCandidates = EXERCISES.filter(e =>
    e.muscleGroup === subMuscle &&
    e.id !== (subEx ? getWeekExercise(subEx, subTarget?.scope === 'week' ? activeWeek : 1).id : '') &&
    (subSearch === '' || e.name.toLowerCase().includes(subSearch.toLowerCase()))
  );

  // Add exercise modal candidates
  const addCandidates = EXERCISES.filter(ex => {
    const notAdded = !exercises.some(e => e.exercise.id === ex.id);
    const matchMuscle = exMuscle === 'All' || ex.muscleGroup === exMuscle;
    const matchSearch = exSearch === '' || ex.name.toLowerCase().includes(exSearch.toLowerCase());
    return notAdded && matchMuscle && matchSearch;
  });

  return (
    <div style={{ minHeight: '100vh', background: '#0f1117', color: '#fff', fontFamily: 'sans-serif' }}>
      {/* Nav */}
      <nav style={{ borderBottom: '1px solid rgba(255,255,255,0.1)', padding: '16px 32px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', maxWidth: 1100, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <a href="/" style={{ color: TEAL, fontWeight: 800, fontSize: 20, textDecoration: 'none' }}>LiftLog</a>
          <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: 14 }}>/ </span>
          <a href="/plans/library" style={{ color: 'rgba(255,255,255,0.5)', fontSize: 14, textDecoration: 'none' }}>Library</a>
          <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: 14 }}>/ Edit</span>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button
            onClick={() => router.push(`/plans/new?template=${templateId}`)}
            style={{ background: `${PURPLE}20`, color: PURPLE, border: `1px solid ${PURPLE}40`, borderRadius: 10, padding: '8px 18px', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}
          >
            Assign to Patient →
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            style={{ background: TEAL, color: '#0f1117', borderRadius: 10, padding: '8px 20px', fontWeight: 700, fontSize: 14, border: 'none', cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.7 : 1 }}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </nav>

      <main style={{ maxWidth: 1100, margin: '0 auto', padding: '32px 32px 80px' }}>
        {/* Template name + description */}
        <div style={{ marginBottom: 28 }}>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Template name"
            style={{ background: 'transparent', border: 'none', outline: 'none', color: '#fff', fontSize: 28, fontWeight: 800, width: '100%', padding: 0, marginBottom: 8 }}
          />
          <input
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="Description (optional) — e.g. 4-week hypertrophy block for intermediate lifters"
            style={{ background: 'transparent', border: 'none', outline: 'none', color: 'rgba(255,255,255,0.4)', fontSize: 14, width: '100%', padding: 0 }}
          />
        </div>

        {/* Week tabs */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 24, flexWrap: 'wrap' }}>
          {Array.from({ length: totalWeeks }, (_, i) => i + 1).map(w => (
            <button
              key={w}
              onClick={() => setActiveWeek(w)}
              style={{
                padding: '8px 18px', borderRadius: 20, fontWeight: 700, fontSize: 13, border: 'none', cursor: 'pointer',
                background: activeWeek === w ? TEAL : 'rgba(255,255,255,0.08)',
                color: activeWeek === w ? '#0f1117' : 'rgba(255,255,255,0.6)',
              }}
            >
              Week {w}
            </button>
          ))}
          <button
            onClick={handleAddWeek}
            style={{ padding: '8px 14px', borderRadius: 20, fontWeight: 700, fontSize: 13, border: `1px dashed ${TEAL}60`, background: 'transparent', color: TEAL, cursor: 'pointer' }}
          >
            + Add Week
          </button>
          {totalWeeks > 1 && (
            <button
              onClick={handleRemoveLastWeek}
              style={{ padding: '8px 14px', borderRadius: 20, fontWeight: 700, fontSize: 13, border: '1px solid rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.08)', color: RED, cursor: 'pointer' }}
            >
              Remove Week {totalWeeks}
            </button>
          )}
        </div>

        {/* Week label */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>
            Week {activeWeek}
            {activeWeek > 1 && <span style={{ color: 'rgba(255,255,255,0.3)', fontWeight: 400, fontSize: 13, marginLeft: 10 }}>Inherited from Week 1 unless edited below</span>}
          </h2>
          <button
            onClick={() => setShowAddModal(true)}
            style={{ background: `${TEAL}20`, color: TEAL, border: `1px solid ${TEAL}40`, borderRadius: 10, padding: '8px 16px', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}
          >
            + Add Exercise
          </button>
        </div>

        {/* Exercise cards */}
        {exercises.length === 0 ? (
          <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px dashed rgba(255,255,255,0.15)', borderRadius: 16, padding: 48, textAlign: 'center' }}>
            <p style={{ color: 'rgba(255,255,255,0.3)', marginBottom: 16 }}>No exercises yet. Add exercises to build this template.</p>
            <button
              onClick={() => setShowAddModal(true)}
              style={{ background: TEAL, color: '#0f1117', borderRadius: 10, padding: '10px 24px', fontWeight: 700, fontSize: 14, border: 'none', cursor: 'pointer' }}
            >
              + Add First Exercise
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {exercises.map((ex, exIdx) => {
              const weekExercise = getWeekExercise(ex, activeWeek);
              const weekSets = getWeekSets(ex, activeWeek);
              const isOverridden = activeWeek > 1 && ex.weeks?.find(w => w.week === activeWeek)?.exerciseOverride;
              return (
                <div key={ex.id} style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 14, padding: '18px 20px' }}>
                  {/* Exercise header */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 700, fontSize: 15 }}>{weekExercise.name}</span>
                    {isOverridden && (
                      <span style={{ background: `${PURPLE}20`, color: PURPLE, fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 999 }}>Week {activeWeek} substitute</span>
                    )}
                    <span style={{ background: `${TEAL}15`, color: TEAL, fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 999 }}>
                      {weekExercise.muscleGroup}
                    </span>
                    <span style={{ background: 'rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.5)', fontSize: 11, padding: '2px 8px', borderRadius: 999 }}>
                      {weekExercise.equipment}
                    </span>
                    <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                      <button
                        onClick={() => { setSubTarget({ exId: ex.id, scope: 'template' }); setSubSearch(''); }}
                        style={{ background: 'rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.6)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 8, padding: '5px 12px', fontSize: 12, cursor: 'pointer' }}
                        title="Substitute this exercise"
                      >
                        ⇄ Substitute
                      </button>
                      <button
                        onClick={() => moveExercise(ex.id, -1)}
                        disabled={exIdx === 0}
                        style={{ background: 'none', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 6, padding: '5px 8px', color: 'rgba(255,255,255,0.4)', cursor: exIdx === 0 ? 'not-allowed' : 'pointer', opacity: exIdx === 0 ? 0.3 : 1 }}
                      >↑</button>
                      <button
                        onClick={() => moveExercise(ex.id, 1)}
                        disabled={exIdx === exercises.length - 1}
                        style={{ background: 'none', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 6, padding: '5px 8px', color: 'rgba(255,255,255,0.4)', cursor: exIdx === exercises.length - 1 ? 'not-allowed' : 'pointer', opacity: exIdx === exercises.length - 1 ? 0.3 : 1 }}
                      >↓</button>
                      <button
                        onClick={() => { if (confirm(`Remove ${weekExercise.name}?`)) removeExercise(ex.id); }}
                        style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 6, padding: '5px 10px', color: RED, cursor: 'pointer', fontSize: 12 }}
                      >
                        Remove
                      </button>
                    </div>
                  </div>

                  {/* Set rows */}
                  <div style={{ background: 'rgba(0,0,0,0.2)', borderRadius: 10, padding: '8px 12px' }}>
                    <div style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
                      <span style={{ color: 'rgba(255,255,255,0.25)', fontSize: 11, width: 24 }}>#</span>
                      {weekExercise.type === 'weighted' && (
                        <>
                          <span style={{ color: 'rgba(255,255,255,0.25)', fontSize: 11, width: 80 }}>Reps</span>
                          <span style={{ color: 'rgba(255,255,255,0.25)', fontSize: 11, width: 80 }}>Weight (kg)</span>
                        </>
                      )}
                      {(weekExercise.type === 'duration' || weekExercise.type === 'cardio') && (
                        <span style={{ color: 'rgba(255,255,255,0.25)', fontSize: 11, width: 80 }}>Duration (s)</span>
                      )}
                      <span style={{ color: 'rgba(255,255,255,0.25)', fontSize: 11, marginLeft: 8 }}>Rest (s)</span>
                    </div>
                    {weekSets.map((set, setIdx) => renderSetRow(ex, set, setIdx, weekSets.length))}
                    <button
                      onClick={() => addSet(ex.id)}
                      style={{ marginTop: 8, background: 'none', border: 'none', color: TEAL, fontSize: 12, fontWeight: 600, cursor: 'pointer', padding: '4px 0' }}
                    >
                      + Add Set
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Bottom save bar */}
        <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, background: 'rgba(15,17,23,0.95)', borderTop: '1px solid rgba(255,255,255,0.1)', padding: '16px 32px', display: 'flex', justifyContent: 'flex-end', gap: 12, zIndex: 100 }}>
          <button
            onClick={() => router.push('/plans/library')}
            style={{ background: 'rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.6)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 10, padding: '10px 24px', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            style={{ background: TEAL, color: '#0f1117', borderRadius: 10, padding: '10px 28px', fontWeight: 700, fontSize: 14, border: 'none', cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.7 : 1 }}
          >
            {saving ? 'Saving…' : 'Save Template'}
          </button>
        </div>
      </main>

      {/* ── Add Exercise Modal ─────────────────────────────────────────────── */}
      {showAddModal && (
        <div style={overlayStyle} onClick={() => setShowAddModal(false)}>
          <div style={modalStyle} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Add Exercise</h3>
              <button onClick={() => setShowAddModal(false)} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)', fontSize: 22, cursor: 'pointer' }}>×</button>
            </div>
            <input
              value={exSearch}
              onChange={e => setExSearch(e.target.value)}
              placeholder="Search exercises…"
              autoFocus
              style={searchInputStyle}
            />
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
              {['All', ...MUSCLE_GROUPS].map(mg => (
                <button
                  key={mg}
                  onClick={() => setExMuscle(mg)}
                  style={{
                    padding: '4px 12px', borderRadius: 16, fontSize: 12, fontWeight: 600, border: 'none', cursor: 'pointer',
                    background: exMuscle === mg ? TEAL : 'rgba(255,255,255,0.08)',
                    color: exMuscle === mg ? '#0f1117' : 'rgba(255,255,255,0.5)',
                  }}
                >
                  {mg}
                </button>
              ))}
            </div>
            <div style={{ maxHeight: 360, overflowY: 'auto' }}>
              {addCandidates.slice(0, 60).map(ex => (
                <button
                  key={ex.id}
                  onClick={() => handleAddExercise(ex)}
                  style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '11px 14px', background: 'none', border: 'none', borderBottom: '1px solid rgba(255,255,255,0.06)', cursor: 'pointer', textAlign: 'left' }}
                >
                  <span>
                    <span style={{ color: '#fff', fontWeight: 600, fontSize: 14 }}>{ex.name}</span>
                    <span style={{ color: 'rgba(255,255,255,0.35)', fontSize: 12, marginLeft: 8 }}>{ex.equipment}</span>
                  </span>
                  <span style={{ background: `${TEAL}20`, color: TEAL, fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 999 }}>{ex.muscleGroup}</span>
                </button>
              ))}
              {addCandidates.length === 0 && (
                <p style={{ color: 'rgba(255,255,255,0.3)', textAlign: 'center', padding: 24 }}>No matching exercises</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Substitution Modal ─────────────────────────────────────────────── */}
      {subTarget && subEx && (
        <div style={overlayStyle} onClick={() => setSubTarget(null)}>
          <div style={modalStyle} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Substitute Exercise</h3>
              <button onClick={() => setSubTarget(null)} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)', fontSize: 22, cursor: 'pointer' }}>×</button>
            </div>
            <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13, marginBottom: 14 }}>
              Replacing: <strong style={{ color: '#fff' }}>{getWeekExercise(subEx, subTarget.scope === 'week' ? activeWeek : 1).name}</strong>
            </p>

            {/* Scope toggle */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
              {(['template', 'week'] as const).map(scope => (
                <button
                  key={scope}
                  onClick={() => setSubTarget(prev => prev ? { ...prev, scope } : prev)}
                  style={{
                    padding: '7px 16px', borderRadius: 20, fontWeight: 700, fontSize: 12, border: 'none', cursor: 'pointer',
                    background: subTarget.scope === scope ? TEAL : 'rgba(255,255,255,0.08)',
                    color: subTarget.scope === scope ? '#0f1117' : 'rgba(255,255,255,0.5)',
                  }}
                >
                  {scope === 'template' ? 'All weeks (permanent)' : `Week ${activeWeek} only`}
                </button>
              ))}
            </div>

            <input
              value={subSearch}
              onChange={e => setSubSearch(e.target.value)}
              placeholder={`Search ${subMuscle} alternatives…`}
              autoFocus
              style={searchInputStyle}
            />
            <p style={{ color: 'rgba(255,255,255,0.3)', fontSize: 12, marginBottom: 10 }}>
              Showing {subMuscle} exercises
            </p>
            <div style={{ maxHeight: 360, overflowY: 'auto' }}>
              {subCandidates.slice(0, 40).map(ex => (
                <button
                  key={ex.id}
                  onClick={() => handleSubstitute(ex)}
                  style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '11px 14px', background: 'none', border: 'none', borderBottom: '1px solid rgba(255,255,255,0.06)', cursor: 'pointer', textAlign: 'left' }}
                >
                  <span>
                    <span style={{ color: '#fff', fontWeight: 600, fontSize: 14 }}>{ex.name}</span>
                    <span style={{ color: 'rgba(255,255,255,0.35)', fontSize: 12, marginLeft: 8 }}>{ex.equipment}</span>
                  </span>
                  <span style={{ color: TEAL, fontSize: 13, fontWeight: 700 }}>Use this →</span>
                </button>
              ))}
              {subCandidates.length === 0 && (
                <p style={{ color: 'rgba(255,255,255,0.3)', textAlign: 'center', padding: 24 }}>No alternatives found for {subMuscle}</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Shared styles ─────────────────────────────────────────────────────────────

const inputStyle: React.CSSProperties = {
  background: 'rgba(255,255,255,0.08)',
  border: '1px solid rgba(255,255,255,0.12)',
  borderRadius: 6,
  padding: '5px 8px',
  color: '#fff',
  fontSize: 13,
  width: 72,
  outline: 'none',
  textAlign: 'center',
};

const overlayStyle: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  zIndex: 200, padding: 20,
};

const modalStyle: React.CSSProperties = {
  background: '#1a1d26',
  border: '1px solid rgba(255,255,255,0.12)',
  borderRadius: 18, padding: 24,
  width: '100%', maxWidth: 520, maxHeight: '85vh',
  overflowY: 'auto',
};

const searchInputStyle: React.CSSProperties = {
  background: 'rgba(255,255,255,0.07)',
  border: '1px solid rgba(255,255,255,0.15)',
  borderRadius: 10, padding: '10px 14px',
  color: '#fff', fontSize: 14, outline: 'none',
  width: '100%', marginBottom: 12, boxSizing: 'border-box',
};
