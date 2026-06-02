'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState, useCallback, useRef, Suspense, Fragment } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { getSupabase } from '@/lib/supabase';
import { EXERCISES, MUSCLE_GROUPS, Exercise } from '@/data/exercises';
import { Sk, SkPage, SkSubHeader } from '@/components/Skeleton';

const TEAL   = '#5fcfbf';
const PURPLE = '#C471ED';

type WeightUnit = 'lbs' | 'kg';

interface WorkoutSet {
  reps?: number;
  weight?: number;
  unit?: WeightUnit;   // stored per-set so mobile app reads it
  seconds?: number;
  minutes?: number;
  rest?: number; // rest after set, in minutes
}

interface PlanExercise {
  id: string;
  exercise: Exercise;
  sets: WorkoutSet[];
  targetSets: number;
  notes: string;
  supersetWithId?: string;
  unit?: WeightUnit;   // per-exercise unit preference
}

interface PlanDay {
  id: string;
  label: string;
  exercises: PlanExercise[];
}

// Rest is stored in minutes (fractional). These helpers convert for display.
function toMinSec(restMin: number): { m: number; s: number } {
  const m = Math.floor(restMin);
  const s = Math.round((restMin - m) * 60);
  return { m, s };
}
function fromMinSec(m: number, s: number): number {
  return m + s / 60;
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
  const editId        = searchParams.get('edit');
  const presetPatient = searchParams.get('patient');
  const templateId    = searchParams.get('template');

  const [authed,       setAuthed]       = useState(false);
  const [practId,      setPractId]      = useState('');
  const [patients,     setPatients]     = useState<Patient[]>([]);
  const [patientId,    setPatientId]    = useState('');
  const [planName,     setPlanName]     = useState('');
  const [description,  setDescription]  = useState('');
  const [days,             setDays]             = useState<PlanDay[]>([{ id: 'day-1', label: 'Day 1', exercises: [] }]);
  const [activeDayId,      setActiveDayId]      = useState('day-1');
  const [frequencyPerWeek, setFrequencyPerWeek] = useState(3);
  const [editingDayId,     setEditingDayId]     = useState<string | null>(null);
  const [editingDayLabel,  setEditingDayLabel]  = useState('');
  const [search,       setSearch]       = useState('');
  const [muscleFilter, setMuscleFilter] = useState('All');
  const [saving,        setSaving]        = useState(false);
  const [saveError,     setSaveError]     = useState('');
  const [saveToLibrary, setSaveToLibrary] = useState(false);
  const [libraryName,   setLibraryName]   = useState('');
  const [draggedId,     setDraggedId]     = useState<string | null>(null);
  const [dragOverId,   setDragOverId]   = useState<string | null>(null);
  const [supersetMode, setSupersetMode] = useState<string | null>(null);
  const [mediaMap,       setMediaMap]       = useState<Record<string, { type: string; signedUrl?: string; urlLink?: string }>>({});
  const [demoPreview,    setDemoPreview]    = useState<{ name: string; type: string; signedUrl?: string; urlLink?: string } | null>(null);
  const [addVideoTarget,   setAddVideoTarget]   = useState<string | null>(null);
  const [videoUrl,         setVideoUrl]         = useState('');
  const [savingVideo,      setSavingVideo]      = useState(false);
  const [videoMode,        setVideoMode]        = useState<'url' | 'file'>('url');
  const [videoFile,        setVideoFile]        = useState<File | null>(null);
  const [uploading,        setUploading]        = useState(false);
  const [videoNotes,       setVideoNotes]       = useState('');
  const [videoMuscleGroup, setVideoMuscleGroup] = useState('');
  const [videoSaved,       setVideoSaved]       = useState(false);
  const [sidebarOpen,  setSidebarOpen]  = useState(true);
  const [collapsedExercises, setCollapsedExercises] = useState<Set<string>>(new Set());
  const [preferredUnit, setPreferredUnit] = useState<WeightUnit>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('liftlog_weight_unit');
      if (saved === 'kg' || saved === 'lbs') return saved;
    }
    return 'lbs';
  });
  const preferredUnitRef = useRef<WeightUnit>('lbs');

  useEffect(() => {
    const sb = getSupabase();
    sb.auth.getSession().then(async ({ data }) => {
      if (!data.session) { router.push('/login'); return; }

      const { data: prof } = await sb.from('profiles').select('role, is_gym_owner').eq('id', data.session.user.id).single();
      if (prof?.role !== 'practitioner' && !prof?.is_gym_owner) { router.push('/profile'); return; }

      const uid = data.session.user.id;
      setPractId(uid);
      setAuthed(true);

      // Load media map so exercise cards can show demo badges + previews
      const { data: mediaItems } = await sb
        .from('exercise_media')
        .select('exercise_name, media_type, file_path, url_link')
        .eq('practitioner_id', uid);
      const map: Record<string, { type: string; signedUrl?: string; urlLink?: string }> = {};
      await Promise.all((mediaItems ?? []).map(async m => {
        let signedUrl: string | undefined;
        if (m.media_type !== 'link' && m.file_path) {
          const { data: su } = await sb.storage.from('exercise-media').createSignedUrl(m.file_path, 3600);
          signedUrl = su?.signedUrl ?? undefined;
        }
        map[m.exercise_name] = { type: m.media_type, signedUrl, urlLink: m.url_link ?? undefined };
      }));
      setMediaMap(map);

      const { data: links } = await sb
        .from('patient_links')
        .select('profiles:patient_id(id, display_name, email)')
        .eq('practitioner_id', uid);
      const pats: Patient[] = (links ?? [])
        .map((l: any) => Array.isArray(l.profiles) ? l.profiles[0] : l.profiles)
        .filter(Boolean);
      setPatients(pats);

      if (presetPatient) setPatientId(presetPatient);

      if (templateId) {
        const { data: tpl } = await sb
          .from('plan_templates')
          .select('*')
          .eq('id', templateId)
          .single();
        if (tpl) {
          setPlanName(tpl.name);
          setDescription(tpl.description ?? '');
          const raw = tpl.exercises;
          if (raw && !Array.isArray(raw) && raw.days) {
            // New multi-day format
            setFrequencyPerWeek(raw.frequencyPerWeek ?? 3);
            const loadedDays: PlanDay[] = (raw.days as any[]).map((day: any) => ({
              id: day.id ?? String(Math.random()),
              label: day.label ?? 'Day',
              exercises: (day.exercises ?? []).map((e: any) => ({
                id: e.id ?? String(Math.random()),
                exercise: e.exercise,
                sets: (e.sets ?? [{ reps: 10, weight: 0 }]).map((s: any) => ({ ...s })),
                targetSets: e.targetSets ?? e.sets?.length ?? 3,
                notes: e.notes ?? '',
                supersetWithId: e.supersetWithId,
                unit: e.unit ?? undefined,
              })),
            }));
            setDays(loadedDays);
            setActiveDayId(loadedDays[0]?.id ?? 'day-1');
            const firstUnit = loadedDays[0]?.exercises[0]?.unit;
            if (firstUnit) setPreferredUnit(firstUnit);
          } else {
            // Old flat format
            const loaded: PlanExercise[] = (Array.isArray(raw) ? raw : []).map((e: any) => ({
              id: String(Math.random()),
              exercise: e.exercise,
              sets: (e.sets ?? [{ reps: 10, weight: 0 }]).map((s: any) => ({ ...s })),
              targetSets: e.sets?.length ?? 3,
              notes: e.notes ?? '',
              unit: e.unit ?? undefined,
            }));
            const tplUnit = loaded[0]?.unit;
            if (tplUnit) setPreferredUnit(tplUnit);
            setDays([{ id: 'day-1', label: 'Day 1', exercises: loaded }]);
            setActiveDayId('day-1');
          }
        }
      }

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
          const raw = plan.exercises;
          if (raw && !Array.isArray(raw) && raw.days) {
            // New multi-day format
            setFrequencyPerWeek(raw.frequencyPerWeek ?? 3);
            const loadedDays: PlanDay[] = (raw.days as any[]).map((day: any) => ({
              id: day.id ?? String(Math.random()),
              label: day.label ?? 'Day',
              exercises: (day.exercises ?? []).map((e: any) => ({
                id: e.id ?? String(Math.random()),
                exercise: e.exercise,
                sets: e.sets ?? [],
                targetSets: e.targetSets ?? e.sets?.length ?? 3,
                notes: e.notes ?? '',
                supersetWithId: e.supersetWithId,
                unit: e.unit ?? e.sets?.[0]?.unit ?? undefined,
              })),
            }));
            setDays(loadedDays);
            setActiveDayId(loadedDays[0]?.id ?? 'day-1');
            const firstUnit = loadedDays[0]?.exercises[0]?.unit;
            if (firstUnit) setPreferredUnit(firstUnit);
          } else {
            // Old flat format
            const loaded: PlanExercise[] = (Array.isArray(raw) ? raw : []).map((e: any) => ({
              id: e.id ?? String(Math.random()),
              exercise: e.exercise,
              sets: e.sets ?? [],
              targetSets: e.targetSets ?? e.sets?.length ?? 3,
              notes: e.notes ?? '',
              supersetWithId: e.supersetWithId,
              unit: e.unit ?? e.sets?.[0]?.unit ?? undefined,
            }));
            const planUnit = loaded[0]?.unit;
            if (planUnit) setPreferredUnit(planUnit);
            setDays([{ id: 'day-1', label: 'Day 1', exercises: loaded }]);
            setActiveDayId('day-1');
          }
        }
      }
    });
  }, [router, editId]);

  const activeDay      = days.find(d => d.id === activeDayId) ?? days[0];
  const activeExercises = activeDay?.exercises ?? [];

  const updateActiveDay = useCallback((fn: (exs: PlanExercise[]) => PlanExercise[]) => {
    setDays(prev => prev.map(d => d.id === activeDayId ? { ...d, exercises: fn(d.exercises) } : d));
  }, [activeDayId]);

  const addDay = () => {
    const newId = `day-${Date.now()}`;
    const newLabel = `Day ${days.length + 1}`;
    setDays(prev => [...prev, { id: newId, label: newLabel, exercises: [] }]);
    setActiveDayId(newId);
  };

  const removeDay = (dayId: string) => {
    if (days.length <= 1) return;
    setDays(prev => prev.filter(d => d.id !== dayId));
    if (activeDayId === dayId) setActiveDayId(days[0].id !== dayId ? days[0].id : days[1].id);
  };

  const startRenameDay = (day: PlanDay) => {
    setEditingDayId(day.id);
    setEditingDayLabel(day.label);
  };

  const commitRenameDay = () => {
    if (!editingDayId) return;
    setDays(prev => prev.map(d => d.id === editingDayId ? { ...d, label: editingDayLabel.trim() || d.label } : d));
    setEditingDayId(null);
  };

  const filteredExercises = EXERCISES.filter(ex => {
    const matchesMuscle = muscleFilter === 'All' || ex.muscleGroup === muscleFilter;
    const matchesSearch = ex.name.toLowerCase().includes(search.toLowerCase());
    return matchesMuscle && matchesSearch;
  });

  // Keep ref in sync so addExercise (memoised) always reads the latest unit
  useEffect(() => { preferredUnitRef.current = preferredUnit; }, [preferredUnit]);

  const addExercise = useCallback((ex: Exercise) => {
    updateActiveDay(prev => {
      if (prev.some(pe => pe.exercise.id === ex.id)) return prev;
      const sets = [defaultSet(ex), defaultSet(ex), defaultSet(ex)].map(s => ({ ...s, rest: 1 }));
      return [...prev, { id: String(Date.now()), exercise: ex, sets, targetSets: 3, notes: '', unit: preferredUnitRef.current }];
    });
  }, [updateActiveDay]);

  const toggleUnit = (peId: string) => {
    updateActiveDay(prev => prev.map(pe => {
      if (pe.id !== peId) return pe;
      const next: WeightUnit = (pe.unit ?? preferredUnit) === 'lbs' ? 'kg' : 'lbs';
      setPreferredUnit(next);
      localStorage.setItem('liftlog_weight_unit', next);
      return { ...pe, unit: next };
    }));
  };

  const removeExercise = (id: string) => updateActiveDay(prev => prev.filter(pe => pe.id !== id));

  const updateSet = (peId: string, setIdx: number, field: keyof WorkoutSet, value: number) => {
    updateActiveDay(prev => prev.map(pe => {
      if (pe.id !== peId) return pe;
      const sets = pe.sets.map((s, i) => i === setIdx ? { ...s, [field]: value } : s);
      return { ...pe, sets };
    }));
  };

  const updateTargetSets = (peId: string, count: number) => {
    updateActiveDay(prev => prev.map(pe => {
      if (pe.id !== peId) return pe;
      const ex = pe.exercise;
      let sets = [...pe.sets];
      while (sets.length < count) sets.push(defaultSet(ex));
      sets = sets.slice(0, count);
      return { ...pe, sets, targetSets: count };
    }));
  };

  const closeVideoModal = () => {
    setAddVideoTarget(null);
    setVideoUrl('');
    setVideoFile(null);
    setVideoNotes('');
    setVideoMuscleGroup('');
    setVideoSaved(false);
    setVideoMode('url');
  };

  const handleSaveVideo = async (exerciseName: string, url: string) => {
    if (!url.trim()) return;
    setSavingVideo(true);
    const { error } = await getSupabase()
      .from('exercise_media')
      .upsert(
        {
          practitioner_id: practId,
          exercise_name:   exerciseName,
          media_type:      'link',
          url_link:        url.trim(),
          file_path:       '',   // must be '' not null — table rejects null
          muscle_group:    videoMuscleGroup.trim() || null,
          notes:           videoNotes.trim()       || null,
        },
        { onConflict: 'practitioner_id,exercise_name' }
      );
    if (!error) {
      setMediaMap(prev => ({ ...prev, [exerciseName]: { type: 'link', urlLink: url.trim() } }));
      setVideoSaved(true);
      setTimeout(closeVideoModal, 2000);
    }
    setSavingVideo(false);
  };

  const handleUploadVideo = async (exerciseName: string, file: File) => {
    setUploading(true);
    const ext      = file.name.split('.').pop() ?? 'mp4';
    const safeName = exerciseName.replace(/[^a-zA-Z0-9]/g, '_');
    const path     = `${practId}/videos/${safeName}_${Date.now()}.${ext}`;
    const sb       = getSupabase();
    const { error: upErr } = await sb.storage.from('exercise-media').upload(path, file, { upsert: true });
    if (!upErr) {
      await sb.from('exercise_media').upsert(
        {
          practitioner_id: practId,
          exercise_name:   exerciseName,
          media_type:      'video',
          file_path:       path,
          url_link:        null,
          muscle_group:    videoMuscleGroup.trim() || null,
          notes:           videoNotes.trim()       || null,
        },
        { onConflict: 'practitioner_id,exercise_name' }
      );
      const { data: su } = await sb.storage.from('exercise-media').createSignedUrl(path, 3600);
      setMediaMap(prev => ({ ...prev, [exerciseName]: { type: 'video', signedUrl: su?.signedUrl ?? undefined } }));
      setVideoSaved(true);
      setTimeout(closeVideoModal, 2000);
    }
    setUploading(false);
  };

  const updateNotes = (peId: string, notes: string) => {
    updateActiveDay(prev => prev.map(pe => pe.id === peId ? { ...pe, notes } : pe));
  };

  const removeSuperset = (peId: string) => {
    updateActiveDay(prev => prev.map(pe =>
      pe.id === peId || pe.supersetWithId === peId ? { ...pe, supersetWithId: undefined } : pe
    ));
  };

  const handleSupersetClick = (peId: string) => {
    if (supersetMode === null) {
      setSupersetMode(peId);
    } else if (supersetMode === peId) {
      setSupersetMode(null);
    } else {
      updateActiveDay(prev => prev.map(pe => {
        if (pe.id === supersetMode) return { ...pe, supersetWithId: peId };
        if (pe.id === peId)         return { ...pe, supersetWithId: supersetMode };
        return pe;
      }));
      setSupersetMode(null);
    }
  };

  const handleDragStart = (e: React.DragEvent, id: string) => {
    setDraggedId(id);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragEnd = () => {
    setDraggedId(null);
    setDragOverId(null);
  };

  const handleDragOver = (e: React.DragEvent, id: string) => {
    e.preventDefault();
    if (id !== draggedId) setDragOverId(id);
  };

  const handleDrop = (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    if (!draggedId || draggedId === targetId) { setDraggedId(null); setDragOverId(null); return; }
    updateActiveDay(prev => {
      const items = [...prev];
      const from = items.findIndex(p => p.id === draggedId);
      const to   = items.findIndex(p => p.id === targetId);
      const [moved] = items.splice(from, 1);
      items.splice(to, 0, moved);
      return items;
    });
    setDraggedId(null);
    setDragOverId(null);
  };

  const handleSave = async () => {
    if (!planName.trim())   { setSaveError('Plan name is required.'); return; }
    if (!patientId)         { setSaveError('Please select a patient.'); return; }
    if (days.every(d => d.exercises.length === 0)) { setSaveError('Add at least one exercise.'); return; }

    setSaving(true);
    setSaveError('');
    const sb = getSupabase();

    const exercisesPayload = { frequencyPerWeek, days };

    const payload = {
      practitioner_id: practId,
      patient_id:      patientId,
      name:            planName.trim(),
      description:     description.trim() || null,
      exercises:       exercisesPayload,
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

    if (saveToLibrary && !editId) {
      const libName = libraryName.trim() || planName.trim();
      await sb.from('plan_templates').insert({
        practitioner_id: practId,
        name: libName,
        description: description.trim() || null,
        exercises: exercisesPayload,
      });
    }

    router.push('/plans');
  };

  if (!authed) {
    return (
      <SkPage>
        <SkSubHeader />
        <main style={{ maxWidth: 1100, margin: '0 auto', padding: '24px 24px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.6fr', gap: 20 }}>
            <div>
              <Sk width="100%" height={42} radius={10} style={{ marginBottom: 12 }} />
              <Sk width="100%" height={42} radius={10} style={{ marginBottom: 12 }} />
              <Sk width="100%" height={80} radius={10} />
            </div>
            <div>
              {[0,1,2].map(i => (
                <div key={i} style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16, padding: '16px 20px', marginBottom: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                    <Sk width={150} height={14} />
                    <Sk width={60} height={22} radius={999} style={{ marginLeft: 'auto' }} />
                  </div>
                  {[0,1].map(j => (
                    <div key={j} style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                      <Sk width={40} height={32} radius={8} />
                      <Sk width={70} height={32} radius={8} />
                      <Sk width={70} height={32} radius={8} />
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </main>
      </SkPage>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', color: 'var(--text)', fontFamily: 'sans-serif' }}>

      {/* Sub-header */}
      <div style={{ borderBottom: '1px solid var(--border-subtle)', padding: '12px 32px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ color: 'var(--text)', fontSize: 13 }}>
          <a href="/plans" style={{ color: 'var(--text)', textDecoration: 'none' }}>Plans</a>
          {' / '}{editId ? 'Edit' : 'New'}
        </span>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          {saveError && <span style={{ color: '#EF4444', fontSize: 13 }}>{saveError}</span>}
          <button onClick={() => router.push('/plans')} style={{ background: 'transparent', border: '1px solid var(--border-strong)', color: 'var(--text-muted)', borderRadius: 10, padding: '8px 16px', fontSize: 14, cursor: 'pointer' }}>
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
      </div>

      {/* Plan meta */}
      <div style={{ borderBottom: '1px solid var(--border-subtle)', padding: '20px 32px', display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div style={{ flex: '1 1 220px', minWidth: 0 }}>
          <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--text)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Plan Name *</label>
          <input
            value={planName}
            onChange={e => setPlanName(e.target.value)}
            placeholder="e.g. Week 1 Strength Program"
            style={{ width: '100%', background: 'var(--card-alt)', border: '1px solid var(--border-strong)', borderRadius: 10, padding: '10px 14px', color: 'var(--text)', fontSize: 14, outline: 'none', boxSizing: 'border-box' }}
          />
        </div>
        <div style={{ flex: '1 1 180px', minWidth: 0 }}>
          <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--text)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Patient *</label>
          <select
            value={patientId}
            onChange={e => setPatientId(e.target.value)}
            style={{ width: '100%', background: 'var(--card-alt)', border: '1px solid var(--border-strong)', borderRadius: 10, padding: '10px 14px', color: patientId ? 'var(--text)' : 'var(--text-muted)', fontSize: 14, outline: 'none', boxSizing: 'border-box', cursor: 'pointer' }}
          >
            <option value="">Select patient…</option>
            {patients.map(p => (
              <option key={p.id} value={p.id} style={{ background: 'var(--card)' }}>{p.display_name}</option>
            ))}
          </select>
        </div>
        <div style={{ flex: '2 1 300px', minWidth: 0 }}>
          <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--text)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Description</label>
          <input
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="Optional notes about this plan…"
            style={{ width: '100%', background: 'var(--card-alt)', border: '1px solid var(--border-strong)', borderRadius: 10, padding: '10px 14px', color: 'var(--text)', fontSize: 14, outline: 'none', boxSizing: 'border-box' }}
          />
        </div>
        <div style={{ flexShrink: 0 }}>
          <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--text)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Times / Week</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              onClick={() => setFrequencyPerWeek(v => Math.max(1, v - 1))}
              style={{ width: 32, height: 32, borderRadius: 8, border: '1px solid var(--border-strong)', background: 'var(--input-bg)', color: 'var(--text)', cursor: 'pointer', fontSize: 18, fontWeight: 700, lineHeight: 1 }}
            >−</button>
            <span style={{ width: 28, textAlign: 'center', fontWeight: 700, fontSize: 18, color: TEAL }}>{frequencyPerWeek}</span>
            <button
              onClick={() => setFrequencyPerWeek(v => Math.min(7, v + 1))}
              style={{ width: 32, height: 32, borderRadius: 8, border: '1px solid var(--border-strong)', background: 'var(--input-bg)', color: 'var(--text)', cursor: 'pointer', fontSize: 18, fontWeight: 700, lineHeight: 1 }}
            >+</button>
          </div>
        </div>
      </div>

      {/* Two-column builder */}
      <div style={{ display: 'flex', height: 'calc(100vh - 170px)', overflow: 'hidden' }}>

        {/* Left: Exercise Library — collapsible */}
        <div style={{ width: sidebarOpen ? 280 : 44, flexShrink: 0, borderRight: '1px solid var(--input-bg)', display: 'flex', flexDirection: 'column', overflow: 'hidden', transition: 'width 0.2s ease' }}>
          {/* Sidebar header with toggle */}
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
          {sidebarOpen && <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border-subtle)' }}>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search exercises…"
              style={{ width: '100%', background: 'var(--card-alt)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px', color: 'var(--text)', fontSize: 13, outline: 'none', boxSizing: 'border-box', marginBottom: 8 }}
            />
            <select
              value={muscleFilter}
              onChange={e => setMuscleFilter(e.target.value)}
              style={{ width: '100%', background: 'var(--card-alt)', border: '1px solid var(--border)', borderRadius: 8, padding: '7px 12px', color: 'var(--text)', fontSize: 13, outline: 'none', boxSizing: 'border-box', cursor: 'pointer' }}
            >
              <option value="All" style={{ background: 'var(--card)' }}>All muscle groups</option>
              {MUSCLE_GROUPS.map(mg => (
                <option key={mg} value={mg} style={{ background: 'var(--card)' }}>{mg}</option>
              ))}
            </select>
          </div>}
          {sidebarOpen && <div style={{ flex: 1, overflowY: 'auto', padding: '8px' }}>
            {filteredExercises.map(ex => {
              const alreadyAdded = activeExercises.some(pe => pe.exercise.id === ex.id);
              return (
                <button
                  key={ex.id}
                  onClick={() => {
                    if (alreadyAdded) {
                      const pe = activeExercises.find(p => p.exercise.id === ex.id);
                      if (pe) removeExercise(pe.id);
                    } else {
                      addExercise(ex);
                    }
                  }}
                  style={{
                    display: 'block', width: '100%', textAlign: 'left',
                    background: alreadyAdded ? 'rgba(95,207,191,0.08)' : 'transparent',
                    border: `1px solid ${alreadyAdded ? `${TEAL}40` : 'transparent'}`,
                    borderRadius: 8, padding: '9px 12px', marginBottom: 2, cursor: 'pointer',
                    transition: 'background 0.15s',
                  }}
                  onMouseEnter={e => {
                    (e.currentTarget as HTMLButtonElement).style.background = alreadyAdded
                      ? 'rgba(239,68,68,0.1)'
                      : 'var(--card-alt)';
                  }}
                  onMouseLeave={e => {
                    (e.currentTarget as HTMLButtonElement).style.background = alreadyAdded
                      ? 'rgba(95,207,191,0.08)'
                      : 'transparent';
                  }}
                  title={alreadyAdded ? 'Click to remove from plan' : 'Click to add to plan'}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: alreadyAdded ? TEAL : 'var(--text)' }}>{ex.name}</span>
                    {alreadyAdded && <span style={{ fontSize: 11, color: TEAL }}>✓ added</span>}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>
                    {ex.muscleGroup} · {ex.equipment}
                  </div>
                </button>
              );
            })}
            {filteredExercises.length === 0 && (
              <p style={{ color: 'var(--text-dim)', fontSize: 13, textAlign: 'center', padding: 20 }}>No exercises found</p>
            )}
          </div>}
        </div>

        {/* Right: Plan builder */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

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
                    style={{
                      background: activeDayId === day.id ? TEAL : 'var(--card-alt)',
                      color: activeDayId === day.id ? '#0f1117' : 'var(--text-muted)',
                      border: `1px solid ${activeDayId === day.id ? TEAL : 'var(--border-strong)'}`,
                      borderRadius: 8, padding: '5px 12px', fontSize: 13, fontWeight: 700,
                      cursor: 'pointer', whiteSpace: 'nowrap',
                    }}
                  >{day.label}</button>
                )}
                {days.length > 1 && (
                  <button
                    onClick={() => removeDay(day.id)}
                    title="Remove this day"
                    style={{ marginLeft: 2, background: 'transparent', border: 'none', color: 'var(--text-faint)', cursor: 'pointer', fontSize: 13, padding: '2px 4px', lineHeight: 1 }}
                  >×</button>
                )}
              </div>
            ))}
            {days.length < 7 && (
              <button
                onClick={addDay}
                style={{ background: 'transparent', border: `1px dashed var(--border-strong)`, borderRadius: 8, padding: '5px 12px', color: 'var(--text-muted)', fontSize: 13, cursor: 'pointer' }}
              >+ Add Day</button>
            )}
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: '20px 28px' }}>
          {activeExercises.length === 0 ? (
            <div
              onClick={() => { if (!sidebarOpen) setSidebarOpen(true); }}
              style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '60%', gap: 12, opacity: 0.6, cursor: sidebarOpen ? 'default' : 'pointer' }}
            >
              <p style={{ fontSize: 36, margin: 0 }}>+</p>
              <p style={{ color: 'var(--text-muted)', fontSize: 14, textAlign: 'center', margin: 0 }}>
                {sidebarOpen
                  ? 'Click exercises on the left to add them to this plan'
                  : 'Open the exercise library (◀ on the left) or click here to add exercises'}
              </p>
            </div>
          ) : (
            <>
              {supersetMode && (
                <div style={{ background: `${PURPLE}15`, border: `1px solid ${PURPLE}50`, borderRadius: 10, padding: '10px 16px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 13, color: PURPLE, fontWeight: 600 }}>Superset mode — click &ldquo;Pair Here&rdquo; on another exercise to link them</span>
                  <button onClick={() => setSupersetMode(null)} style={{ marginLeft: 'auto', background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 13 }}>✕ Cancel</button>
                </div>
              )}
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {activeExercises.map((pe, exIdx) => {
                  const nextPe = activeExercises[exIdx + 1];
                  const prevPe = activeExercises[exIdx - 1];
                  const isSuperset      = !!pe.supersetWithId;
                  const isDragging      = draggedId === pe.id;
                  const isDragOver      = dragOverId === pe.id;
                  const showConnector   = !!(nextPe && pe.supersetWithId === nextPe.id && nextPe.supersetWithId === pe.id);
                  const afterConnector  = !!(prevPe && prevPe.supersetWithId === pe.id && pe.supersetWithId === prevPe.id);
                  const isSupersetFirst = supersetMode === pe.id;
                  const canPair         = supersetMode !== null && supersetMode !== pe.id && !pe.supersetWithId;
                  const isCollapsed     = collapsedExercises.has(pe.id);
                  const topR    = afterConnector  ? 0 : 14;
                  const bottomR = showConnector   ? 0 : 14;

                  return (
                    <Fragment key={pe.id}>
                      <div
                        draggable
                        onDragStart={e => {
                          const tag = (e.target as HTMLElement).tagName.toLowerCase();
                          if (tag === 'input' || tag === 'button' || tag === 'textarea') { e.preventDefault(); return; }
                          handleDragStart(e, pe.id);
                        }}
                        onDragEnd={handleDragEnd}
                        onDragOver={e => handleDragOver(e, pe.id)}
                        onDrop={e => handleDrop(e, pe.id)}
                        style={{
                          background: isDragOver ? 'rgba(95,207,191,0.06)' : 'var(--card)',
                          border: `1px solid ${isDragOver ? `${TEAL}80` : isSuperset ? `${PURPLE}60` : isSupersetFirst ? `${PURPLE}99` : `${PURPLE}30`}`,
                          borderRadius: `${topR}px ${topR}px ${bottomR}px ${bottomR}px`,
                          padding: '18px 20px',
                          opacity: isDragging ? 0.4 : 1,
                          transition: 'opacity 0.15s, border-color 0.15s, background 0.15s',
                          marginBottom: showConnector ? 0 : 12,
                        }}
                      >
                        {/* Card header */}
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: isCollapsed ? 0 : 14 }}>
                          <div
                            onClick={() => setCollapsedExercises(prev => { const n = new Set(prev); n.has(pe.id) ? n.delete(pe.id) : n.add(pe.id); return n; })}
                            style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0, cursor: 'pointer' }}
                          >
                            <span title="Drag to reorder" onClick={e => e.stopPropagation()} style={{ color: 'var(--text-faint)', fontSize: 15, cursor: 'grab', userSelect: 'none', flexShrink: 0 }}>⠿</span>
                            <div>
                              <span style={{ fontWeight: 700, fontSize: 15 }}>{exIdx + 1}. {pe.exercise.name}</span>
                              <span style={{ marginLeft: 10, fontSize: 12, color: 'var(--text-dim)' }}>
                                {pe.exercise.muscleGroup} · {pe.exercise.equipment}
                              </span>
                              {mediaMap[pe.exercise.name] ? (() => {
                                const m = mediaMap[pe.exercise.name];
                                return (
                                  <button
                                    onClick={e => { e.stopPropagation(); setDemoPreview({ name: pe.exercise.name, ...m }); }}
                                    style={{ marginLeft: 10, fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 999, background: `${TEAL}18`, color: TEAL, border: 'none', cursor: 'pointer', verticalAlign: 'middle' }}
                                    title="Click to preview demo"
                                  >
                                    {m.type === 'link' ? '🔗 Link' : m.type === 'video' ? '📹 Video' : '📷 Photo'}
                                  </button>
                                );
                              })() : (
                                <button
                                  onClick={e => {
                                    e.stopPropagation();
                                    setAddVideoTarget(pe.exercise.name);
                                    setVideoUrl('');
                                    setVideoNotes('');
                                    setVideoSaved(false);
                                    setVideoMode('url');
                                    setVideoFile(null);
                                    // auto-fill muscle group from exercise library if available
                                    const exLib = EXERCISES.find(ex => ex.name === pe.exercise.name);
                                    setVideoMuscleGroup(exLib?.muscleGroup ?? (pe.exercise as any).muscleGroup ?? '');
                                  }}
                                  style={{ marginLeft: 10, fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 999, background: 'var(--card-alt)', color: 'var(--text-muted)', border: '1px dashed var(--border-strong)', cursor: 'pointer', verticalAlign: 'middle' }}
                                  title="Add a video demo link"
                                >
                                  + Add Video
                                </button>
                              )}
                            </div>
                            {isSuperset && (
                              <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 999, background: `${PURPLE}22`, color: PURPLE, flexShrink: 0 }}>SS</span>
                            )}
                          </div>
                          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
                            {isSuperset ? (
                              <button
                                onClick={() => removeSuperset(pe.id)}
                                style={{ background: `${PURPLE}15`, border: `1px solid ${PURPLE}40`, color: PURPLE, borderRadius: 8, padding: '4px 10px', fontSize: 12, cursor: 'pointer', fontWeight: 700 }}
                              >Remove SS</button>
                            ) : isSupersetFirst ? (
                              <button
                                onClick={() => setSupersetMode(null)}
                                style={{ background: 'rgba(249,242,149,0.12)', border: '1px solid rgba(249,242,149,0.4)', color: '#F9F295', borderRadius: 8, padding: '4px 10px', fontSize: 12, cursor: 'pointer', fontWeight: 700 }}
                              >Cancel</button>
                            ) : canPair ? (
                              <button
                                onClick={() => handleSupersetClick(pe.id)}
                                style={{ background: `${PURPLE}22`, border: `1px solid ${PURPLE}70`, color: PURPLE, borderRadius: 8, padding: '4px 10px', fontSize: 12, cursor: 'pointer', fontWeight: 700 }}
                              >Pair Here</button>
                            ) : (
                              <button
                                onClick={() => handleSupersetClick(pe.id)}
                                style={{ background: `${PURPLE}0d`, border: `1px solid ${PURPLE}35`, color: PURPLE, borderRadius: 8, padding: '4px 10px', fontSize: 12, cursor: 'pointer', fontWeight: 600 }}
                              >Superset</button>
                            )}
                            {pe.exercise.type === 'weighted' && (
                              <button
                                onClick={() => toggleUnit(pe.id)}
                                style={{ background: 'var(--card-alt)', border: '1px solid var(--border-strong)', color: TEAL, borderRadius: 8, padding: '4px 10px', fontSize: 11, cursor: 'pointer', fontWeight: 700 }}
                                title="Toggle weight unit"
                              >
                                {pe.unit ?? preferredUnit} ⇄ {(pe.unit ?? preferredUnit) === 'lbs' ? 'kg' : 'lbs'}
                              </button>
                            )}
                            <button
                              onClick={() => removeExercise(pe.id)}
                              style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.3)', color: '#EF4444', borderRadius: 8, padding: '4px 12px', fontSize: 12, cursor: 'pointer', fontWeight: 700 }}
                            >Remove</button>
                          </div>
                        </div>

                        {!isCollapsed && (<>
                        {/* Sets header */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                          <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600 }}>SETS</span>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <button
                              onClick={() => updateTargetSets(pe.id, Math.max(1, pe.targetSets - 1))}
                              style={{ width: 28, height: 28, borderRadius: 6, border: '1px solid var(--border-strong)', background: 'var(--input-bg)', color: 'var(--text)', cursor: 'pointer', fontSize: 18, fontWeight: 700, lineHeight: 1 }}
                            >−</button>
                            <span style={{ width: 28, textAlign: 'center', fontWeight: 700, fontSize: 16, color: TEAL }}>{pe.targetSets}</span>
                            <button
                              onClick={() => updateTargetSets(pe.id, Math.min(12, pe.targetSets + 1))}
                              style={{ width: 28, height: 28, borderRadius: 6, border: '1px solid var(--border-strong)', background: 'var(--input-bg)', color: 'var(--text)', cursor: 'pointer', fontSize: 18, fontWeight: 700, lineHeight: 1 }}
                            >+</button>
                          </div>
                        </div>

                        {/* Set rows */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                          {pe.sets.map((s, si) => (
                            <div key={si} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                              <span style={{ width: 20, fontSize: 12, color: 'var(--text-dim)', textAlign: 'center', flexShrink: 0 }}>{si + 1}</span>

                              {pe.exercise.type === 'weighted' && (
                                <>
                                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1 }}>
                                    <span style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>Reps</span>
                                    <input
                                      type="number" min={1} value={s.reps ?? 10}
                                      onChange={e => updateSet(pe.id, si, 'reps', Number(e.target.value))}
                                      style={{ width: 60, background: 'var(--input-bg)', border: '1px solid var(--border)', borderRadius: 6, padding: '5px 8px', color: 'var(--text)', fontSize: 13, outline: 'none', textAlign: 'center' }}
                                    />
                                  </label>
                                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1 }}>
                                    <span style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>Weight ({pe.unit ?? preferredUnit})</span>
                                    <input
                                      type="number" min={0} step={0.5} value={s.weight ?? 0}
                                      onChange={e => updateSet(pe.id, si, 'weight', Number(e.target.value))}
                                      onFocus={e => e.target.select()}
                                      style={{ width: 70, background: 'var(--input-bg)', border: '1px solid var(--border)', borderRadius: 6, padding: '5px 8px', color: 'var(--text)', fontSize: 13, outline: 'none', textAlign: 'center' }}
                                    />
                                  </label>
                                </>
                              )}

                              {pe.exercise.type === 'duration' && (
                                <label style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1 }}>
                                  <span style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>Seconds</span>
                                  <input
                                    type="number" min={1} value={s.seconds ?? 30}
                                    onChange={e => updateSet(pe.id, si, 'seconds', Number(e.target.value))}
                                    style={{ width: 70, background: 'var(--input-bg)', border: '1px solid var(--border)', borderRadius: 6, padding: '5px 8px', color: 'var(--text)', fontSize: 13, outline: 'none', textAlign: 'center' }}
                                  />
                                </label>
                              )}

                              {pe.exercise.type === 'cardio' && (
                                <label style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1 }}>
                                  <span style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>Minutes</span>
                                  <input
                                    type="number" min={1} value={s.minutes ?? 20}
                                    onChange={e => updateSet(pe.id, si, 'minutes', Number(e.target.value))}
                                    style={{ width: 70, background: 'var(--input-bg)', border: '1px solid var(--border)', borderRadius: 6, padding: '5px 8px', color: 'var(--text)', fontSize: 13, outline: 'none', textAlign: 'center' }}
                                  />
                                </label>
                              )}

                              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                <span style={{ fontSize: 12, color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>Rest</span>
                                <input
                                  type="number" min={0} max={59}
                                  value={toMinSec(s.rest ?? 1).m}
                                  onChange={e => updateSet(pe.id, si, 'rest', fromMinSec(Number(e.target.value), toMinSec(s.rest ?? 1).s))}
                                  onFocus={e => e.target.select()}
                                  style={{ width: 42, background: 'var(--card-alt)', border: '1px solid var(--border)', borderRadius: 6, padding: '5px 6px', color: 'var(--text-muted)', fontSize: 13, outline: 'none', textAlign: 'center' }}
                                />
                                <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>m</span>
                                <input
                                  type="number" min={0} max={59}
                                  value={toMinSec(s.rest ?? 1).s}
                                  onChange={e => updateSet(pe.id, si, 'rest', fromMinSec(toMinSec(s.rest ?? 1).m, Number(e.target.value)))}
                                  onFocus={e => e.target.select()}
                                  style={{ width: 42, background: 'var(--card-alt)', border: '1px solid var(--border)', borderRadius: 6, padding: '5px 6px', color: 'var(--text-muted)', fontSize: 13, outline: 'none', textAlign: 'center' }}
                                />
                                <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>s</span>
                              </div>
                            </div>
                          ))}
                        </div>

                        {/* Practitioner notes */}
                        <div style={{ marginTop: 12 }}>
                          <input
                            value={pe.notes}
                            onChange={e => updateNotes(pe.id, e.target.value)}
                            placeholder="Practitioner notes (e.g. focus on form, keep elbows tucked)…"
                            style={{ width: '100%', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px', color: 'var(--text)', fontSize: 13, outline: 'none', boxSizing: 'border-box' }}
                          />
                        </div>
                        </>)}
                      </div>

                      {/* Superset connector strip between adjacent paired exercises */}
                      {showConnector && (
                        <div style={{
                          display: 'flex', alignItems: 'center', gap: 10,
                          padding: '5px 20px',
                          border: `1px solid ${PURPLE}60`,
                          borderTop: 'none',
                          borderBottom: 'none',
                          background: `${PURPLE}0a`,
                          marginBottom: 0,
                        }}>
                          <div style={{ flex: 1, height: 1, background: `${PURPLE}35` }} />
                          <span style={{ fontSize: 11, fontWeight: 700, color: PURPLE, letterSpacing: '0.05em' }}>⚡ SUPERSET</span>
                          <div style={{ flex: 1, height: 1, background: `${PURPLE}35` }} />
                        </div>
                      )}
                    </Fragment>
                  );
                })}
              </div>
            </>
          )}
          </div>{/* end inner scrollable */}
        </div>{/* end right panel */}
      </div>

      {/* Save to Library bar — only on new plans, not edits */}
      {!editId && (
        <div style={{
          position: 'sticky', bottom: 0, left: 0, right: 0,
          background: 'var(--bg)', borderTop: '1px solid var(--border)',
          padding: '14px 32px', zIndex: 50,
        }}>
          <div style={{ maxWidth: 1100, margin: '0 auto', display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
            {/* Toggle */}
            <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', userSelect: 'none' }}>
              <div
                onClick={() => {
                  setSaveToLibrary(v => !v);
                  if (!saveToLibrary && !libraryName) setLibraryName(planName);
                }}
                style={{
                  width: 40, height: 22, borderRadius: 11, position: 'relative', cursor: 'pointer', flexShrink: 0,
                  background: saveToLibrary ? TEAL : '#6b7280',
                  transition: 'background 0.2s',
                }}
              >
                <div style={{
                  position: 'absolute', top: 3, left: saveToLibrary ? 21 : 3,
                  width: 16, height: 16, borderRadius: '50%', background: '#fff',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.4)',
                  transition: 'left 0.2s',
                }} />
              </div>
              <span style={{ color: saveToLibrary ? 'var(--text)' : 'var(--text-muted)', fontSize: 14, fontWeight: 600 }}>
                📋 Also save to my Plan Library
              </span>
            </label>

            {/* Library name input */}
            {saveToLibrary && (
              <input
                value={libraryName}
                onChange={e => setLibraryName(e.target.value)}
                placeholder="Library name (can differ from patient plan name)"
                style={{
                  flex: 1, minWidth: 220,
                  background: 'var(--card-alt)', border: `1px solid ${TEAL}60`,
                  borderRadius: 10, padding: '9px 14px', color: 'var(--text)', fontSize: 14, outline: 'none',
                }}
              />
            )}

            {saveToLibrary && (
              <span style={{ color: 'var(--text-dim)', fontSize: 12, flexShrink: 0 }}>
                Saved privately to your library — not visible to the patient
              </span>
            )}
          </div>
        </div>
      )}

      {/* Add video modal */}
      {addVideoTarget && (
        <div onClick={closeVideoModal} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 400, padding: 24 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 20, padding: 32, width: '100%', maxWidth: 460 }}>

            {videoSaved ? (
              /* ── Saved confirmation ── */
              <div style={{ textAlign: 'center', padding: '16px 0' }}>
                <p style={{ fontSize: 40, margin: '0 0 12px' }}>✅</p>
                <h2 style={{ fontWeight: 700, fontSize: 18, margin: '0 0 8px', color: TEAL }}>Saved!</h2>
                <p style={{ color: 'var(--text-muted)', fontSize: 14, margin: 0 }}>
                  This demo is now in your <strong style={{ color: 'var(--text)' }}>Video Library</strong> and visible to any patient who has <strong style={{ color: 'var(--text)' }}>{addVideoTarget}</strong> in their plan.
                </p>
              </div>
            ) : (
              <>
                <h2 style={{ fontWeight: 700, fontSize: 18, margin: '0 0 2px' }}>Add Video Demo</h2>
                <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 0, marginBottom: 18 }}>{addVideoTarget}</p>

                {/* Tab switcher */}
                <div style={{ display: 'flex', marginBottom: 20, background: 'var(--card-alt)', borderRadius: 10, padding: 3 }}>
                  {(['url', 'file'] as const).map(mode => (
                    <button key={mode} onClick={() => { setVideoMode(mode); setVideoFile(null); setVideoUrl(''); }}
                      style={{ flex: 1, padding: '8px 0', borderRadius: 8, border: 'none', fontWeight: 700, fontSize: 13, cursor: 'pointer', background: videoMode === mode ? 'var(--text)' : 'transparent', color: videoMode === mode ? '#0f1117' : 'var(--text-muted)' }}>
                      {mode === 'url' ? '🔗 URL Link' : '📁 Upload File'}
                    </button>
                  ))}
                </div>

                {/* Shared context fields */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 16 }}>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Muscle Group</span>
                    <input
                      value={videoMuscleGroup}
                      onChange={e => setVideoMuscleGroup(e.target.value)}
                      placeholder="e.g. Quadriceps"
                      style={{ background: 'var(--card-alt)', border: '1px solid var(--border-strong)', borderRadius: 8, padding: '9px 12px', color: 'var(--text)', fontSize: 14, outline: 'none' }}
                    />
                  </label>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>PT Notes <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(optional)</span></span>
                    <textarea
                      value={videoNotes}
                      onChange={e => setVideoNotes(e.target.value)}
                      placeholder="e.g. Focus on slow descent, keep knee aligned over second toe"
                      rows={2}
                      style={{ background: 'var(--card-alt)', border: '1px solid var(--border-strong)', borderRadius: 8, padding: '9px 12px', color: 'var(--text)', fontSize: 13, outline: 'none', resize: 'vertical', fontFamily: 'inherit' }}
                    />
                  </label>
                </div>

                {/* URL or File input */}
                {videoMode === 'url' ? (
                  <>
                    <input
                      autoFocus
                      value={videoUrl}
                      onChange={e => setVideoUrl(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter' && videoUrl.trim()) handleSaveVideo(addVideoTarget, videoUrl); if (e.key === 'Escape') closeVideoModal(); }}
                      placeholder="https://youtube.com/watch?v=..."
                      style={{ width: '100%', boxSizing: 'border-box', background: 'var(--card-alt)', border: '1px solid var(--border-strong)', borderRadius: 10, padding: '11px 14px', color: 'var(--text)', fontSize: 14, outline: 'none', marginBottom: 16 }}
                    />
                    <div style={{ display: 'flex', gap: 10 }}>
                      <button onClick={closeVideoModal} style={{ flex: 1, background: 'var(--card-alt)', border: '1px solid var(--border-strong)', color: 'var(--text-muted)', borderRadius: 10, padding: '11px 0', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>Cancel</button>
                      <button onClick={() => handleSaveVideo(addVideoTarget, videoUrl)} disabled={!videoUrl.trim() || savingVideo}
                        style={{ flex: 2, background: videoUrl.trim() ? TEAL : 'var(--input-bg)', color: videoUrl.trim() ? '#0f1117' : 'var(--text-dim)', borderRadius: 10, padding: '11px 0', fontWeight: 700, fontSize: 14, border: 'none', cursor: videoUrl.trim() ? 'pointer' : 'not-allowed' }}>
                        {savingVideo ? 'Saving…' : 'Save to Library'}
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <label style={{ display: 'block', marginBottom: 16, cursor: 'pointer' }}>
                      <input type="file" accept="video/mp4,video/quicktime,video/webm,video/*" style={{ display: 'none' }} onChange={e => setVideoFile(e.target.files?.[0] ?? null)} />
                      <div style={{ border: `2px dashed ${videoFile ? TEAL : 'var(--border-strong)'}`, borderRadius: 12, padding: '24px 16px', textAlign: 'center', background: videoFile ? `${TEAL}10` : 'var(--card)' }}>
                        {videoFile ? (
                          <>
                            <p style={{ fontSize: 28, margin: '0 0 6px' }}>🎬</p>
                            <p style={{ fontWeight: 700, fontSize: 14, color: TEAL, margin: '0 0 4px', wordBreak: 'break-all' }}>{videoFile.name}</p>
                            <p style={{ fontSize: 12, color: 'var(--text-dim)', margin: 0 }}>{(videoFile.size / 1024 / 1024).toFixed(1)} MB — click to change</p>
                          </>
                        ) : (
                          <>
                            <p style={{ fontSize: 28, margin: '0 0 8px' }}>📁</p>
                            <p style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-muted)', margin: '0 0 4px' }}>Click to select a video file</p>
                            <p style={{ fontSize: 12, color: 'var(--text-dim)', margin: 0 }}>MP4, MOV, WebM supported</p>
                          </>
                        )}
                      </div>
                    </label>
                    <div style={{ display: 'flex', gap: 10 }}>
                      <button onClick={closeVideoModal} style={{ flex: 1, background: 'var(--card-alt)', border: '1px solid var(--border-strong)', color: 'var(--text-muted)', borderRadius: 10, padding: '11px 0', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>Cancel</button>
                      <button onClick={() => videoFile && handleUploadVideo(addVideoTarget, videoFile)} disabled={!videoFile || uploading}
                        style={{ flex: 2, background: videoFile && !uploading ? TEAL : 'var(--input-bg)', color: videoFile && !uploading ? '#0f1117' : 'var(--text-dim)', borderRadius: 10, padding: '11px 0', fontWeight: 700, fontSize: 14, border: 'none', cursor: videoFile && !uploading ? 'pointer' : 'not-allowed' }}>
                        {uploading ? 'Uploading…' : 'Upload to Library'}
                      </button>
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* Demo preview modal */}
      {demoPreview && (
        <div
          onClick={() => setDemoPreview(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.82)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 300, padding: 24 }}
        >
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
                <a href={demoPreview.urlLink} target="_blank" rel="noopener noreferrer" style={{ background: TEAL, color: '#0f1117', borderRadius: 10, padding: '10px 24px', fontWeight: 700, fontSize: 14, textDecoration: 'none', display: 'inline-block' }}>
                  Open video ↗
                </a>
              </div>
            ) : null}
          </div>
        </div>
      )}
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
