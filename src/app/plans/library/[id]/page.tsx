'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState, useCallback, useRef, Fragment } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { getSupabase } from '@/lib/supabase';
import { useNavGuard } from '@/lib/NavGuardContext';
import { EXERCISES, MUSCLE_GROUPS, Exercise } from '@/data/exercises';
import { Sk, SkPage, SkSubHeader } from '@/components/Skeleton';

const TEAL   = '#5fcfbf';
const PURPLE = '#C471ED';
const RED    = '#EF4444';

const MUSCLE_GROUP_SECTIONS = [
  { label: 'Upper Body', members: ['Chest', 'Back', 'Shoulders'] },
  { label: 'Arms',       members: ['Biceps', 'Triceps', 'Forearms'] },
  { label: 'Core',       members: ['Core'] },
  { label: 'Legs',       members: ['Quadriceps', 'Hamstrings', 'Adductors', 'Glutes', 'Calves', 'Hip Flexors'] },
  { label: 'Other',      members: ['Cardio', 'Pilates', 'Yoga', 'Isometrics', 'Balance', 'Plyometrics', 'Rotator Cuff', 'Ankle & Foot', 'Cervical', 'Lumbar'] },
];

// ── Types ─────────────────────────────────────────────────────────────────────

type WeightUnit = 'lbs' | 'kg';

interface DropSet {
  id: string;
  weight?: number;
  reps?: number;
  unit?: WeightUnit;
}

interface WorkoutSet {
  reps?: number;
  weight?: number;
  seconds?: number;
  rest?: number;
  dropSets?: DropSet[];
}

interface WeekData {
  week: number;
  sets: WorkoutSet[];
  exerciseOverride?: Exercise;
}

interface TemplateExercise {
  id: string;
  exercise: Exercise;
  sets: WorkoutSet[];
  notes?: string;
  weeks?: WeekData[];
  unit?: WeightUnit;
  rest?: number;
  supersetWithId?: string;
}

interface TemplateDay {
  id: string;
  label: string;
  exercises: TemplateExercise[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function numWeeks(days: TemplateDay[]): number {
  let max = 1;
  for (const day of days) {
    for (const ex of day.exercises) {
      for (const w of ex.weeks ?? []) {
        if (w.week > max) max = w.week;
      }
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

function parseExercise(e: any): TemplateExercise {
  return {
    id: e.id ?? uid(),
    exercise: e.exercise,
    sets: (e.sets ?? [defaultSet(e.exercise)]).map((s: any) => {
      const { rest: _r, ...rest } = s;
      return rest;
    }),
    notes: e.notes ?? '',
    weeks: (e.weeks ?? []).map((w: any) => ({
      ...w,
      sets: (w.sets ?? []).map((s: any) => { const { rest: _r, ...s2 } = s; return s2; }),
    })),
    unit: e.unit ?? undefined,
    rest: e.rest ?? e.sets?.[0]?.rest ?? undefined,
    supersetWithId: e.supersetWithId ?? undefined,
  };
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

  // Day state
  const [days,            setDays]            = useState<TemplateDay[]>([{ id: 'day-1', label: 'Day 1', exercises: [] }]);
  const [activeDayId,     setActiveDayId]     = useState('day-1');
  const [editingDayId,    setEditingDayId]    = useState<string | null>(null);
  const [editingDayLabel, setEditingDayLabel] = useState('');

  const [activeWeek,  setActiveWeek]  = useState(1);
  const [draggedId,     setDraggedId]     = useState<string | null>(null);
  const [dragOverId,    setDragOverId]    = useState<string | null>(null);
  const [collapsedIds,  setCollapsedIds]  = useState<Set<string>>(new Set());
  const [supersetMode,  setSupersetMode]  = useState<string | null>(null);
  const [preferredUnit, setPreferredUnit] = useState<WeightUnit>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('liftlog_weight_unit');
      if (saved === 'kg' || saved === 'lbs') return saved as WeightUnit;
    }
    return 'lbs';
  });
  const lastRestRef = useRef<number>(60);
  const [frequencyPerWeek, setFrequencyPerWeek] = useState(3);

  const [mediaMap,       setMediaMap]       = useState<Record<string, { type: string; signedUrl?: string; urlLink?: string }>>({});
  const [demoPreview,    setDemoPreview]    = useState<{ name: string; type: string; signedUrl?: string; urlLink?: string } | null>(null);
  const [addVideoTarget, setAddVideoTarget] = useState<string | null>(null);
  const [videoUrl,       setVideoUrl]       = useState('');
  const [savingVideo,    setSavingVideo]    = useState(false);
  const [userId,         setUserId]         = useState('');

  // Sidebar
  const [sidebarOpen,        setSidebarOpen]        = useState(true);
  const [muscleDropdownOpen, setMuscleDropdownOpen] = useState(false);
  const muscleDropdownRef = useRef<HTMLDivElement>(null);
  const [search,             setSearch]             = useState('');
  const [muscleFilter,       setMuscleFilter]       = useState('All');
  const [showCustomForm, setShowCustomForm] = useState(false);
  const [customName,     setCustomName]     = useState('');
  const [customMuscle,   setCustomMuscle]   = useState(MUSCLE_GROUPS[0]);
  const [customEquip,    setCustomEquip]    = useState('Bodyweight');
  const [customType,     setCustomType]     = useState<'weighted' | 'duration' | 'cardio'>('weighted');
  const [customExercises, setCustomExercises] = useState<Exercise[]>([]);

  // Substitution modal
  const [subTarget, setSubTarget] = useState<{ exId: string; scope: 'template' | 'week' } | null>(null);
  const [subSearch, setSubSearch] = useState('');

  const isDirtyRef       = useRef(false);
  const dirtyEnabledRef  = useRef(false);
  const [navGuardHref, setNavGuardHref] = useState<string | null>(null);
  const { register: registerGuard, unregister: unregisterGuard } = useNavGuard();

  // Derived active-day values
  const activeDay      = days.find(d => d.id === activeDayId) ?? days[0];
  const exercises      = activeDay?.exercises ?? [];

  const updateActiveDay = useCallback((fn: (exs: TemplateExercise[]) => TemplateExercise[]) => {
    setDays(prev => prev.map(d => d.id === activeDayId ? { ...d, exercises: fn(d.exercises) } : d));
  }, [activeDayId]);

  // ── Load ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    const sb = getSupabase();
    sb.auth.getSession().then(async ({ data }) => {
      if (!data.session) { router.push('/login'); return; }
      const { data: prof } = await sb.from('profiles').select('role, is_gym_owner').eq('id', data.session.user.id).single();
      if (prof?.role !== 'practitioner' && !prof?.is_gym_owner) { router.push('/profile'); return; }
      setAuthed(true);
      setUserId(data.session.user.id);

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

      const raw = tpl.exercises;
      let loadedDays: TemplateDay[];
      if (raw && !Array.isArray(raw) && raw.days) {
        // New multi-day format
        if (raw.frequencyPerWeek) setFrequencyPerWeek(raw.frequencyPerWeek);
        loadedDays = (raw.days as any[]).map((day: any) => ({
          id: day.id ?? uid(),
          label: day.label ?? 'Day',
          exercises: (day.exercises ?? []).map(parseExercise),
        }));
      } else {
        // Legacy flat-array format — wrap in a single day
        loadedDays = [{ id: 'day-1', label: 'Day 1', exercises: (raw ?? []).map(parseExercise) }];
      }

      const firstEx = loadedDays[0]?.exercises[0];
      if (firstEx?.unit) setPreferredUnit(firstEx.unit);
      const lastEx = loadedDays[0]?.exercises.at(-1);
      if (lastEx?.rest) lastRestRef.current = lastEx.rest;

      setDays(loadedDays);
      setActiveDayId(loadedDays[0]?.id ?? 'day-1');

      const { data: custExs } = await sb.from('custom_exercises').select('id, name, muscle_group, equipment, type').eq('creator_id', data.session.user.id);
      setCustomExercises((custExs ?? []).map((e: any) => ({ id: `custom_${e.id}`, name: e.name, muscleGroup: e.muscle_group, equipment: e.equipment, type: e.type as 'weighted' | 'duration' | 'cardio' })));

      setLoading(false);
    });
  }, [router, templateId]);

  // Close muscle dropdown on outside click
  useEffect(() => {
    if (!muscleDropdownOpen) return;
    const handler = (e: MouseEvent) => {
      if (muscleDropdownRef.current && !muscleDropdownRef.current.contains(e.target as Node)) {
        setMuscleDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [muscleDropdownOpen]);

  // Enable dirty tracking after initial data has loaded
  useEffect(() => {
    if (!authed) return;
    const id = setTimeout(() => { dirtyEnabledRef.current = true; }, 300);
    return () => clearTimeout(id);
  }, [authed]);

  // Mark dirty when template data changes
  useEffect(() => {
    if (!dirtyEnabledRef.current) return;
    isDirtyRef.current = true;
  }, [name, description, days, frequencyPerWeek]);

  // Register/unregister the nav guard callback
  const guardedNavigate = useCallback((href: string) => {
    if (isDirtyRef.current) {
      setNavGuardHref(href);
    } else {
      router.push(href);
    }
  }, [router]);

  useEffect(() => {
    registerGuard(guardedNavigate);
    return () => unregisterGuard();
  }, [guardedNavigate, registerGuard, unregisterGuard]);

  // Warn on browser tab close/refresh
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (isDirtyRef.current) { e.preventDefault(); e.returnValue = ''; }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, []);

  // Escape closes the nav guard modal
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setNavGuardHref(null); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const totalWeeks = numWeeks(days);

  // ── Day management ────────────────────────────────────────────────────────

  const addDay = () => {
    const newId    = `day-${Date.now()}`;
    const newLabel = `Day ${days.length + 1}`;
    setDays(prev => [...prev, { id: newId, label: newLabel, exercises: [] }]);
    setActiveDayId(newId);
  };

  const removeDay = (dayId: string) => {
    if (days.length <= 1) return;
    setDays(prev => prev.filter(d => d.id !== dayId));
    if (activeDayId === dayId) {
      setActiveDayId(days[0].id !== dayId ? days[0].id : days[1].id);
    }
  };

  const startRenameDay = (day: TemplateDay) => {
    setEditingDayId(day.id);
    setEditingDayLabel(day.label);
  };

  const commitRenameDay = () => {
    if (!editingDayId) return;
    setDays(prev => prev.map(d => d.id === editingDayId ? { ...d, label: editingDayLabel.trim() || d.label } : d));
    setEditingDayId(null);
  };

  // ── Week management ────────────────────────────────────────────────────────

  const handleAddWeek = () => {
    const newWeek = totalWeeks + 1;
    setDays(prev => prev.map(day => ({
      ...day,
      exercises: day.exercises.map(ex => {
        const lastSets = getWeekSets(ex, totalWeeks);
        return { ...ex, weeks: [...(ex.weeks ?? []), { week: newWeek, sets: lastSets.map(s => ({ ...s })) }] };
      }),
    })));
    setActiveWeek(newWeek);
  };

  const handleRemoveLastWeek = () => {
    if (totalWeeks <= 1) return;
    const removing = totalWeeks;
    setDays(prev => prev.map(day => ({
      ...day,
      exercises: day.exercises.map(ex => ({
        ...ex,
        weeks: (ex.weeks ?? []).filter(w => w.week !== removing),
      })),
    })));
    setActiveWeek(Math.min(activeWeek, removing - 1));
  };

  // ── Set editing ───────────────────────────────────────────────────────────

  const updateSet = (exId: string, setIdx: number, field: keyof WorkoutSet, value: number) => {
    updateActiveDay(prev => prev.map(ex => {
      if (ex.id !== exId) return ex;
      const sets = getWeekSets(ex, activeWeek).map((s, i) =>
        i === setIdx ? { ...s, [field]: value } : s
      );
      return setWeekSets(ex, activeWeek, sets);
    }));
  };

  const addSet = (exId: string) => {
    updateActiveDay(prev => prev.map(ex => {
      if (ex.id !== exId) return ex;
      const current = getWeekSets(ex, activeWeek);
      const last = current[current.length - 1] ?? defaultSet(ex.exercise);
      return setWeekSets(ex, activeWeek, [...current, { ...last }]);
    }));
  };

  const removeSet = (exId: string, setIdx: number) => {
    updateActiveDay(prev => prev.map(ex => {
      if (ex.id !== exId) return ex;
      const current = getWeekSets(ex, activeWeek);
      if (current.length <= 1) return ex;
      return setWeekSets(ex, activeWeek, current.filter((_, i) => i !== setIdx));
    }));
  };

  const removeExercise = (exId: string) => {
    updateActiveDay(prev => prev.filter(ex => ex.id !== exId));
  };

  const moveExercise = (exId: string, dir: -1 | 1) => {
    updateActiveDay(prev => {
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

  const removeSuperset = (exId: string) => {
    updateActiveDay(prev => prev.map(ex =>
      ex.id === exId || ex.supersetWithId === exId ? { ...ex, supersetWithId: undefined } : ex
    ));
  };

  const handleSupersetClick = (exId: string) => {
    if (supersetMode === null) {
      setSupersetMode(exId);
    } else if (supersetMode === exId) {
      setSupersetMode(null);
    } else {
      updateActiveDay(prev => prev.map(ex => {
        if (ex.id === supersetMode) return { ...ex, supersetWithId: exId };
        if (ex.id === exId)         return { ...ex, supersetWithId: supersetMode };
        return ex;
      }));
      setSupersetMode(null);
    }
  };

  const handleDragStart = (e: React.DragEvent, id: string) => {
    const tag = (e.target as HTMLElement).tagName.toLowerCase();
    if (tag === 'input' || tag === 'button' || tag === 'textarea') { e.preventDefault(); return; }
    setDraggedId(id);
  };
  const handleDragEnd  = () => { setDraggedId(null); setDragOverId(null); };
  const handleDragOver = (e: React.DragEvent, id: string) => { e.preventDefault(); if (id !== draggedId) setDragOverId(id); };
  const handleDrop     = (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    if (!draggedId || draggedId === targetId) { setDraggedId(null); setDragOverId(null); return; }
    updateActiveDay(prev => {
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

  // ── Add / remove exercise ─────────────────────────────────────────────────

  const handleAddExercise = (ex: Exercise) => {
    const alreadyAdded = exercises.some(e => e.exercise.id === ex.id);
    if (alreadyAdded) {
      const te = exercises.find(e => e.exercise.id === ex.id);
      if (te) removeExercise(te.id);
      return;
    }
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
    updateActiveDay(prev => [...prev, newEx]);
  };

  const toggleUnit = (exId: string) => {
    updateActiveDay(prev => prev.map(ex => {
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
    updateActiveDay(prev => prev.map(ex => ex.id === exId ? { ...ex, rest: value } : ex));
  };

  const updateNotes = (exId: string, value: string) => {
    updateActiveDay(prev => prev.map(ex => ex.id === exId ? { ...ex, notes: value } : ex));
  };

  const handleAddCustomExercise = async () => {
    if (!customName.trim()) return;
    const { data: inserted } = await getSupabase().from('custom_exercises').insert({
      name: customName.trim(),
      muscle_group: customMuscle,
      equipment: customEquip || 'Bodyweight',
      type: customType,
    }).select('id').single();
    const exId = inserted?.id ? `custom_${inserted.id}` : `custom_${uid()}`;
    const ex: Exercise = {
      id: exId,
      name: customName.trim(),
      muscleGroup: customMuscle,
      equipment: customEquip || 'Bodyweight',
      type: customType,
    };
    setCustomExercises(prev => [ex, ...prev]);
    handleAddExercise(ex);
    setCustomName('');
    setShowCustomForm(false);
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
    updateActiveDay(prev => prev.map(ex => {
      if (ex.id !== exId) return ex;
      if (scope === 'template') {
        return { ...ex, exercise: newExercise, sets: ex.sets.map(_ => defaultSet(newExercise)) };
      } else {
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
      .update({ name: name.trim(), description: description.trim() || null, exercises: { frequencyPerWeek, days }, tags })
      .eq('id', templateId);
    setSaving(false);
    if (error) { alert('Could not save: ' + error.message); return; }
    isDirtyRef.current = false;
    router.push('/plans/library');
  };

  // ── Drop sets ─────────────────────────────────────────────────────────────

  const addDropSet = (exId: string, setIdx: number) => {
    updateActiveDay(prev => prev.map(ex => {
      if (ex.id !== exId) return ex;
      const weekSets = getWeekSets(ex, activeWeek);
      const s = weekSets[setIdx];
      const newDrop: DropSet = { id: `drop_${Date.now()}_${Math.random().toString(36).slice(2)}`, weight: s.weight, reps: s.reps, unit: ex.unit };
      const newSets = weekSets.map((ws, i) => i === setIdx ? { ...ws, dropSets: [...(ws.dropSets ?? []), newDrop] } : ws);
      return setWeekSets(ex, activeWeek, newSets);
    }));
  };

  const updateDropSet = (exId: string, setIdx: number, dropIdx: number, field: keyof DropSet, value: number | string) => {
    updateActiveDay(prev => prev.map(ex => {
      if (ex.id !== exId) return ex;
      const weekSets = getWeekSets(ex, activeWeek);
      const newSets = weekSets.map((ws, i) => {
        if (i !== setIdx) return ws;
        const drops = (ws.dropSets ?? []).map((d, di) => di === dropIdx ? { ...d, [field]: value } : d);
        return { ...ws, dropSets: drops };
      });
      return setWeekSets(ex, activeWeek, newSets);
    }));
  };

  const removeDropSet = (exId: string, setIdx: number, dropIdx: number) => {
    updateActiveDay(prev => prev.map(ex => {
      if (ex.id !== exId) return ex;
      const weekSets = getWeekSets(ex, activeWeek);
      const newSets = weekSets.map((ws, i) => i === setIdx ? { ...ws, dropSets: (ws.dropSets ?? []).filter((_, di) => di !== dropIdx) } : ws);
      return setWeekSets(ex, activeWeek, newSets);
    }));
  };

  // ── Render helpers ────────────────────────────────────────────────────────

  const renderSetRow = (ex: TemplateExercise, set: WorkoutSet, setIdx: number, totalSets: number) => {
    const exType = getWeekExercise(ex, activeWeek).type;
    const unit = ex.unit ?? preferredUnit;
    return (
      <div key={setIdx} style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '6px 0', borderBottom: setIdx < totalSets - 1 ? '1px solid var(--card-alt)' : 'none' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ color: 'var(--text-dim)', fontSize: 12, width: 24, flexShrink: 0 }}>{setIdx + 1}</span>

          {exType === 'weighted' && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <input type="number" value={set.reps ?? ''} onChange={e => updateSet(ex.id, setIdx, 'reps', Number(e.target.value))} onFocus={e => e.target.select()} style={inputStyle} placeholder="0" />
                <span style={{ color: 'var(--text-dim)', fontSize: 12 }}>reps</span>
              </div>
              <span style={{ color: 'var(--text-dim)', fontSize: 12 }}>@</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <input type="number" value={set.weight ?? ''} onChange={e => updateSet(ex.id, setIdx, 'weight', Number(e.target.value))} onFocus={e => e.target.select()} style={inputStyle} placeholder="0" />
                <span style={{ color: 'var(--text-dim)', fontSize: 12 }}>{unit}</span>
              </div>
            </>
          )}

          {(exType === 'duration' || exType === 'cardio') && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <input type="number" value={set.seconds ?? ''} onChange={e => updateSet(ex.id, setIdx, 'seconds', Number(e.target.value))} onFocus={e => e.target.select()} style={inputStyle} placeholder="0" />
              <span style={{ color: 'var(--text-dim)', fontSize: 12 }}>sec</span>
            </div>
          )}
        </div>

        {exType === 'weighted' && (set.dropSets ?? []).map((drop, di) => (
          <div key={drop.id} style={{ display: 'flex', alignItems: 'center', gap: 8, paddingLeft: 28 }}>
            <span style={{ width: 20, fontSize: 12, color: TEAL, fontWeight: 700, textAlign: 'center', flexShrink: 0 }}>↓</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <input type="number" value={drop.reps ?? ''} onChange={e => updateDropSet(ex.id, setIdx, di, 'reps', Number(e.target.value))} onFocus={e => e.target.select()} style={inputStyle} placeholder="0" />
              <span style={{ color: 'var(--text-dim)', fontSize: 12 }}>reps</span>
            </div>
            <span style={{ color: 'var(--text-dim)', fontSize: 12 }}>@</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <input type="number" value={drop.weight ?? ''} onChange={e => updateDropSet(ex.id, setIdx, di, 'weight', Number(e.target.value))} onFocus={e => e.target.select()} style={inputStyle} placeholder="0" />
              <span style={{ color: 'var(--text-dim)', fontSize: 12 }}>{drop.unit ?? unit}</span>
            </div>
            <button onClick={() => removeDropSet(ex.id, setIdx, di)} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', fontSize: 16, padding: '0 4px', lineHeight: 1 }}>✕</button>
          </div>
        ))}

        {exType === 'weighted' && (
          <button onClick={() => addDropSet(ex.id, setIdx)} style={{ alignSelf: 'flex-start', marginLeft: 28, background: 'none', border: '1px solid var(--border)', borderRadius: 6, padding: '2px 10px', color: TEAL, fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>↓ Drop Set</button>
        )}
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

  const subEx = subTarget ? exercises.find(e => e.id === subTarget.exId) : null;
  const subMuscle = subEx ? getWeekExercise(subEx, subTarget?.scope === 'week' ? activeWeek : 1).muscleGroup : '';
  const subCandidates = EXERCISES.filter(e =>
    e.muscleGroup === subMuscle &&
    e.id !== (subEx ? getWeekExercise(subEx, subTarget?.scope === 'week' ? activeWeek : 1).id : '') &&
    (subSearch === '' || e.name.toLowerCase().includes(subSearch.toLowerCase()))
  );

  const filteredExercises = [...customExercises, ...EXERCISES].filter(ex => {
    const section = MUSCLE_GROUP_SECTIONS.find(s => s.label === muscleFilter);
    const matchesMuscle = muscleFilter === 'All'
      ? true
      : section
        ? section.members.includes(ex.muscleGroup)
        : ex.muscleGroup === muscleFilter;
    const matchesSearch = ex.name.toLowerCase().includes(search.toLowerCase());
    return matchesMuscle && matchesSearch;
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, background: 'var(--bg)', color: 'var(--text)', fontFamily: 'sans-serif', overflow: 'hidden' }}>

      {/* Sub-header */}
      <div style={{ borderBottom: '1px solid var(--border-subtle)', padding: '12px 32px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
        <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>
          <a href="/plans/library" style={{ color: 'var(--text-muted)', textDecoration: 'none' }}>Library</a>
          {' / Edit'}
        </span>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <button
            onClick={() => guardedNavigate('/plans/library')}
            style={{ background: 'var(--btn-red-bg)', border: '1px solid var(--btn-red-border)', color: 'var(--btn-red-text)', borderRadius: 10, padding: '8px 16px', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}
          >
            Cancel
          </button>
          <button
            onClick={() => guardedNavigate(`/plans/new?template=${templateId}`)}
            style={{ background: 'var(--btn-purple-bg)', color: 'var(--btn-purple-text)', border: '1px solid var(--btn-purple-border)', borderRadius: 10, padding: '8px 18px', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}
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

      {/* Pinned: Template name + description */}
      <div style={{ borderBottom: '1px solid var(--border-subtle)', padding: '20px 32px 16px', flexShrink: 0 }}>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="Template name" style={{ background: 'transparent', border: 'none', outline: 'none', color: 'var(--text)', fontSize: 28, fontWeight: 800, width: '100%', padding: 0, marginBottom: 6 }} />
        <input value={description} onChange={e => setDescription(e.target.value)} placeholder="Description (optional) — e.g. 4-week hypertrophy block for intermediate lifters" style={{ background: 'transparent', border: 'none', outline: 'none', color: 'var(--text-muted)', fontSize: 14, width: '100%', padding: 0, marginBottom: 14 }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Times / Week</span>
          <button onClick={() => setFrequencyPerWeek(v => Math.max(1, v - 1))} style={{ width: 32, height: 32, borderRadius: 8, border: '1px solid var(--border-strong)', background: 'var(--input-bg)', color: 'var(--text)', cursor: 'pointer', fontSize: 18, fontWeight: 700, lineHeight: 1 }}>−</button>
          <span style={{ width: 28, textAlign: 'center', fontWeight: 700, fontSize: 18, color: TEAL }}>{frequencyPerWeek}</span>
          <button onClick={() => setFrequencyPerWeek(v => Math.min(7, v + 1))} style={{ width: 32, height: 32, borderRadius: 8, border: '1px solid var(--border-strong)', background: 'var(--input-bg)', color: 'var(--text)', cursor: 'pointer', fontSize: 18, fontWeight: 700, lineHeight: 1 }}>+</button>
        </div>
      </div>

      {/* Two-column body */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden', minHeight: 0 }}>

        {/* Left: Exercise Library — collapsible */}
        <div style={{ width: sidebarOpen ? 280 : 44, flexShrink: 0, borderRight: '1px solid var(--input-bg)', display: 'flex', flexDirection: 'column', overflow: 'hidden', transition: 'width 0.2s ease', background: 'var(--bg)' }}>
          <div style={{ padding: '12px 10px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            <button
              onClick={() => setSidebarOpen(v => !v)}
              title={sidebarOpen ? 'Collapse library' : 'Expand library'}
              style={{ background: 'var(--card-alt)', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 8px', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 14, lineHeight: 1, flexShrink: 0 }}
            >
              {sidebarOpen ? '◀' : '▶'}
            </button>
            {sidebarOpen && <p style={{ fontWeight: 700, fontSize: 14, margin: 0, color: 'var(--text)', whiteSpace: 'nowrap' }}>Exercise Library</p>}
          </div>

          {sidebarOpen && !showCustomForm && (
            <>
              <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border-subtle)', flexShrink: 0 }}>
                <input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search exercises…"
                  style={{ width: '100%', background: 'var(--card-alt)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px', color: 'var(--text)', fontSize: 13, outline: 'none', boxSizing: 'border-box', marginBottom: 8 }}
                />
                <div ref={muscleDropdownRef} style={{ position: 'relative' }}>
                  <button
                    onClick={() => setMuscleDropdownOpen(v => !v)}
                    style={{ width: '100%', background: 'var(--card-alt)', border: '1px solid var(--border)', borderRadius: 8, padding: '7px 12px', color: 'var(--text)', fontSize: 13, outline: 'none', boxSizing: 'border-box', cursor: 'pointer', textAlign: 'left', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                  >
                    <span>{muscleFilter === 'All' ? 'All muscle groups' : muscleFilter}</span>
                    <span style={{ opacity: 0.5, fontSize: 10 }}>{muscleDropdownOpen ? '▲' : '▼'}</span>
                  </button>
                  {muscleDropdownOpen && (
                    <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, zIndex: 200, maxHeight: 280, overflowY: 'auto', boxShadow: '0 8px 24px rgba(0,0,0,0.3)' }}>
                      <button onClick={() => { setMuscleFilter('All'); setMuscleDropdownOpen(false); }} style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 12px', background: muscleFilter === 'All' ? 'var(--badge-teal-bg)' : 'transparent', color: muscleFilter === 'All' ? 'var(--badge-teal-text)' : 'var(--text)', fontSize: 13, fontWeight: 600, cursor: 'pointer', border: 'none', borderBottom: '1px solid var(--border-subtle)' }}>All muscle groups</button>
                      {MUSCLE_GROUP_SECTIONS.map(section => (
                        <Fragment key={section.label}>
                          <button onClick={() => { setMuscleFilter(section.label); setMuscleDropdownOpen(false); }} style={{ display: 'block', width: '100%', textAlign: 'left', padding: '7px 12px 4px', background: muscleFilter === section.label ? 'var(--badge-teal-bg)' : 'transparent', color: muscleFilter === section.label ? 'var(--badge-teal-text)' : 'var(--text-muted)', fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', cursor: 'pointer', border: 'none' }}>{section.label}</button>
                          {section.members.map(mg => (
                            <button key={mg} onClick={() => { setMuscleFilter(mg); setMuscleDropdownOpen(false); }} style={{ display: 'block', width: '100%', textAlign: 'left', padding: '6px 12px 6px 24px', background: muscleFilter === mg ? 'var(--badge-teal-bg)' : 'transparent', color: muscleFilter === mg ? 'var(--badge-teal-text)' : 'var(--text)', fontSize: 13, cursor: 'pointer', border: 'none' }}>{mg}</button>
                          ))}
                        </Fragment>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div style={{ flex: 1, overflowY: 'auto', padding: '8px' }}>
                {filteredExercises.map(ex => {
                  const alreadyAdded = exercises.some(e => e.exercise.id === ex.id);
                  return (
                    <button
                      key={ex.id}
                      onClick={() => handleAddExercise(ex)}
                      style={{ display: 'block', width: '100%', textAlign: 'left', background: alreadyAdded ? 'rgba(95,207,191,0.08)' : 'transparent', border: `1px solid ${alreadyAdded ? `${TEAL}40` : 'transparent'}`, borderRadius: 8, padding: '9px 12px', marginBottom: 2, cursor: 'pointer', transition: 'background 0.15s' }}
                      onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = alreadyAdded ? 'rgba(239,68,68,0.1)' : 'var(--card-alt)'; }}
                      onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = alreadyAdded ? 'rgba(95,207,191,0.08)' : 'transparent'; }}
                      title={alreadyAdded ? 'Click to remove from this day' : 'Click to add to this day'}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: 13, fontWeight: 600, color: alreadyAdded ? TEAL : 'var(--text)' }}>{ex.name}</span>
                        {alreadyAdded && <span style={{ fontSize: 11, color: TEAL }}>✓ added</span>}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>{ex.muscleGroup} · {ex.equipment}</div>
                    </button>
                  );
                })}
                {filteredExercises.length === 0 && (
                  <p style={{ color: 'var(--text-dim)', fontSize: 13, textAlign: 'center', padding: 20 }}>No exercises found</p>
                )}
              </div>

              <div style={{ padding: '8px 12px', borderTop: '1px solid var(--border-subtle)', flexShrink: 0 }}>
                <button
                  onClick={() => { setShowCustomForm(true); setCustomName(search); }}
                  style={{ width: '100%', padding: '10px 14px', background: 'rgba(95,207,191,0.08)', border: `1px dashed ${TEAL}`, borderRadius: 10, color: TEAL, fontSize: 13, fontWeight: 600, cursor: 'pointer', textAlign: 'left' }}
                >
                  + Create custom exercise{search ? ` "${search}"` : ''}
                </button>
              </div>
            </>
          )}

          {sidebarOpen && showCustomForm && (
            <div style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>
              <button onClick={() => setShowCustomForm(false)} style={{ background: 'none', border: 'none', color: TEAL, fontSize: 13, fontWeight: 600, cursor: 'pointer', padding: '0 0 12px 0', display: 'block' }}>‹ Back to search</button>
              <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 16 }}>Add an exercise that isn't in the standard library.</p>

              <label style={{ display: 'block', color: 'var(--text-muted)', fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Exercise Name</label>
              <input value={customName} onChange={e => setCustomName(e.target.value)} placeholder="e.g. Bulgarian Split Squat" autoFocus style={{ width: '100%', background: 'var(--card-alt)', border: `1px solid ${TEAL}`, borderRadius: 10, padding: '10px 14px', color: 'var(--text)', fontSize: 14, outline: 'none', boxSizing: 'border-box', marginBottom: 14 }} onKeyDown={e => { if (e.key === 'Enter') handleAddCustomExercise(); }} />

              <label style={{ display: 'block', color: 'var(--text-muted)', fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Muscle Group</label>
              <div style={{ marginBottom: 14 }}>
                {[
                  { label: 'Upper', members: ['Chest','Shoulders','Back','Biceps','Triceps','Forearms'] },
                  { label: 'Lower', members: ['Quadriceps','Hamstrings','Glutes','Calves','Adductors'] },
                  { label: 'Core', members: ['Core'] },
                  { label: 'Activity', members: ['Cardio','Plyometrics','Balance','Isometrics','Pilates','Yoga'] },
                  { label: 'Physio', members: ['Hip Flexors','Rotator Cuff','Lumbar','Cervical','Ankle & Foot'] },
                ].map(sec => (
                  <div key={sec.label} style={{ marginBottom: 8 }}>
                    <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: 4 }}>{sec.label}</span>
                    <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                      {sec.members.map(mg => (
                        <button key={mg} onClick={() => setCustomMuscle(mg)} style={{ padding: '4px 10px', borderRadius: 16, fontSize: 11, fontWeight: 600, border: 'none', cursor: 'pointer', background: customMuscle === mg ? TEAL : 'var(--input-bg)', color: customMuscle === mg ? '#0f1117' : 'var(--text-muted)' }}>{mg}</button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              <label style={{ display: 'block', color: 'var(--text-muted)', fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Equipment</label>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
                {['Barbell','Dumbbell','Kettlebell','Cable','Machine','Bodyweight','Other'].map(eq => (
                  <button key={eq} onClick={() => setCustomEquip(eq)} style={{ padding: '4px 12px', borderRadius: 16, fontSize: 12, fontWeight: 600, border: 'none', cursor: 'pointer', background: customEquip === eq ? TEAL : 'var(--input-bg)', color: customEquip === eq ? '#0f1117' : 'var(--text-muted)' }}>{eq}</button>
                ))}
              </div>

              <label style={{ display: 'block', color: 'var(--text-muted)', fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Tracking Type</label>
              <div style={{ display: 'flex', gap: 6, marginBottom: 20 }}>
                {([['weighted','Weight + Reps'],['duration','Duration'],['cardio','Cardio']] as const).map(([val, label]) => (
                  <button key={val} onClick={() => setCustomType(val)} style={{ padding: '6px 14px', borderRadius: 16, fontSize: 12, fontWeight: 600, border: 'none', cursor: 'pointer', background: customType === val ? TEAL : 'var(--input-bg)', color: customType === val ? '#0f1117' : 'var(--text-muted)' }}>{label}</button>
                ))}
              </div>

              <button onClick={handleAddCustomExercise} disabled={!customName.trim()} style={{ width: '100%', background: customName.trim() ? TEAL : 'var(--border)', color: customName.trim() ? '#0f1117' : 'var(--text-dim)', border: 'none', borderRadius: 10, padding: '12px', fontWeight: 700, fontSize: 15, cursor: customName.trim() ? 'pointer' : 'not-allowed' }}>
                Add {customName.trim() || 'exercise'} to plan
              </button>
            </div>
          )}
        </div>

        {/* Right: Plan builder */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>

          {/* Week tabs */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '10px 20px', borderBottom: '1px solid var(--border-subtle)', flexShrink: 0, flexWrap: 'wrap' }}>
            {Array.from({ length: totalWeeks }, (_, i) => i + 1).map(w => (
              <button key={w} onClick={() => setActiveWeek(w)} style={{ padding: '6px 16px', borderRadius: 20, fontWeight: 700, fontSize: 13, border: 'none', cursor: 'pointer', background: activeWeek === w ? TEAL : 'var(--input-bg)', color: activeWeek === w ? '#0f1117' : 'var(--text-muted)' }}>Week {w}</button>
            ))}
            <button onClick={handleAddWeek} style={{ padding: '6px 14px', borderRadius: 20, fontWeight: 700, fontSize: 13, border: '1px dashed var(--btn-teal-border)', background: 'transparent', color: 'var(--btn-teal-text)', cursor: 'pointer' }}>+ Add Week</button>
            {totalWeeks > 1 && (
              <button onClick={handleRemoveLastWeek} style={{ padding: '6px 14px', borderRadius: 20, fontWeight: 700, fontSize: 13, border: '1px solid var(--btn-red-border)', background: 'var(--btn-red-bg)', color: 'var(--btn-red-text)', cursor: 'pointer' }}>Remove Week {totalWeeks}</button>
            )}
          </div>

          {/* Day tabs */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '10px 20px 0', borderBottom: '1px solid var(--border-subtle)', flexShrink: 0, flexWrap: 'wrap' }}>
            {days.map(day => (
              <div key={day.id} style={{ display: 'flex', alignItems: 'center', position: 'relative' }}>
                {editingDayId === day.id ? (
                  <input
                    autoFocus
                    value={editingDayLabel}
                    onChange={e => setEditingDayLabel(e.target.value)}
                    onBlur={commitRenameDay}
                    onKeyDown={e => { if (e.key === 'Enter') commitRenameDay(); if (e.key === 'Escape') setEditingDayId(null); }}
                    style={{ width: 90, background: 'var(--input-bg)', border: `1px solid ${TEAL}`, borderRadius: 8, padding: '5px 10px', color: 'var(--text)', fontSize: 13, outline: 'none' }}
                  />
                ) : (
                  <button
                    onClick={() => setActiveDayId(day.id)}
                    onDoubleClick={() => startRenameDay(day)}
                    title="Double-click to rename"
                    style={{ background: activeDayId === day.id ? TEAL : 'var(--card-alt)', color: activeDayId === day.id ? '#0f1117' : 'var(--text-muted)', border: `1px solid ${activeDayId === day.id ? TEAL : 'var(--border-strong)'}`, borderRadius: 8, padding: '5px 12px', fontSize: 13, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}
                  >{day.label}</button>
                )}
                {days.length > 1 && (
                  <button onClick={() => removeDay(day.id)} title="Remove this day" style={{ marginLeft: 2, background: 'transparent', border: 'none', color: 'var(--text-faint)', cursor: 'pointer', fontSize: 13, padding: '2px 4px', lineHeight: 1 }}>×</button>
                )}
              </div>
            ))}
            {days.length < 7 && (
              <button onClick={addDay} style={{ background: 'transparent', border: '1px dashed var(--border-strong)', borderRadius: 8, padding: '5px 12px', color: 'var(--text-muted)', fontSize: 13, cursor: 'pointer' }}>+ Add Day</button>
            )}
          </div>

          {/* Scrollable content */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '24px 32px 80px', minWidth: 0 }}>

            {activeWeek > 1 && (
              <div style={{ marginBottom: 16 }}>
                <span style={{ color: 'var(--text-dim)', fontWeight: 400, fontSize: 13 }}>Week {activeWeek} — Inherited from Week 1 unless edited below</span>
              </div>
            )}

            {/* Superset mode banner */}
            {supersetMode && (
              <div style={{ background: 'var(--badge-purple-bg)', border: '1px solid var(--btn-purple-border)', borderRadius: 10, padding: '10px 16px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 13, color: 'var(--badge-purple-text)', fontWeight: 600 }}>Superset mode — click &ldquo;Pair Here&rdquo; on another exercise to link them</span>
                <button onClick={() => setSupersetMode(null)} style={{ marginLeft: 'auto', background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 13 }}>✕ Cancel</button>
              </div>
            )}

            {/* Exercise cards */}
            {exercises.length === 0 ? (
              <div onClick={() => { if (!sidebarOpen) setSidebarOpen(true); }} style={{ background: 'var(--card)', border: '1px dashed var(--border-strong)', borderRadius: 16, padding: 48, textAlign: 'center', cursor: sidebarOpen ? 'default' : 'pointer' }}>
                <p style={{ color: 'var(--text-dim)', marginBottom: 0 }}>
                  {sidebarOpen ? `Click exercises on the left to add them to ${activeDay?.label ?? 'this day'}` : 'Open the exercise library (▶ on the left) or click here to add exercises'}
                </p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {exercises.map((ex, exIdx) => {
                  const prevEx        = exIdx > 0 ? exercises[exIdx - 1] : null;
                  const nextEx        = exIdx < exercises.length - 1 ? exercises[exIdx + 1] : null;
                  const weekExercise  = getWeekExercise(ex, activeWeek);
                  const weekSets      = getWeekSets(ex, activeWeek);
                  const isOverridden  = activeWeek > 1 && ex.weeks?.find(w => w.week === activeWeek)?.exerciseOverride;
                  const isDragging    = draggedId === ex.id;
                  const isDragOver    = dragOverId === ex.id;
                  const isCollapsed   = collapsedIds.has(ex.id);
                  const isSuperset    = !!ex.supersetWithId;
                  const isSupersetFirst = supersetMode === ex.id;
                  const canPair       = supersetMode !== null && supersetMode !== ex.id && !ex.supersetWithId;
                  const showConnector = !!(nextEx && ex.supersetWithId === nextEx.id && nextEx.supersetWithId === ex.id);
                  const afterConnector = !!(prevEx && prevEx.supersetWithId === ex.id && ex.supersetWithId === prevEx.id);
                  const topR    = afterConnector ? 0 : 14;
                  const bottomR = showConnector ? 0 : 14;
                  const firstSet = weekSets[0];
                  const collapseSummary = weekSets.length > 0
                    ? `${weekSets.length} set${weekSets.length !== 1 ? 's' : ''}`
                      + (weekExercise.type === 'weighted' && firstSet?.reps ? ` · ${firstSet.reps} reps @ ${firstSet.weight ?? 0} ${ex.unit ?? preferredUnit}` : '')
                      + (ex.rest ? ` · ${ex.rest}s rest` : '')
                    : 'No sets';
                  return (
                    <Fragment key={ex.id}>
                      <div
                        draggable
                        onDragStart={e => handleDragStart(e, ex.id)}
                        onDragEnd={handleDragEnd}
                        onDragOver={e => handleDragOver(e, ex.id)}
                        onDrop={e => handleDrop(e, ex.id)}
                        style={{
                          background: isDragOver ? 'rgba(95,207,191,0.06)' : 'var(--card)',
                          border: `1px solid ${isDragOver ? `${TEAL}80` : isSuperset ? `${PURPLE}60` : isSupersetFirst ? `${PURPLE}99` : `${PURPLE}30`}`,
                          borderRadius: `${topR}px ${topR}px ${bottomR}px ${bottomR}px`,
                          padding: '18px 20px',
                          opacity: isDragging ? 0.4 : 1,
                          marginBottom: showConnector ? 0 : 12,
                          cursor: 'grab',
                          transition: 'border-color 0.15s, opacity 0.15s',
                        }}
                      >
                        {/* Card header — left side clicks to collapse */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: isCollapsed ? 0 : 14, flexWrap: 'wrap' }}>
                          <div onClick={() => toggleCollapse(ex.id)} style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0, cursor: 'pointer' }}>
                            <span style={{ color: 'var(--text-faint)', fontSize: 16, userSelect: 'none', flexShrink: 0 }}>⠿</span>
                            <div>
                              <span style={{ fontWeight: 700, fontSize: 15 }}>{weekExercise.name}</span>
                              {isOverridden && <span style={{ background: 'var(--badge-purple-bg)', color: 'var(--badge-purple-text)', fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 999, marginLeft: 8 }}>Week {activeWeek} sub</span>}
                              <span style={{ marginLeft: 10, fontSize: 12, color: 'var(--text-dim)' }}>{weekExercise.muscleGroup} · {weekExercise.equipment}</span>
                              {mediaMap[weekExercise.name] ? (
                                <button
                                  onClick={e => { e.stopPropagation(); setDemoPreview({ name: weekExercise.name, ...mediaMap[weekExercise.name] }); }}
                                  style={{ marginLeft: 10, fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 999, background: 'var(--badge-teal-bg)', color: 'var(--badge-teal-text)', border: 'none', cursor: 'pointer', verticalAlign: 'middle' }}
                                  title="Click to preview demo"
                                >
                                  {mediaMap[weekExercise.name].type === 'link' ? '🔗 Link' : mediaMap[weekExercise.name].type === 'video' ? '📹 Video' : '📷 Photo'}
                                </button>
                              ) : (
                                <button
                                  onClick={e => { e.stopPropagation(); setAddVideoTarget(weekExercise.name); setVideoUrl(''); }}
                                  style={{ marginLeft: 10, fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 999, background: 'var(--card-alt)', color: 'var(--text-muted)', border: '1px dashed var(--border-strong)', cursor: 'pointer', verticalAlign: 'middle' }}
                                  title="Add a video demo link"
                                >
                                  + Add Video
                                </button>
                              )}
                            </div>
                            {isSuperset && (
                              <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 999, background: 'var(--badge-purple-bg)', color: 'var(--badge-purple-text)', flexShrink: 0 }}>SS</span>
                            )}
                          </div>
                          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
                            {isSuperset ? (
                              <button onClick={e => { e.stopPropagation(); removeSuperset(ex.id); }} style={{ background: 'var(--btn-purple-bg)', border: '1px solid var(--btn-purple-border)', color: 'var(--btn-purple-text)', borderRadius: 8, padding: '4px 10px', fontSize: 12, cursor: 'pointer', fontWeight: 700 }}>Remove SS</button>
                            ) : isSupersetFirst ? (
                              <button onClick={e => { e.stopPropagation(); setSupersetMode(null); }} style={{ background: 'var(--badge-yellow-bg)', border: '1px solid var(--btn-teal-border)', color: 'var(--badge-yellow-text)', borderRadius: 8, padding: '4px 10px', fontSize: 12, cursor: 'pointer', fontWeight: 700 }}>Cancel</button>
                            ) : canPair ? (
                              <button onClick={e => { e.stopPropagation(); handleSupersetClick(ex.id); }} style={{ background: 'var(--btn-purple-bg)', border: '1px solid var(--btn-purple-border)', color: 'var(--btn-purple-text)', borderRadius: 8, padding: '4px 10px', fontSize: 12, cursor: 'pointer', fontWeight: 700 }}>Pair Here</button>
                            ) : (
                              <button onClick={e => { e.stopPropagation(); handleSupersetClick(ex.id); }} style={{ background: 'var(--btn-purple-bg)', border: '1px solid var(--btn-purple-border)', color: 'var(--btn-purple-text)', borderRadius: 8, padding: '4px 10px', fontSize: 12, cursor: 'pointer', fontWeight: 600 }}>Superset</button>
                            )}
                            {weekExercise.type === 'weighted' && (
                              <button onClick={e => { e.stopPropagation(); toggleUnit(ex.id); }} style={{ background: 'var(--card-alt)', border: '1px solid var(--border-strong)', color: TEAL, borderRadius: 8, padding: '4px 10px', fontSize: 11, cursor: 'pointer', fontWeight: 700 }} title="Toggle weight unit">
                                {ex.unit ?? preferredUnit} ⇄ {(ex.unit ?? preferredUnit) === 'lbs' ? 'kg' : 'lbs'}
                              </button>
                            )}
                            <button onClick={e => { e.stopPropagation(); if (confirm(`Remove ${weekExercise.name}?`)) removeExercise(ex.id); }} style={{ background: 'var(--btn-red-bg)', border: '1px solid var(--btn-red-border)', borderRadius: 8, padding: '4px 12px', color: 'var(--btn-red-text)', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>Remove</button>
                          </div>
                        </div>

                        {isCollapsed && <p style={{ margin: 0, color: 'var(--text-dim)', fontSize: 13 }}>{collapseSummary}</p>}

                        {!isCollapsed && (
                          <div style={{ padding: '4px 0' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                              <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600 }}>SETS</span>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <button onClick={() => removeSet(ex.id, weekSets.length - 1)} disabled={weekSets.length <= 1} style={{ width: 28, height: 28, borderRadius: 6, border: '1px solid var(--border-strong)', background: 'var(--input-bg)', color: 'var(--text)', cursor: weekSets.length <= 1 ? 'not-allowed' : 'pointer', fontSize: 18, fontWeight: 700, lineHeight: 1, opacity: weekSets.length <= 1 ? 0.3 : 1 }}>−</button>
                                <span style={{ width: 28, textAlign: 'center', fontWeight: 700, fontSize: 16, color: TEAL }}>{weekSets.length}</span>
                                <button onClick={() => addSet(ex.id)} style={{ width: 28, height: 28, borderRadius: 6, border: '1px solid var(--border-strong)', background: 'var(--input-bg)', color: 'var(--text)', cursor: 'pointer', fontSize: 18, fontWeight: 700, lineHeight: 1 }}>+</button>
                              </div>
                            </div>
                            {weekSets.map((set, setIdx) => renderSetRow(ex, set, setIdx, weekSets.length))}
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border-subtle)' }}>
                              <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>Rest between sets</span>
                              <input type="number" min={0} value={Math.floor((ex.rest ?? lastRestRef.current) / 60)} onChange={e => updateExerciseRest(ex.id, Number(e.target.value) * 60 + ((ex.rest ?? lastRestRef.current) % 60))} onFocus={e => e.target.select()} style={{ width: 48, background: 'var(--card-alt)', border: '1px solid var(--border)', borderRadius: 6, padding: '5px 8px', color: 'var(--text)', fontSize: 13, outline: 'none', textAlign: 'center' }} />
                              <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>m</span>
                              <input type="number" min={0} max={59} value={(ex.rest ?? lastRestRef.current) % 60} onChange={e => updateExerciseRest(ex.id, Math.floor((ex.rest ?? lastRestRef.current) / 60) * 60 + Math.min(59, Number(e.target.value)))} onFocus={e => e.target.select()} style={{ width: 48, background: 'var(--card-alt)', border: '1px solid var(--border)', borderRadius: 6, padding: '5px 8px', color: 'var(--text)', fontSize: 13, outline: 'none', textAlign: 'center' }} />
                              <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>s</span>
                            </div>
                            <div style={{ marginTop: 8 }}>
                              <input
                                value={ex.notes ?? ''}
                                onChange={e => updateNotes(ex.id, e.target.value)}
                                placeholder="Practitioner notes (e.g. focus on form, keep elbows tucked)…"
                                style={{ width: '100%', background: 'var(--card-alt)', border: '1px solid var(--border-strong)', borderRadius: 8, padding: '8px 12px', color: 'var(--text)', fontSize: 13, outline: 'none', boxSizing: 'border-box' }}
                              />
                            </div>
                          </div>
                        )}
                      </div>
                      {showConnector && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '5px 20px', border: '1px solid var(--btn-purple-border)', borderTop: 'none', borderBottom: 'none', background: 'var(--badge-purple-bg)', marginBottom: 0 }}>
                          <div style={{ flex: 1, height: 1, background: 'var(--btn-purple-border)' }} />
                          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--badge-purple-text)', letterSpacing: '0.05em' }}>⚡ SUPERSET</span>
                          <div style={{ flex: 1, height: 1, background: 'var(--btn-purple-border)' }} />
                        </div>
                      )}
                    </Fragment>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

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
            <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
              {(['template', 'week'] as const).map(scope => (
                <button key={scope} onClick={() => setSubTarget(prev => prev ? { ...prev, scope } : prev)} style={{ padding: '7px 16px', borderRadius: 20, fontWeight: 700, fontSize: 12, border: 'none', cursor: 'pointer', background: subTarget.scope === scope ? TEAL : 'var(--input-bg)', color: subTarget.scope === scope ? '#0f1117' : 'var(--text-muted)' }}>{scope === 'template' ? 'All weeks (permanent)' : `Week ${activeWeek} only`}</button>
              ))}
            </div>
            <input value={subSearch} onChange={e => setSubSearch(e.target.value)} placeholder={`Search ${subMuscle} alternatives…`} autoFocus style={searchInputStyle} />
            <p style={{ color: 'var(--text-dim)', fontSize: 12, marginBottom: 10 }}>Showing {subMuscle} exercises</p>
            <div style={{ maxHeight: 360, overflowY: 'auto' }}>
              {subCandidates.slice(0, 40).map(ex => (
                <button key={ex.id} onClick={() => handleSubstitute(ex)} style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '11px 14px', background: 'none', border: 'none', borderBottom: '1px solid var(--border-subtle)', cursor: 'pointer', textAlign: 'left' }}>
                  <span><span style={{ color: 'var(--text)', fontWeight: 600, fontSize: 14 }}>{ex.name}</span><span style={{ color: 'var(--text-dim)', fontSize: 12, marginLeft: 8 }}>{ex.equipment}</span></span>
                  <span style={{ color: TEAL, fontSize: 13, fontWeight: 700 }}>Use this →</span>
                </button>
              ))}
              {subCandidates.length === 0 && <p style={{ color: 'var(--text-dim)', textAlign: 'center', padding: 24 }}>No alternatives found for {subMuscle}</p>}
            </div>
          </div>
        </div>
      )}

      {/* Demo preview modal */}
      {demoPreview && (
        <div onClick={() => setDemoPreview(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.82)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 300, padding: 24 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 20, overflow: 'hidden', width: '100%', maxWidth: 560 }}>
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
                <a href={demoPreview.urlLink} target="_blank" rel="noopener noreferrer" style={{ background: TEAL, color: '#0f1117', borderRadius: 10, padding: '10px 24px', fontWeight: 700, fontSize: 14, textDecoration: 'none', display: 'inline-block' }}>Open video ↗</a>
              </div>
            ) : null}
          </div>
        </div>
      )}

      {/* Add video link modal */}
      {addVideoTarget && (
        <div onClick={() => setAddVideoTarget(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 300, padding: 24 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 20, padding: 32, width: '100%', maxWidth: 440 }}>
            <h2 style={{ fontWeight: 700, fontSize: 18, margin: '0 0 4px' }}>Add Video Link</h2>
            <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 20 }}>{addVideoTarget}</p>
            <input autoFocus value={videoUrl} onChange={e => setVideoUrl(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && videoUrl.trim()) handleSaveVideo(addVideoTarget, videoUrl); if (e.key === 'Escape') setAddVideoTarget(null); }} placeholder="https://youtube.com/watch?v=..." style={{ width: '100%', boxSizing: 'border-box', background: 'var(--card-alt)', border: '1px solid var(--border-strong)', borderRadius: 10, padding: '11px 14px', color: 'var(--text)', fontSize: 14, outline: 'none', marginBottom: 16 }} />
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setAddVideoTarget(null)} style={{ flex: 1, background: 'var(--card-alt)', border: '1px solid var(--border-strong)', color: 'var(--text-muted)', borderRadius: 10, padding: '11px 0', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>Cancel</button>
              <button onClick={() => handleSaveVideo(addVideoTarget, videoUrl)} disabled={!videoUrl.trim() || savingVideo} style={{ flex: 2, background: videoUrl.trim() ? TEAL : 'var(--input-bg)', color: videoUrl.trim() ? '#0f1117' : 'var(--text-dim)', borderRadius: 10, padding: '11px 0', fontWeight: 700, fontSize: 14, border: 'none', cursor: videoUrl.trim() ? 'pointer' : 'not-allowed' }}>{savingVideo ? 'Saving…' : 'Save Video Link'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Unsaved changes guard */}
      {navGuardHref !== null && (
        <div onClick={() => setNavGuardHref(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 20, padding: '28px 32px', maxWidth: 420, width: '90%' }}>
            <h3 style={{ margin: '0 0 10px', fontSize: 18, fontWeight: 800, color: 'var(--text)' }}>Unsaved changes</h3>
            <p style={{ margin: '0 0 24px', color: 'var(--text-muted)', fontSize: 14, lineHeight: '1.5' }}>
              You have unsaved changes to this template. If you leave now, your changes will be lost.
            </p>
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                onClick={() => setNavGuardHref(null)}
                style={{ flex: 1, background: 'var(--card-alt)', border: '1px solid var(--border-strong)', color: 'var(--text)', borderRadius: 10, padding: '10px 0', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}
              >
                Keep Editing
              </button>
              <button
                onClick={() => { isDirtyRef.current = false; router.push(navGuardHref); }}
                style={{ flex: 1, background: 'var(--btn-red-bg)', border: '1px solid var(--btn-red-border)', color: 'var(--btn-red-text)', borderRadius: 10, padding: '10px 0', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}
              >
                Discard Changes
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
  border: '1px solid var(--border)',
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
  background: 'var(--card)',
  border: '1px solid var(--border)',
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
