'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { getSupabase } from '@/lib/supabase';
import { EXERCISES, MUSCLE_GROUPS, Exercise } from '@/data/exercises';
import { Sk, SkPage, SkSubHeader } from '@/components/Skeleton';

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

type WeightUnit = 'lbs' | 'kg';

interface TemplateExercise {
  id: string;
  exercise: Exercise;
  sets: WorkoutSet[];     // Week 1 baseline
  notes?: string;
  weeks?: WeekData[];     // Weeks 2+ overrides
  unit?: WeightUnit;      // per-exercise unit preference
  rest?: number;          // rest between sets (seconds), same for all weeks
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
  const [tags,        setTags]        = useState<string[]>([]);
  const [exercises,   setExercises]   = useState<TemplateExercise[]>([]);
  const [activeWeek,  setActiveWeek]  = useState(1);
  const [draggedId,     setDraggedId]     = useState<string | null>(null);
  const [dragOverId,    setDragOverId]    = useState<string | null>(null);
  const [collapsedIds,  setCollapsedIds]  = useState<Set<string>>(new Set());
  const [preferredUnit, setPreferredUnit] = useState<WeightUnit>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('liftlog_weight_unit');
      if (saved === 'kg' || saved === 'lbs') return saved as WeightUnit;
    }
    return 'lbs';
  });
  const lastRestRef = useRef<number>(60); // seconds; carries to next added exercise

  const [mediaMap,       setMediaMap]       = useState<Record<string, { type: string; signedUrl?: string; urlLink?: string }>>({});
  const [demoPreview,    setDemoPreview]    = useState<{ name: string; type: string; signedUrl?: string; urlLink?: string } | null>(null);
  const [addVideoTarget, setAddVideoTarget] = useState<string | null>(null);
  const [videoUrl,       setVideoUrl]       = useState('');
  const [savingVideo,    setSavingVideo]    = useState(false);
  const [userId,         setUserId]         = useState('');

  // Add exercise modal
  const [showAddModal,   setShowAddModal]   = useState(false);
  const [exSearch,       setExSearch]       = useState('');
  const [exMuscle,       setExMuscle]       = useState('All');
  // Custom exercise form within the modal
  const [showCustomForm, setShowCustomForm] = useState(false);
  const [customName,     setCustomName]     = useState('');
  const [customMuscle,   setCustomMuscle]   = useState(MUSCLE_GROUPS[0]);
  const [customEquip,    setCustomEquip]    = useState('Bodyweight');
  const [customType,     setCustomType]     = useState<'weighted' | 'duration' | 'cardio'>('weighted');

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
      setUserId(data.session.user.id);

      // Load exercise media so cards can show video badges + previews
      const { data: mediaItems } = await sb
        .from('exercise_media')
        .select('exercise_name, media_type, file_path, url_link')
        .eq('practitioner_id', data.session.user.id);
      const mediaMapData: Record<string, { type: string; signedUrl?: string; urlLink?: string }> = {};
      await Promise.all((mediaItems ?? []).map(async (m: any) => {
        let signedUrl: string | undefined;
        if (m.media_type !== 'link' && m.file_path) {
          const { data: su } = await sb.storage.from('exercise-media').createSignedUrl(m.file_path, 3600);
          signedUrl = su?.signedUrl ?? undefined;
        }
        mediaMapData[m.exercise_name] = { type: m.media_type, signedUrl, urlLink: m.url_link ?? undefined };
      }));
      setMediaMap(mediaMapData);

      const { data: tpl } = await sb
        .from('plan_templates')
        .select('*')
        .eq('id', templateId)
        .single();
      if (!tpl) { router.push('/plans/library'); return; }

      setName(tpl.name);
      setDescription(tpl.description ?? '');
      setTags(tpl.tags ?? []);
      const loadedExercises: TemplateExercise[] = (tpl.exercises ?? []).map((e: any) => ({
        id: e.id ?? uid(),
        exercise: e.exercise,
        sets: (e.sets ?? [defaultSet(e.exercise)]).map((s: any) => {
          const { rest: _r, ...setWithoutRest } = s;
          return setWithoutRest;
        }),
        notes: e.notes ?? '',
        weeks: (e.weeks ?? []).map((w: any) => ({
          ...w,
          sets: (w.sets ?? []).map((s: any) => { const { rest: _r, ...s2 } = s; return s2; }),
        })),
        unit: e.unit ?? undefined,
        // migrate from old per-set rest if present, else use saved exercise rest
        rest: e.rest ?? e.sets?.[0]?.rest ?? undefined,
      }));
      if (loadedExercises.length > 0) {
        const firstUnit = loadedExercises[0].unit;
        if (firstUnit) setPreferredUnit(firstUnit);
        const firstRest = loadedExercises[loadedExercises.length - 1].rest;
        if (firstRest) lastRestRef.current = firstRest;
      }
      setExercises(loadedExercises);
      // Auto-open the exercise picker when the template is brand new (no exercises yet)
      if (loadedExercises.length === 0) setShowAddModal(true);
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

  const toggleCollapse = (exId: string) => {
    setCollapsedIds(prev => {
      const next = new Set(prev);
      next.has(exId) ? next.delete(exId) : next.add(exId);
      return next;
    });
  };

  const handleDragStart = (e: React.DragEvent, id: string) => {
    const tag = (e.target as HTMLElement).tagName.toLowerCase();
    if (tag === 'input' || tag === 'button' || tag === 'textarea') { e.preventDefault(); return; }
    setDraggedId(id);
  };
  const handleDragEnd   = () => { setDraggedId(null); setDragOverId(null); };
  const handleDragOver  = (e: React.DragEvent, id: string) => { e.preventDefault(); if (id !== draggedId) setDragOverId(id); };
  const handleDrop      = (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    if (!draggedId || draggedId === targetId) { setDraggedId(null); setDragOverId(null); return; }
    setExercises(prev => {
      const items = [...prev];
      const from  = items.findIndex(p => p.id === draggedId);
      const to    = items.findIndex(p => p.id === targetId);
      const [moved] = items.splice(from, 1);
      items.splice(to, 0, moved);
      return items;
    });
    setDraggedId(null);
    setDragOverId(null);
  };

  // ── Add exercise ──────────────────────────────────────────────────────────

  const closeAddModal = () => {
    setShowAddModal(false);
    setExSearch('');
    setExMuscle('All');
    setShowCustomForm(false);
    setCustomName('');
  };

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
      unit: preferredUnit,
      rest: lastRestRef.current,
    };
    setExercises(prev => [...prev, newEx]);
    closeAddModal();
  };

  const toggleUnit = (exId: string) => {
    setExercises(prev => prev.map(ex => {
      if (ex.id !== exId) return ex;
      const current = ex.unit ?? preferredUnit;
      const next: WeightUnit = current === 'lbs' ? 'kg' : 'lbs';
      setPreferredUnit(next);
      localStorage.setItem('liftlog_weight_unit', next);
      return { ...ex, unit: next };
    }));
  };

  const updateExerciseRest = (exId: string, value: number) => {
    lastRestRef.current = value;
    setExercises(prev => prev.map(ex => ex.id === exId ? { ...ex, rest: value } : ex));
  };

  const handleAddCustomExercise = () => {
    if (!customName.trim()) return;
    const ex: Exercise = {
      id: `custom_${uid()}`,
      name: customName.trim(),
      muscleGroup: customMuscle,
      equipment: customEquip,
      type: customType,
    };
    handleAddExercise(ex);
  };

  const handleSaveVideo = async (exerciseName: string, url: string) => {
    if (!url.trim()) return;
    setSavingVideo(true);
    await getSupabase()
      .from('exercise_media')
      .upsert(
        { practitioner_id: userId, exercise_name: exerciseName, media_type: 'link', url_link: url.trim(), file_path: null },
        { onConflict: 'practitioner_id,exercise_name' }
      );
    setMediaMap(prev => ({ ...prev, [exerciseName]: { type: 'link', urlLink: url.trim() } }));
    setSavingVideo(false);
    setAddVideoTarget(null);
    setVideoUrl('');
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
      .update({ name: name.trim(), description: description.trim() || null, exercises, tags })
      .eq('id', templateId);
    setSaving(false);
    if (error) { alert('Could not save: ' + error.message); return; }
    router.push('/plans/library');
  };

  // ── Render helpers ────────────────────────────────────────────────────────

  const renderSetRow = (ex: TemplateExercise, set: WorkoutSet, setIdx: number, totalSets: number) => {
    const exType = getWeekExercise(ex, activeWeek).type;
    const unit = ex.unit ?? preferredUnit;
    return (
      <div key={setIdx} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: setIdx < totalSets - 1 ? '1px solid rgba(255,255,255,0.05)' : 'none' }}>
        <span style={{ color: 'var(--text-dim)', fontSize: 12, width: 24, flexShrink: 0 }}>
          {setIdx + 1}
        </span>

        {exType === 'weighted' && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <input
                type="number"
                value={set.reps ?? ''}
                onChange={e => updateSet(ex.id, setIdx, 'reps', Number(e.target.value))}
                onFocus={e => e.target.select()}
                style={inputStyle}
                placeholder="0"
              />
              <span style={{ color: 'var(--text-dim)', fontSize: 12 }}>reps</span>
            </div>
            <span style={{ color: 'var(--text-faint)', fontSize: 12 }}>@</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <input
                type="number"
                value={set.weight ?? ''}
                onChange={e => updateSet(ex.id, setIdx, 'weight', Number(e.target.value))}
                onFocus={e => e.target.select()}
                style={inputStyle}
                placeholder="0"
              />
              <span style={{ color: 'var(--text-dim)', fontSize: 12 }}>{unit}</span>
            </div>
          </>
        )}

        {(exType === 'duration' || exType === 'cardio') && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <input
              type="number"
              value={set.seconds ?? ''}
              onChange={e => updateSet(ex.id, setIdx, 'seconds', Number(e.target.value))}
              onFocus={e => e.target.select()}
              style={inputStyle}
              placeholder="0"
            />
            <span style={{ color: 'var(--text-dim)', fontSize: 12 }}>sec</span>
          </div>
        )}

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
      <SkPage>
        <SkSubHeader />
        <main style={{ maxWidth: 900, margin: '0 auto', padding: '24px 24px' }}>
          <Sk width={240} height={22} style={{ marginBottom: 10 }} />
          <Sk width={360} height={13} radius={4} style={{ marginBottom: 24 }} />
          <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
            {[80,80,80,80].map((w,i) => <Sk key={i} width={w} height={34} radius={8} />)}
          </div>
          {[0,1,2].map(i => (
            <div key={i} style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16, padding: '16px 20px', marginBottom: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                <Sk width={160} height={14} />
                <Sk width={70} height={22} radius={999} style={{ marginLeft: 'auto' }} />
                <Sk width={28} height={28} radius={8} />
              </div>
              {[0,1,2].map(j => (
                <div key={j} style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                  <Sk width={40} height={34} radius={8} />
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
    <div style={{ minHeight: '100vh', background: 'var(--bg)', color: 'var(--text)', fontFamily: 'sans-serif' }}>
      {/* Sub-header */}
      <div style={{ borderBottom: '1px solid var(--border-subtle)', padding: '12px 32px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>
          <a href="/plans/library" style={{ color: 'var(--text-muted)', textDecoration: 'none' }}>Library</a>
          {' / Edit'}
        </span>
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
      </div>

      <main style={{ maxWidth: 1100, margin: '0 auto', padding: '32px 32px 80px' }}>
        {/* Template name + description */}
        <div style={{ marginBottom: 28 }}>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Template name"
            style={{ background: 'transparent', border: 'none', outline: 'none', color: 'var(--text)', fontSize: 28, fontWeight: 800, width: '100%', padding: 0, marginBottom: 8 }}
          />
          <input
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="Description (optional) — e.g. 4-week hypertrophy block for intermediate lifters"
            style={{ background: 'transparent', border: 'none', outline: 'none', color: 'var(--text-muted)', fontSize: 14, width: '100%', padding: 0 }}
          />
        </div>

        {/* Tag picker */}
        <div style={{ marginBottom: 28 }}>
          {[
            { label: 'Body Part', tags: ['Shoulder','Knee','Hip','Lower Back','Core','Full Body','Upper Body','Lower Body','Chest','Back','Arms','Legs','Calves'] },
            { label: 'Goal / Type', tags: ['Strength','Hypertrophy','Rehab','Mobility','Cardio','HIIT','Power','Endurance','Flexibility'] },
          ].map(group => (
            <div key={group.label} style={{ marginBottom: 10 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.07em', marginRight: 10 }}>
                {group.label}
              </span>
              <div style={{ display: 'inline-flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                {group.tags.map(t => {
                  const on = tags.includes(t);
                  return (
                    <button
                      key={t}
                      onClick={() => setTags(prev => on ? prev.filter(x => x !== t) : [...prev, t])}
                      style={{
                        padding: '4px 12px', borderRadius: 999, fontSize: 12, fontWeight: 600,
                        border: `1px solid ${on ? TEAL : 'rgba(255,255,255,0.18)'}`,
                        background: on ? `${TEAL}22` : 'transparent',
                        color: on ? TEAL : 'rgba(255,255,255,0.45)',
                        cursor: 'pointer', transition: 'all 0.15s',
                      }}
                    >
                      {t}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
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
            {activeWeek > 1 && <span style={{ color: 'var(--text-dim)', fontWeight: 400, fontSize: 13, marginLeft: 10 }}>Inherited from Week 1 unless edited below</span>}
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
          <div style={{ background: 'var(--card)', border: '1px dashed rgba(255,255,255,0.15)', borderRadius: 16, padding: 48, textAlign: 'center' }}>
            <p style={{ color: 'var(--text-dim)', marginBottom: 16 }}>No exercises yet. Add exercises to build this template.</p>
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
              const isDragging  = draggedId === ex.id;
              const isDragOver  = dragOverId === ex.id;
              const isCollapsed = collapsedIds.has(ex.id);
              const firstSet    = weekSets[0];
              const collapseSummary = weekSets.length > 0
                ? `${weekSets.length} set${weekSets.length !== 1 ? 's' : ''}`
                  + (weekExercise.type === 'weighted' && firstSet?.reps ? ` · ${firstSet.reps} reps @ ${firstSet.weight ?? 0} ${ex.unit ?? preferredUnit}` : '')
                  + (ex.rest ? ` · ${ex.rest}s rest` : '')
                : 'No sets';
              return (
                <div
                  key={ex.id}
                  draggable
                  onDragStart={e => handleDragStart(e, ex.id)}
                  onDragEnd={handleDragEnd}
                  onDragOver={e => handleDragOver(e, ex.id)}
                  onDrop={e => handleDrop(e, ex.id)}
                  style={{
                    background: isDragOver ? 'rgba(95,207,191,0.06)' : 'rgba(255,255,255,0.04)',
                    border: `1px solid ${isDragOver ? `${TEAL}80` : 'rgba(255,255,255,0.1)'}`,
                    borderRadius: 14, padding: '18px 20px',
                    opacity: isDragging ? 0.4 : 1,
                    cursor: 'grab',
                    transition: 'border-color 0.15s, opacity 0.15s',
                  }}
                >
                  {/* Exercise header */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
                    {/* Drag handle */}
                    <span style={{ color: 'var(--text-faint)', fontSize: 16, cursor: 'grab', userSelect: 'none', marginRight: 2 }} title="Drag to reorder">⠿</span>
                    <span style={{ fontWeight: 700, fontSize: 15 }}>{weekExercise.name}</span>
                    {isOverridden && (
                      <span style={{ background: `${PURPLE}20`, color: PURPLE, fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 999 }}>Week {activeWeek} substitute</span>
                    )}
                    <span style={{ background: `${TEAL}15`, color: TEAL, fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 999 }}>
                      {weekExercise.muscleGroup}
                    </span>
                    <span style={{ background: 'var(--card-alt)', color: 'var(--text-muted)', fontSize: 11, padding: '2px 8px', borderRadius: 999 }}>
                      {weekExercise.equipment}
                    </span>
                    {mediaMap[weekExercise.name] ? (
                      <button
                        onClick={e => { e.stopPropagation(); setDemoPreview({ name: weekExercise.name, ...mediaMap[weekExercise.name] }); }}
                        style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 999, background: `${TEAL}18`, color: TEAL, border: 'none', cursor: 'pointer' }}
                        title="Click to preview demo"
                      >
                        {mediaMap[weekExercise.name].type === 'link' ? '🔗 Link' : mediaMap[weekExercise.name].type === 'video' ? '📹 Video' : '📷 Photo'}
                      </button>
                    ) : (
                      <button
                        onClick={e => { e.stopPropagation(); setAddVideoTarget(weekExercise.name); setVideoUrl(''); }}
                        style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 999, background: 'var(--card-alt)', color: 'var(--text-muted)', border: '1px dashed rgba(255,255,255,0.2)', cursor: 'pointer' }}
                        title="Add a video demo link for this exercise"
                      >
                        + Add Video
                      </button>
                    )}
                    <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
                      {/* Collapse / expand toggle */}
                      <button
                        onClick={() => toggleCollapse(ex.id)}
                        style={{ background: 'none', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 6, padding: '5px 10px', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 13, lineHeight: 1 }}
                        title={isCollapsed ? 'Expand' : 'Minimise'}
                      >
                        {isCollapsed ? '▶' : '▼'}
                      </button>
                      <button
                        onClick={() => { setSubTarget({ exId: ex.id, scope: 'template' }); setSubSearch(''); }}
                        style={{ background: 'var(--card-alt)', color: 'var(--text-muted)', border: '1px solid var(--border-strong)', borderRadius: 8, padding: '5px 12px', fontSize: 12, cursor: 'pointer' }}
                        title="Substitute this exercise"
                      >
                        ⇄ Substitute
                      </button>
                      <button
                        onClick={() => moveExercise(ex.id, -1)}
                        disabled={exIdx === 0}
                        style={{ background: 'none', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 6, padding: '5px 8px', color: 'var(--text-muted)', cursor: exIdx === 0 ? 'not-allowed' : 'pointer', opacity: exIdx === 0 ? 0.3 : 1 }}
                      >↑</button>
                      <button
                        onClick={() => moveExercise(ex.id, 1)}
                        disabled={exIdx === exercises.length - 1}
                        style={{ background: 'none', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 6, padding: '5px 8px', color: 'var(--text-muted)', cursor: exIdx === exercises.length - 1 ? 'not-allowed' : 'pointer', opacity: exIdx === exercises.length - 1 ? 0.3 : 1 }}
                      >↓</button>
                      <button
                        onClick={() => { if (confirm(`Remove ${weekExercise.name}?`)) removeExercise(ex.id); }}
                        style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 6, padding: '5px 10px', color: RED, cursor: 'pointer', fontSize: 12 }}
                      >
                        Remove
                      </button>
                    </div>
                  </div>

                  {/* Collapsed summary */}
                  {isCollapsed && (
                    <p style={{ margin: 0, color: 'var(--text-dim)', fontSize: 13 }}>{collapseSummary}</p>
                  )}

                  {/* Set rows */}
                  {!isCollapsed && <div style={{ background: 'rgba(0,0,0,0.2)', borderRadius: 10, padding: '8px 12px' }}>
                    <div style={{ display: 'flex', gap: 8, marginBottom: 6, alignItems: 'center' }}>
                      <span style={{ color: 'var(--text-faint)', fontSize: 11, width: 24 }}>#</span>
                      {weekExercise.type === 'weighted' && (
                        <>
                          <span style={{ color: 'var(--text-faint)', fontSize: 11, width: 80 }}>Reps</span>
                          <span style={{ color: 'var(--text-faint)', fontSize: 11, width: 80 }}>
                            Weight ({ex.unit ?? preferredUnit})
                          </span>
                        </>
                      )}
                      {(weekExercise.type === 'duration' || weekExercise.type === 'cardio') && (
                        <span style={{ color: 'var(--text-faint)', fontSize: 11, width: 80 }}>Duration (s)</span>
                      )}
                      {/* Unit toggle — only for weighted exercises */}
                      {weekExercise.type === 'weighted' && (
                        <button
                          onClick={() => toggleUnit(ex.id)}
                          style={{ marginLeft: 'auto', background: 'var(--card-alt)', border: '1px solid var(--border-strong)', borderRadius: 6, padding: '2px 10px', color: TEAL, fontSize: 11, fontWeight: 700, cursor: 'pointer' }}
                          title="Toggle weight unit for this exercise"
                        >
                          {ex.unit ?? preferredUnit} ⇄ {(ex.unit ?? preferredUnit) === 'lbs' ? 'kg' : 'lbs'}
                        </button>
                      )}
                    </div>
                    {weekSets.map((set, setIdx) => renderSetRow(ex, set, setIdx, weekSets.length))}
                    <button
                      onClick={() => addSet(ex.id)}
                      style={{ marginTop: 8, background: 'none', border: 'none', color: TEAL, fontSize: 12, fontWeight: 600, cursor: 'pointer', padding: '4px 0' }}
                    >
                      + Add Set
                    </button>

                    {/* Rest between sets — one per exercise, carries to next */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border-subtle)' }}>
                      <span style={{ color: 'var(--text-dim)', fontSize: 12 }}>Rest between sets:</span>
                      <input
                        type="number"
                        value={ex.rest ?? lastRestRef.current}
                        onChange={e => updateExerciseRest(ex.id, Number(e.target.value))}
                        onFocus={e => e.target.select()}
                        style={{ ...inputStyle, width: 56 }}
                        min={0}
                      />
                      <span style={{ color: 'var(--text-dim)', fontSize: 12 }}>seconds</span>
                    </div>
                  </div>}
                </div>
              );
            })}
          </div>
        )}

        {/* Bottom save bar */}
        <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, background: 'rgba(15,17,23,0.95)', borderTop: '1px solid var(--border)', padding: '16px 32px', display: 'flex', justifyContent: 'flex-end', gap: 12, zIndex: 100 }}>
          <button
            onClick={() => router.push('/plans/library')}
            style={{ background: 'var(--card-alt)', color: 'var(--text-muted)', border: '1px solid var(--border-strong)', borderRadius: 10, padding: '10px 24px', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}
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
        <div style={overlayStyle} onClick={closeAddModal}>
          <div style={modalStyle} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Add Exercise</h3>
              <button onClick={closeAddModal} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 22, cursor: 'pointer' }}>×</button>
            </div>

            {!showCustomForm ? (
              <>
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
                <div style={{ maxHeight: 300, overflowY: 'auto' }}>
                  {addCandidates.slice(0, 60).map(ex => (
                    <button
                      key={ex.id}
                      onClick={() => handleAddExercise(ex)}
                      style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '11px 14px', background: 'none', border: 'none', borderBottom: '1px solid rgba(255,255,255,0.06)', cursor: 'pointer', textAlign: 'left' }}
                    >
                      <span>
                        <span style={{ color: 'var(--text)', fontWeight: 600, fontSize: 14 }}>{ex.name}</span>
                        <span style={{ color: 'var(--text-dim)', fontSize: 12, marginLeft: 8 }}>{ex.equipment}</span>
                      </span>
                      <span style={{ background: `${TEAL}20`, color: TEAL, fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 999 }}>{ex.muscleGroup}</span>
                    </button>
                  ))}
                  {addCandidates.length === 0 && (
                    <p style={{ color: 'var(--text-dim)', textAlign: 'center', padding: 16, marginBottom: 0 }}>No matching exercises</p>
                  )}
                </div>
                {/* Custom exercise CTA */}
                <button
                  onClick={() => { setShowCustomForm(true); setCustomName(exSearch); }}
                  style={{ width: '100%', marginTop: 12, padding: '11px 14px', background: 'var(--card)', border: '1px dashed rgba(255,255,255,0.2)', borderRadius: 10, color: 'var(--text-muted)', fontSize: 13, fontWeight: 600, cursor: 'pointer', textAlign: 'left' }}
                >
                  + Create custom exercise{exSearch ? ` "${exSearch}"` : ''}
                </button>
              </>
            ) : (
              /* Custom exercise form */
              <>
                <button
                  onClick={() => setShowCustomForm(false)}
                  style={{ background: 'none', border: 'none', color: TEAL, fontSize: 13, fontWeight: 600, cursor: 'pointer', padding: '0 0 12px 0', display: 'block' }}
                >
                  ‹ Back to search
                </button>
                <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 16 }}>
                  Add an exercise that isn't in the standard library.
                </p>

                <label style={{ display: 'block', color: 'var(--text-muted)', fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Exercise Name</label>
                <input
                  value={customName}
                  onChange={e => setCustomName(e.target.value)}
                  placeholder="e.g. Bulgarian Split Squat"
                  autoFocus
                  style={{ ...searchInputStyle, marginBottom: 14 }}
                  onKeyDown={e => { if (e.key === 'Enter') handleAddCustomExercise(); }}
                />

                <label style={{ display: 'block', color: 'var(--text-muted)', fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Muscle Group</label>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
                  {MUSCLE_GROUPS.map(mg => (
                    <button key={mg} onClick={() => setCustomMuscle(mg)}
                      style={{ padding: '4px 12px', borderRadius: 16, fontSize: 12, fontWeight: 600, border: 'none', cursor: 'pointer', background: customMuscle === mg ? TEAL : 'rgba(255,255,255,0.08)', color: customMuscle === mg ? '#0f1117' : 'rgba(255,255,255,0.5)' }}
                    >{mg}</button>
                  ))}
                </div>

                <label style={{ display: 'block', color: 'var(--text-muted)', fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Equipment</label>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
                  {['Barbell','Dumbbell','Kettlebell','Cable','Machine','Bodyweight','Other'].map(eq => (
                    <button key={eq} onClick={() => setCustomEquip(eq)}
                      style={{ padding: '4px 12px', borderRadius: 16, fontSize: 12, fontWeight: 600, border: 'none', cursor: 'pointer', background: customEquip === eq ? TEAL : 'rgba(255,255,255,0.08)', color: customEquip === eq ? '#0f1117' : 'rgba(255,255,255,0.5)' }}
                    >{eq}</button>
                  ))}
                </div>

                <label style={{ display: 'block', color: 'var(--text-muted)', fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Tracking Type</label>
                <div style={{ display: 'flex', gap: 6, marginBottom: 20 }}>
                  {([['weighted','Weight + Reps'],['duration','Duration'],['cardio','Cardio']] as const).map(([val, label]) => (
                    <button key={val} onClick={() => setCustomType(val)}
                      style={{ padding: '6px 14px', borderRadius: 16, fontSize: 12, fontWeight: 600, border: 'none', cursor: 'pointer', background: customType === val ? TEAL : 'rgba(255,255,255,0.08)', color: customType === val ? '#0f1117' : 'rgba(255,255,255,0.5)' }}
                    >{label}</button>
                  ))}
                </div>

                <button
                  onClick={handleAddCustomExercise}
                  disabled={!customName.trim()}
                  style={{ width: '100%', background: customName.trim() ? TEAL : 'rgba(255,255,255,0.1)', color: customName.trim() ? '#0f1117' : 'rgba(255,255,255,0.3)', border: 'none', borderRadius: 10, padding: '12px', fontWeight: 700, fontSize: 15, cursor: customName.trim() ? 'pointer' : 'not-allowed' }}
                >
                  Add "{customName.trim() || 'exercise'}" to template
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Substitution Modal ─────────────────────────────────────────────── */}
      {subTarget && subEx && (
        <div style={overlayStyle} onClick={() => setSubTarget(null)}>
          <div style={modalStyle} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Substitute Exercise</h3>
              <button onClick={() => setSubTarget(null)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 22, cursor: 'pointer' }}>×</button>
            </div>
            <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 14 }}>
              Replacing: <strong style={{ color: 'var(--text)' }}>{getWeekExercise(subEx, subTarget.scope === 'week' ? activeWeek : 1).name}</strong>
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
            <p style={{ color: 'var(--text-dim)', fontSize: 12, marginBottom: 10 }}>
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
                    <span style={{ color: 'var(--text)', fontWeight: 600, fontSize: 14 }}>{ex.name}</span>
                    <span style={{ color: 'var(--text-dim)', fontSize: 12, marginLeft: 8 }}>{ex.equipment}</span>
                  </span>
                  <span style={{ color: TEAL, fontSize: 13, fontWeight: 700 }}>Use this →</span>
                </button>
              ))}
              {subCandidates.length === 0 && (
                <p style={{ color: 'var(--text-dim)', textAlign: 'center', padding: 24 }}>No alternatives found for {subMuscle}</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Demo preview modal */}
      {demoPreview && (
        <div onClick={() => setDemoPreview(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.82)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 300, padding: 24 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: '#1a1d27', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 20, overflow: 'hidden', width: '100%', maxWidth: 560 }}>
            <div style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--border-subtle)' }}>
              <div>
                <p style={{ fontWeight: 700, fontSize: 16, margin: 0 }}>{demoPreview.name}</p>
                <p style={{ color: 'var(--text-dim)', fontSize: 12, margin: '2px 0 0' }}>Exercise demo</p>
              </div>
              <button onClick={() => setDemoPreview(null)} style={{ background: 'var(--input-bg)', border: 'none', color: 'var(--text)', borderRadius: 8, width: 32, height: 32, fontSize: 18, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
            </div>
            {demoPreview.type === 'photo' && demoPreview.signedUrl ? (
              <img src={demoPreview.signedUrl} alt={demoPreview.name} style={{ width: '100%', maxHeight: 360, objectFit: 'contain', background: 'var(--bg)', display: 'block' }} />
            ) : demoPreview.type === 'video' && demoPreview.signedUrl ? (
              <video src={demoPreview.signedUrl} controls autoPlay style={{ width: '100%', maxHeight: 360, background: '#000', display: 'block' }} />
            ) : demoPreview.type === 'link' && demoPreview.urlLink ? (
              <div style={{ padding: '32px 24px', textAlign: 'center' }}>
                <p style={{ fontSize: 36, marginBottom: 12 }}>🔗</p>
                <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 20, wordBreak: 'break-all' }}>{demoPreview.urlLink}</p>
                <a href={demoPreview.urlLink} target="_blank" rel="noopener noreferrer" style={{ background: TEAL, color: '#0f1117', borderRadius: 10, padding: '10px 24px', fontWeight: 700, fontSize: 14, textDecoration: 'none', display: 'inline-block' }}>
                  Open video ↗
                </a>
              </div>
            ) : null}
          </div>
        </div>
      )}

      {/* Add video link modal */}
      {addVideoTarget && (
        <div onClick={() => setAddVideoTarget(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 300, padding: 24 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: '#1a1d27', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 20, padding: 32, width: '100%', maxWidth: 440 }}>
            <h2 style={{ fontWeight: 700, fontSize: 18, margin: '0 0 4px' }}>Add Video Link</h2>
            <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 20 }}>{addVideoTarget}</p>
            <input
              autoFocus
              value={videoUrl}
              onChange={e => setVideoUrl(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && videoUrl.trim()) handleSaveVideo(addVideoTarget, videoUrl); if (e.key === 'Escape') setAddVideoTarget(null); }}
              placeholder="https://youtube.com/watch?v=..."
              style={{ width: '100%', boxSizing: 'border-box', background: 'var(--card-alt)', border: '1px solid var(--border-strong)', borderRadius: 10, padding: '11px 14px', color: 'var(--text)', fontSize: 14, outline: 'none', marginBottom: 16 }}
            />
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setAddVideoTarget(null)} style={{ flex: 1, background: 'var(--card-alt)', border: '1px solid var(--border-strong)', color: 'var(--text-muted)', borderRadius: 10, padding: '11px 0', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>Cancel</button>
              <button
                onClick={() => handleSaveVideo(addVideoTarget, videoUrl)}
                disabled={!videoUrl.trim() || savingVideo}
                style={{ flex: 2, background: videoUrl.trim() ? TEAL : 'rgba(255,255,255,0.08)', color: videoUrl.trim() ? '#0f1117' : 'rgba(255,255,255,0.3)', borderRadius: 10, padding: '11px 0', fontWeight: 700, fontSize: 14, border: 'none', cursor: videoUrl.trim() ? 'pointer' : 'not-allowed' }}
              >
                {savingVideo ? 'Saving…' : 'Save Video Link'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Shared styles ─────────────────────────────────────────────────────────────

const inputStyle: React.CSSProperties = {
  background: 'var(--input-bg)',
  border: '1px solid rgba(255,255,255,0.12)',
  borderRadius: 6,
  padding: '5px 8px',
  color: 'var(--text)',
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
  background: 'var(--card-alt)',
  border: '1px solid var(--border-strong)',
  borderRadius: 10, padding: '10px 14px',
  color: 'var(--text)', fontSize: 14, outline: 'none',
  width: '100%', marginBottom: 12, boxSizing: 'border-box',
};
