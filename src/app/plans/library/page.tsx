'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getSupabase } from '@/lib/supabase';
import { Sk, SkPage, SkNav } from '@/components/Skeleton';

const TEAL   = '#5fcfbf';
const PURPLE = '#C471ED';

const BODY_PART_GROUPS: { label: string; tags: string[] }[] = [
  { label: 'Upper Body', tags: ['Arms', 'Back', 'Chest', 'Shoulders', 'Upper Body'] },
  { label: 'Lower Body', tags: ['Calves', 'Glutes', 'Hamstrings', 'Hip', 'Legs', 'Lower Back', 'Lower Body'] },
  { label: 'Core', tags: ['Core'] },
  { label: 'General', tags: ['Balance', 'Cardio', 'Full Body', 'Isometrics', 'Pilates', 'Plyometrics', 'Yoga'] },
];
const BODY_PART_TAGS = BODY_PART_GROUPS.flatMap(g => g.tags);

interface Template {
  id: string;
  name: string;
  description: string | null;
  exercises: any[];
  created_at: string;
  archived?: boolean;
}

type SortOption = 'recent' | 'alpha' | 'assigned';
const SORT_LABELS: Record<SortOption, string> = {
  recent: 'Recently Created',
  alpha: 'A–Z',
  assigned: 'Most Assigned',
};

// Normalize exercises from either a flat array or the { frequencyPerWeek, days } object
// saved by the library editor — the DB column can hold either format.
function flatExercises(raw: any): any[] {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === 'object' && Array.isArray(raw.days)) {
    return (raw.days as any[]).flatMap((d: any) => d.exercises ?? []);
  }
  return [];
}

function derivedMuscleGroups(exercises: any[]): string[] {
  const groups = new Set<string>();
  for (const ex of exercises) {
    const mg = ex?.exercise?.muscleGroup ?? ex?.muscleGroup;
    if (mg) groups.add(mg);
  }
  return Array.from(groups).sort();
}

function numWeeks(raw: any): number {
  const exercises: any[] = Array.isArray(raw) ? raw :
    (raw?.days ? (raw.days as any[]).flatMap((d: any) => d.exercises ?? []) : []);
  let max = 1;
  for (const ex of exercises) {
    for (const w of ex.weeks ?? []) {
      if (w.week > max) max = w.week;
    }
  }
  return max;
}

function deriveWeekList(raw: any): number[] {
  const list: any[] = Array.isArray(raw) ? raw :
    (raw?.days ? (raw.days as any[]).flatMap((d: any) => d.exercises ?? []) : []);
  if (list.length === 0) return [];
  const s = new Set<number>();
  for (const ex of list) {
    if (ex.weeks?.length > 0) {
      for (const w of ex.weeks) { if (typeof w.week === 'number') s.add(w.week); }
      if (ex.sets?.length > 0) s.add(1); // base sets = implicit week 1
    } else s.add(1);
  }
  return Array.from(s).sort((a, b) => a - b);
}

function filterByWeeks(raw: any, sel: number[]): any {
  const ws = new Set(sel);
  const keep = (ex: any) => {
    if (!ex.weeks?.length) return ws.has(1) ? ex : null;
    const filtered = ex.weeks.filter((w: any) => ws.has(w.week));
    if (filtered.length) return { ...ex, weeks: filtered };
    // No explicit weeks match — keep as implicit W1 if week 1 selected and base sets exist
    if (ws.has(1) && ex.sets?.length > 0) { const { weeks: _, ...rest } = ex; return rest; }
    return null;
  };
  if (Array.isArray(raw)) return (raw.map(keep).filter(Boolean) as any[]);
  if (raw?.days) return { ...raw, days: raw.days.map((d: any) => ({ ...d, exercises: (d.exercises ?? []).map(keep).filter(Boolean) })) };
  return raw;
}

export default function PlanLibraryPage() {
  const router = useRouter();
  const [authed,     setAuthed]     = useState(false);
  const [userId,     setUserId]     = useState('');
  const [isEmployer, setIsEmployer] = useState(false);
  const [templates,  setTemplates]  = useState<Template[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [creating,   setCreating]   = useState(false);
  const [deleting,   setDeleting]   = useState<string | null>(null);
  const [search,     setSearch]     = useState('');
  const [hoveredId,      setHoveredId]      = useState<string | null>(null);
  const [activeTag,      setActiveTag]      = useState<string | null>(null);
  const [previewTpl,     setPreviewTpl]     = useState<Template | null>(null);
  const [previewWeek,    setPreviewWeek]    = useState(1);
  const [bodyFilter,     setBodyFilter]     = useState('');
  const [bodyFilterGroup, setBodyFilterGroup] = useState<string | null>(null);
  const [bodyFilterOpen, setBodyFilterOpen] = useState(false);
  const [bodySearch,     setBodySearch]     = useState('');
  const [sortBy,         setSortBy]         = useState<SortOption>('recent');
  const [sortOpen,       setSortOpen]       = useState(false);
  const sortRef       = useRef<HTMLDivElement>(null);
  const bodyFilterRef = useRef<HTMLDivElement>(null);
  const [showArchived,   setShowArchived]   = useState(false);
  const [archiving,      setArchiving]      = useState<string | null>(null);
  const [planAssignments, setPlanAssignments] = useState<Record<string, Array<{ planId: string; patientId: string; patientName: string; weeks: number[]; exercisesRaw: any }>>>({});
  const [unassigning,    setUnassigning]    = useState<string | null>(null);
  const [editingAssignment, setEditingAssignment] = useState<{ planId: string; planName: string; patientName: string; weeks: number[]; exercisesRaw: any; templateId: string; availableWeeks: number[] } | null>(null);
  const [editingAssWeeks,   setEditingAssWeeks]   = useState<number[]>([]);
  const [savingAssWeeks,    setSavingAssWeeks]     = useState(false);

  // Patients
  const [patients, setPatients] = useState<Array<{ id: string; display_name: string }>>([]);

  // Reminders
  const [reminders, setReminders] = useState<Array<{ id: string; plan_name: string; remind_at: string; note: string | null; patient_name: string }>>([]);

  // Assign modal
  const [assignTpl,        setAssignTpl]        = useState<Template | null>(null);
  const [assignPatientId,  setAssignPatientId]  = useState('');
  const [assignWeeks,      setAssignWeeks]      = useState<number[]>([]);
  const [assignPlanName,   setAssignPlanName]   = useState('');
  const [assignReminder,   setAssignReminder]   = useState(false);
  const [assignRemindDate, setAssignRemindDate] = useState('');
  const [assignRemindTime, setAssignRemindTime] = useState('09:00');
  const [assignRemindNote, setAssignRemindNote] = useState('');
  const [assigning,        setAssigning]        = useState(false);
  const [assignError,      setAssignError]      = useState('');
  const [assignSuccess,    setAssignSuccess]    = useState(false);

  useEffect(() => {
    const sb = getSupabase();
    sb.auth.getSession().then(async ({ data }) => {
      if (!data.session) { router.push('/login'); return; }
      const { data: prof } = await sb.from('profiles').select('role, is_gym_owner, is_employer').eq('id', data.session.user.id).single();
      if (prof?.role !== 'practitioner' && !prof?.is_gym_owner) { router.push('/profile'); return; }
      setAuthed(true);
      setUserId(data.session.user.id);
      setIsEmployer(!!(prof as any)?.is_employer);
      const { data: rows } = await sb
        .from('plan_templates')
        .select('*')
        .eq('practitioner_id', data.session.user.id)
        .order('created_at', { ascending: false });
      setTemplates((rows ?? []).map((t: any) => ({ ...t, exercises: flatExercises(t.exercises) })));
      const { data: plans } = await sb
        .from('workout_plans')
        .select('id, name, patient_id, exercises, patient:patient_id(display_name)')
        .eq('practitioner_id', data.session.user.id);
      const assignMap: Record<string, Array<{ planId: string; patientId: string; patientName: string; weeks: number[]; exercisesRaw: any }>> = {};
      for (const p of plans ?? []) {
        const key = (p as any).name ?? '';
        if (!assignMap[key]) assignMap[key] = [];
        assignMap[key].push({
          planId: (p as any).id,
          patientId: (p as any).patient_id,
          patientName: ((p as any).patient as any)?.display_name ?? 'Unknown',
          weeks: deriveWeekList((p as any).exercises),
          exercisesRaw: (p as any).exercises,
        });
      }
      setPlanAssignments(assignMap);

      // Load patients for assign modal
      const { data: links } = await sb
        .from('patient_links')
        .select('profiles:patient_id(id, display_name, email)')
        .eq('practitioner_id', data.session.user.id);
      setPatients((links ?? []).map((l: any) => ({
        id: l.profiles?.id,
        display_name: l.profiles?.display_name ?? l.profiles?.email ?? 'Unknown',
      })).filter((p: any) => p.id));

      // Load upcoming reminders (graceful if table doesn't exist)
      const { data: remRows, error: remErr } = await sb
        .from('pt_reminders')
        .select('id, plan_name, remind_at, note, patient:patient_id(display_name)')
        .eq('practitioner_id', data.session.user.id)
        .eq('completed', false)
        .gte('remind_at', new Date().toISOString())
        .order('remind_at', { ascending: true })
        .limit(10);
      if (!remErr) {
        setReminders((remRows ?? []).map((r: any) => ({
          id: r.id,
          plan_name: r.plan_name,
          remind_at: r.remind_at,
          note: r.note,
          patient_name: (r.patient as any)?.display_name ?? 'Unknown',
        })));
      }

      setLoading(false);
    });
  }, [router]);

  // Close Sort dropdown on outside click
  useEffect(() => {
    if (!sortOpen) return;
    const handler = (e: MouseEvent) => {
      if (sortRef.current && !sortRef.current.contains(e.target as Node)) setSortOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [sortOpen]);

  // Close Body Part dropdown on outside click
  useEffect(() => {
    if (!bodyFilterOpen) return;
    const handler = (e: MouseEvent) => {
      if (bodyFilterRef.current && !bodyFilterRef.current.contains(e.target as Node)) {
        setBodyFilterOpen(false);
        setBodySearch('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [bodyFilterOpen]);

  const handleCreate = async () => {
    setCreating(true);
    const { data, error } = await getSupabase()
      .from('plan_templates')
      .insert({ practitioner_id: userId, name: '', description: null, exercises: [] })
      .select()
      .single();
    if (!error && data) router.push(`/plans/library/${data.id}?new=1`);
    else setCreating(false);
  };

  const handleDelete = async (t: Template) => {
    if (!confirm(`Delete "${t.name || 'Untitled template'}"? This cannot be undone.`)) return;
    setDeleting(t.id);
    await getSupabase().from('plan_templates').delete().eq('id', t.id);
    setTemplates(prev => prev.filter(x => x.id !== t.id));
    setDeleting(null);
  };

  const handleArchive = async (t: Template, archived: boolean) => {
    setArchiving(t.id);
    await getSupabase().from('plan_templates').update({ archived }).eq('id', t.id);
    setTemplates(prev => prev.map(x => x.id === t.id ? { ...x, archived } : x));
    setArchiving(null);
  };

  const handleUnassign = async (planId: string, planName: string) => {
    if (!confirm(`Remove this ${isEmployer ? 'employee' : 'patient'} from the plan?`)) return;
    setUnassigning(planId);
    await getSupabase().from('workout_plans').delete().eq('id', planId);
    setPlanAssignments(prev => {
      const updated = { ...prev };
      if (updated[planName]) updated[planName] = updated[planName].filter(a => a.planId !== planId);
      return updated;
    });
    setUnassigning(null);
  };

  const handleSaveAssWeeks = async () => {
    if (!editingAssignment) return;
    setSavingAssWeeks(true);
    const sb = getSupabase();
    const { data: rawTpl } = await sb.from('plan_templates').select('exercises').eq('id', editingAssignment.templateId).single();
    const sourceRaw = (rawTpl as any)?.exercises ?? editingAssignment.exercisesRaw;
    const newRaw = filterByWeeks(sourceRaw, editingAssWeeks);
    const { error } = await sb
      .from('workout_plans')
      .update({ exercises: newRaw })
      .eq('id', editingAssignment.planId);
    if (!error) {
      const newWeeks = deriveWeekList(newRaw);
      setPlanAssignments(prev => {
        const updated = { ...prev };
        const key = editingAssignment.planName;
        if (updated[key]) {
          updated[key] = updated[key].map(a =>
            a.planId === editingAssignment.planId ? { ...a, weeks: newWeeks, exercisesRaw: newRaw } : a
          );
        }
        return updated;
      });
      setEditingAssignment(null);
    }
    setSavingAssWeeks(false);
  };

  function openAssign(tpl: Template) {
    const total = numWeeks(tpl.exercises);
    setAssignTpl(tpl);
    setAssignWeeks(total > 1 ? [] : [1]);
    setAssignPlanName(tpl.name || '');
    setAssignPatientId('');
    setAssignReminder(false);
    setAssignRemindDate('');
    setAssignRemindTime('09:00');
    setAssignRemindNote('');
    setAssignError('');
    setAssignSuccess(false);
  }

  async function handleAssign() {
    if (!assignPatientId) { setAssignError(`Please select ${isEmployer ? 'an employee' : 'a patient'}.`); return; }
    if (assignReminder && !assignRemindDate) { setAssignError('Please choose a reminder date.'); return; }
    setAssigning(true);
    setAssignError('');
    try {
      const sb = getSupabase();
      // Fetch raw template to get original days format
      const { data: rawTpl } = await sb
        .from('plan_templates')
        .select('exercises, description')
        .eq('id', assignTpl!.id)
        .single();
      const rawEx = (rawTpl as any)?.exercises;
      const exercisesPayload = filterByWeeks(rawEx, assignWeeks);
      const planName = assignPlanName.trim() || assignTpl!.name || 'Untitled Plan';
      const { data: newPlan, error: planErr } = await sb
        .from('workout_plans')
        .insert({
          practitioner_id: userId,
          patient_id: assignPatientId,
          name: planName,
          description: (rawTpl as any)?.description ?? null,
          exercises: exercisesPayload,
        })
        .select('id')
        .single();
      if (planErr) throw new Error(planErr.message);
      if (assignReminder && assignRemindDate && newPlan) {
        const remindAt = new Date(`${assignRemindDate}T${assignRemindTime}`).toISOString();
        const { data: newRem } = await sb.from('pt_reminders').insert({
          practitioner_id: userId,
          patient_id: assignPatientId,
          plan_id: newPlan.id,
          plan_name: planName,
          remind_at: remindAt,
          note: assignRemindNote.trim() || null,
        }).select('id, plan_name, remind_at, note, patient:patient_id(display_name)').single();
        if (newRem) {
          setReminders(prev => [...prev, {
            id: (newRem as any).id,
            plan_name: (newRem as any).plan_name,
            remind_at: (newRem as any).remind_at,
            note: (newRem as any).note,
            patient_name: ((newRem as any).patient as any)?.display_name ?? 'Unknown',
          }].sort((a, b) => a.remind_at.localeCompare(b.remind_at)));
        }
      }
      const patient = patients.find(p => p.id === assignPatientId);
      const key = assignTpl!.name || '';
      if (newPlan) {
        setPlanAssignments(prev => ({
          ...prev,
          [key]: [...(prev[key] ?? []), {
            planId: newPlan.id,
            patientId: assignPatientId,
            patientName: patient?.display_name ?? 'Unknown',
            weeks: deriveWeekList(exercisesPayload),
            exercisesRaw: exercisesPayload,
          }],
        }));
      }
      setAssignSuccess(true);
      setTimeout(() => { setAssignTpl(null); setAssignSuccess(false); }, 1800);
    } catch (e: any) {
      setAssignError(e.message || 'Failed to assign plan.');
    } finally {
      setAssigning(false);
    }
  }

  async function dismissReminder(id: string) {
    await getSupabase().from('pt_reminders').update({ completed: true }).eq('id', id);
    setReminders(prev => prev.filter(r => r.id !== id));
  }

  // Collect all unique tags across templates for the filter row
  const allTags = Array.from(new Set(templates.flatMap(t => (t as any).tags ?? []))).sort() as string[];

  const filtered = templates.filter(t => {
    const tags = (t as any).tags ?? [];
    const isArchived = !!t.archived;
    if (showArchived ? !isArchived : isArchived) return false;
    if (search && !t.name.toLowerCase().includes(search.toLowerCase())) return false;
    if (activeTag && !tags.includes(activeTag)) return false;
    if (bodyFilterGroup) {
      const muscleGroups = derivedMuscleGroups(t.exercises);
      const groupTags = BODY_PART_GROUPS.find(g => g.label === bodyFilterGroup)?.tags ?? [];
      if (!groupTags.some(tag => muscleGroups.includes(tag) || tags.includes(tag))) return false;
    } else if (bodyFilter) {
      const muscleGroups = derivedMuscleGroups(t.exercises);
      if (!muscleGroups.includes(bodyFilter) && !tags.includes(bodyFilter)) return false;
    }
    return true;
  });

  const sortedFiltered = [...filtered].sort((a, b) => {
    if (sortBy === 'alpha') return (a.name || '').localeCompare(b.name || '');
    if (sortBy === 'assigned') {
      const diff = (planAssignments[b.name]?.length ?? 0) - (planAssignments[a.name]?.length ?? 0);
      return diff !== 0 ? diff : new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    }
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });

  // Ordered list of exercise IDs — detects same-exercise templates even with
  // different names or different reps/weights (progressions of the same plan)
  const exerciseFingerprint = (exercises: any[]): string =>
    exercises.map((ex: any) => ex.exercise?.id ?? ex.exercise?.name ?? '').join('|');

  // Group by name first, then by exercise fingerprint for different-named templates
  const groupedFiltered: Array<{ canonical: Template; variants: Template[] }> = [];
  const nameIndex = new Map<string, number>();
  const fpIndex   = new Map<string, number>();

  for (const t of sortedFiltered) {
    const fp = exerciseFingerprint(t.exercises);

    // 1. Same name → add to existing group
    if (t.name && nameIndex.has(t.name)) {
      const idx = nameIndex.get(t.name)!;
      groupedFiltered[idx].variants.push(t);
      if (fp && !fpIndex.has(fp)) fpIndex.set(fp, idx);
      continue;
    }

    // 2. Same exercises, different name → still the same plan at a different progression
    if (fp && fpIndex.has(fp)) {
      const idx = fpIndex.get(fp)!;
      groupedFiltered[idx].variants.push(t);
      if (t.name && !nameIndex.has(t.name)) nameIndex.set(t.name, idx);
      continue;
    }

    // 3. New group
    const idx = groupedFiltered.length;
    if (t.name) nameIndex.set(t.name, idx);
    if (fp)     fpIndex.set(fp, idx);
    groupedFiltered.push({ canonical: t, variants: [] });
  }

  if (!authed || loading) {
    return (
      <SkPage>
        <SkNav />
        <main style={{ maxWidth: 900, margin: '0 auto', padding: '32px 24px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
            <Sk width={160} height={26} radius={6} />
            <Sk width={140} height={36} radius={10} />
          </div>
          <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
            <Sk width={200} height={38} radius={10} />
            {[80,90,110,80].map((w,i) => <Sk key={i} width={w} height={38} radius={999} />)}
          </div>
          {[0,1,2,3].map(i => (
            <div key={i} style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16, padding: '20px 24px', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 16 }}>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <Sk width={180} height={15} />
                <Sk width={260} height={12} radius={4} />
              </div>
              <Sk width={60} height={22} radius={999} />
              <Sk width={76} height={30} radius={8} />
            </div>
          ))}
        </main>
      </SkPage>
    );
  }

  // Preview modal helpers — computed here so they're available in JSX without an IIFE
  const previewTotalWeeks = previewTpl ? numWeeks(previewTpl.exercises) : 0;
  const getPreviewSets = (ex: any, week: number): any[] =>
    week === 1 ? (ex.sets ?? []) : (ex.weeks?.find((w: any) => w.week === week)?.sets ?? ex.sets ?? []);

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', color: 'var(--text)', fontFamily: 'sans-serif' }}>
      <main style={{ maxWidth: 1100, margin: '0 auto', padding: '40px 32px' }}>
        {/* Page header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, flexWrap: 'wrap', gap: 16 }}>
          <div>
            <h1 style={{ fontSize: 28, fontWeight: 800, margin: 0 }}>📋 Plan Library</h1>
            <p style={{ color: 'var(--text-muted)', marginTop: 6, marginBottom: 0 }}>
              {showArchived ? 'Archived templates — restore or permanently delete' : 'Reusable templates with week-by-week progression'}
            </p>
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            {templates.length > 0 && (
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search templates…"
                style={{ background: 'var(--card-alt)', border: '1px solid var(--border-strong)', borderRadius: 10, padding: '10px 16px', color: 'var(--text)', fontSize: 14, outline: 'none', width: 200 }}
              />
            )}
            {/* Sort dropdown */}
            {templates.length > 0 && (
              <div ref={sortRef} style={{ position: 'relative' }}>
                <button
                  onClick={() => setSortOpen(o => !o)}
                  style={{ background: 'var(--card-alt)', border: '1px solid var(--border-strong)', borderRadius: 10, padding: '10px 16px', color: 'var(--text-muted)', fontSize: 14, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}
                >
                  Sort: {SORT_LABELS[sortBy]} {sortOpen ? '▲' : '▼'}
                </button>
                {sortOpen && (
                  <div style={{ position: 'absolute', right: 0, top: 'calc(100% + 6px)', background: 'var(--modal-bg)', border: '1px solid var(--border-strong)', borderRadius: 12, zIndex: 300, width: 190, boxShadow: '0 8px 24px rgba(0,0,0,0.5)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                    {(Object.keys(SORT_LABELS) as SortOption[]).map(opt => (
                      <button
                        key={opt}
                        onMouseDown={() => { setSortBy(opt); setSortOpen(false); }}
                        style={{ textAlign: 'left', padding: '9px 16px', background: sortBy === opt ? 'var(--badge-teal-bg)' : 'none', border: 'none', color: sortBy === opt ? 'var(--badge-teal-text)' : 'var(--text)', fontSize: 13, fontWeight: sortBy === opt ? 700 : 400, cursor: 'pointer' }}
                        onMouseEnter={e => { if (sortBy !== opt) (e.currentTarget as HTMLButtonElement).style.background = 'var(--card-alt)'; }}
                        onMouseLeave={e => { if (sortBy !== opt) (e.currentTarget as HTMLButtonElement).style.background = 'none'; }}
                      >
                        {SORT_LABELS[opt]}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            {/* Archived toggle */}
            {templates.length > 0 && (
              <button
                onClick={() => setShowArchived(v => !v)}
                style={{ background: showArchived ? 'var(--badge-teal-bg)' : 'var(--card-alt)', border: `1px solid ${showArchived ? 'var(--btn-teal-border)' : 'var(--border-strong)'}`, borderRadius: 10, padding: '10px 16px', color: showArchived ? 'var(--badge-teal-text)' : 'var(--text-muted)', fontSize: 14, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}
              >
                🗄 Archived
              </button>
            )}
            {/* Body part filter */}
            {templates.length > 0 && (
              <div ref={bodyFilterRef} style={{ position: 'relative' }}>
                <button
                  onClick={() => setBodyFilterOpen(o => !o)}
                  style={{ background: (bodyFilter || bodyFilterGroup) ? 'var(--badge-teal-bg)' : 'var(--btn-purple-bg)', border: `1px solid ${(bodyFilter || bodyFilterGroup) ? 'var(--btn-teal-border)' : 'var(--btn-purple-border)'}`, borderRadius: 10, padding: '10px 16px', color: (bodyFilter || bodyFilterGroup) ? 'var(--badge-teal-text)' : 'var(--btn-purple-text)', fontSize: 14, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}
                >
                  {bodyFilterGroup || bodyFilter || 'Body Part'} {bodyFilterOpen ? '▲' : '▼'}
                </button>
                {bodyFilterOpen && (
                  <div
                    style={{ position: 'absolute', right: 0, top: 'calc(100% + 6px)', background: 'var(--modal-bg)', border: '1px solid var(--border-strong)', borderRadius: 12, zIndex: 300, width: 220, boxShadow: '0 8px 24px rgba(0,0,0,0.5)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
                  >
                    {/* Search inside dropdown */}
                    <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--border-subtle)' }}>
                      <input
                        autoFocus
                        value={bodySearch}
                        onChange={e => setBodySearch(e.target.value)}
                        placeholder="Search body parts…"
                        onKeyDown={e => { if (e.key === 'Escape') { setBodyFilterOpen(false); setBodySearch(''); } }}
                        style={{ width: '100%', boxSizing: 'border-box', background: 'var(--card-alt)', border: '1px solid var(--border)', borderRadius: 8, padding: '7px 10px', color: 'var(--text)', fontSize: 13, outline: 'none' }}
                      />
                    </div>
                    <button
                      onMouseDown={() => { setBodyFilter(''); setBodyFilterGroup(null); setBodyFilterOpen(false); setBodySearch(''); }}
                      style={{ textAlign: 'left', padding: '9px 16px', background: (!bodyFilter && !bodyFilterGroup) ? 'var(--badge-teal-bg)' : 'none', border: 'none', color: (!bodyFilter && !bodyFilterGroup) ? 'var(--badge-teal-text)' : 'var(--text-muted)', fontSize: 13, fontWeight: (!bodyFilter && !bodyFilterGroup) ? 700 : 400, cursor: 'pointer', borderBottom: '1px solid var(--border-subtle)' }}
                    >
                      All body parts
                    </button>
                    <div style={{ maxHeight: 260, overflowY: 'auto' }}>
                      {bodySearch ? (
                        BODY_PART_TAGS.filter(tag => tag.toLowerCase().includes(bodySearch.toLowerCase())).map(tag => (
                          <button
                            key={tag}
                            onMouseDown={() => { setBodyFilter(tag); setBodyFilterGroup(null); setBodyFilterOpen(false); setBodySearch(''); }}
                            style={{ display: 'block', width: '100%', textAlign: 'left', padding: '9px 16px', background: bodyFilter === tag ? 'var(--badge-teal-bg)' : 'none', border: 'none', color: bodyFilter === tag ? 'var(--badge-teal-text)' : 'var(--text)', fontSize: 13, fontWeight: bodyFilter === tag ? 700 : 400, cursor: 'pointer' }}
                            onMouseEnter={e => { if (bodyFilter !== tag) (e.currentTarget as HTMLButtonElement).style.background = 'var(--card-alt)'; }}
                            onMouseLeave={e => { if (bodyFilter !== tag) (e.currentTarget as HTMLButtonElement).style.background = 'none'; }}
                          >
                            {tag}
                          </button>
                        ))
                      ) : (
                        BODY_PART_GROUPS.map(group => {
                          const groupActive = bodyFilterGroup === group.label;
                          return (
                            <div key={group.label}>
                              <button
                                onMouseDown={() => { setBodyFilterGroup(group.label); setBodyFilter(''); setBodyFilterOpen(false); setBodySearch(''); }}
                                title={`Show all ${group.label} plans`}
                                style={{ display: 'block', width: '100%', textAlign: 'left', padding: '7px 16px 5px', fontSize: 10, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: groupActive ? 'var(--badge-teal-text)' : 'var(--text-dim)', background: groupActive ? 'var(--badge-teal-bg)' : 'none', border: 'none', borderTop: '1px solid var(--border-subtle)', cursor: 'pointer' }}
                                onMouseEnter={e => { if (!groupActive) (e.currentTarget as HTMLButtonElement).style.background = 'var(--card-alt)'; }}
                                onMouseLeave={e => { if (!groupActive) (e.currentTarget as HTMLButtonElement).style.background = 'none'; }}
                              >
                                {group.label}
                              </button>
                              {group.tags.map(tag => (
                                <button
                                  key={tag}
                                  onMouseDown={() => { setBodyFilter(tag); setBodyFilterGroup(null); setBodyFilterOpen(false); setBodySearch(''); }}
                                  style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 16px 8px 24px', background: bodyFilter === tag ? 'var(--badge-teal-bg)' : 'none', border: 'none', color: bodyFilter === tag ? 'var(--badge-teal-text)' : 'var(--text)', fontSize: 13, fontWeight: bodyFilter === tag ? 700 : 400, cursor: 'pointer' }}
                                  onMouseEnter={e => { if (bodyFilter !== tag) (e.currentTarget as HTMLButtonElement).style.background = 'var(--card-alt)'; }}
                                  onMouseLeave={e => { if (bodyFilter !== tag) (e.currentTarget as HTMLButtonElement).style.background = 'none'; }}
                                >
                                  {tag}
                                </button>
                              ))}
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
            <button
              onClick={handleCreate}
              disabled={creating}
              style={{ background: TEAL, color: '#0f1117', borderRadius: 10, padding: '10px 22px', fontWeight: 700, fontSize: 14, border: 'none', cursor: creating ? 'not-allowed' : 'pointer', opacity: creating ? 0.7 : 1 }}
            >
              {creating ? 'Creating…' : '+ Create Plan'}
            </button>
          </div>
        </div>

        {/* Upcoming reminders */}
        {reminders.length > 0 && (
          <div style={{ marginTop: 20, marginBottom: 4, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <p style={{ margin: '0 0 4px', fontSize: 12, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-dim)' }}>
              Upcoming Reminders
            </p>
            {reminders.map(r => (
              <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 12, background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: '12px 16px' }}>
                <span style={{ fontSize: 18 }}>🔔</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--text)' }}>
                    {r.plan_name}
                  </span>
                  <span style={{ color: 'var(--text-muted)', fontSize: 13 }}> · {r.patient_name}</span>
                  {r.note && <span style={{ color: 'var(--text-dim)', fontSize: 12, marginLeft: 8 }}>{r.note}</span>}
                </div>
                <span style={{ fontSize: 12, color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>
                  {new Date(r.remind_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}{' '}
                  {new Date(r.remind_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                </span>
                <button
                  onClick={() => dismissReminder(r.id)}
                  style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 16, padding: '0 4px', lineHeight: 1 }}
                  title="Dismiss reminder"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Tag filter chips — only shown when at least one template has tags */}
        {allTags.length > 0 && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 16, marginBottom: 4 }}>
            <button
              onClick={() => setActiveTag(null)}
              style={{
                padding: '5px 14px', borderRadius: 999, fontSize: 12, fontWeight: 700,
                border: `1px solid ${!activeTag ? 'var(--btn-teal-border)' : 'var(--border-strong)'}`,
                background: !activeTag ? 'var(--badge-teal-bg)' : 'transparent',
                color: !activeTag ? 'var(--badge-teal-text)' : 'var(--text-muted)',
                cursor: 'pointer',
              }}
            >
              All
            </button>
            {allTags.map(tag => (
              <button
                key={tag}
                onClick={() => setActiveTag(activeTag === tag ? null : tag)}
                style={{
                  padding: '5px 14px', borderRadius: 999, fontSize: 12, fontWeight: 700,
                  border: `1px solid ${activeTag === tag ? 'var(--btn-teal-border)' : 'var(--border-strong)'}`,
                  background: activeTag === tag ? 'var(--badge-teal-bg)' : 'transparent',
                  color: activeTag === tag ? 'var(--badge-teal-text)' : 'var(--text-muted)',
                  cursor: 'pointer',
                }}
              >
                {tag}
              </button>
            ))}
          </div>
        )}

        {/* Empty state */}
        {templates.length === 0 ? (
          <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 20, padding: 60, textAlign: 'center', marginTop: 32 }}>
            <p style={{ fontSize: 40, marginBottom: 16 }}>📋</p>
            <p style={{ color: 'var(--text-muted)', marginBottom: 24 }}>
              No templates yet. Create your first reusable plan template.
            </p>
            <button
              onClick={handleCreate}
              disabled={creating}
              style={{ background: TEAL, color: '#0f1117', borderRadius: 12, padding: '12px 28px', fontWeight: 700, fontSize: 15, border: 'none', cursor: 'pointer' }}
            >
              {creating ? 'Creating…' : 'Create First Plan'}
            </button>
          </div>
        ) : filtered.length === 0 ? (
          <p style={{ color: 'var(--text-dim)', marginTop: 40, textAlign: 'center' }}>
            {showArchived ? 'No archived templates.' : `No templates match "${search}"`}
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 28 }}>
            {groupedFiltered.map(({ canonical: t, variants }) => {
              const allVersions = [t, ...variants];
              const isGrouped = variants.length > 0;
              const weeks = numWeeks(t.exercises);
              // For preview, show the version with the most weeks (most complete progression)
              const bestPreview = allVersions.reduce((best, curr) =>
                numWeeks(curr.exercises) >= numWeeks(best.exercises) ? curr : best
              );
              return (
                <div
                  key={t.id}
                  onClick={() => { setPreviewWeek(1); setPreviewTpl(bestPreview); }}
                  style={{ position: 'relative', background: hoveredId === t.id ? 'var(--border-subtle)' : 'var(--card)', border: `1px solid ${hoveredId === t.id ? 'rgba(95,207,191,0.3)' : 'var(--border)'}`, borderRadius: 16, padding: '20px 24px', display: 'flex', alignItems: 'center', gap: 20, transition: 'background 0.15s, border-color 0.15s', cursor: 'pointer', opacity: t.archived ? 0.6 : 1 }}
                  onMouseEnter={() => setHoveredId(t.id)}
                  onMouseLeave={() => setHoveredId(null)}
                >
                  {/* Hover preview panel */}
                  {hoveredId === t.id && t.exercises.length > 0 && (
                    <div style={{
                      position: 'absolute', right: 'calc(100% + 12px)', top: 0,
                      width: 240, background: 'var(--modal-bg)', border: '1px solid var(--border-strong)',
                      borderRadius: 12, padding: '14px 16px', zIndex: 50,
                      boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
                      pointerEvents: 'none',
                    }}>
                      <p style={{ margin: '0 0 10px', fontWeight: 700, fontSize: 13, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                        {t.exercises.length} exercise{t.exercises.length !== 1 ? 's' : ''}
                      </p>
                      {t.exercises.slice(0, 8).map((ex: any, i: number) => (
                        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', borderBottom: i < Math.min(t.exercises.length, 8) - 1 ? '1px solid var(--border-subtle)' : 'none' }}>
                          <span style={{ color: 'var(--text)', fontSize: 13, fontWeight: 500 }}>{ex.exercise?.name ?? '—'}</span>
                          <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>{ex.sets?.length ?? 0} sets</span>
                        </div>
                      ))}
                      {t.exercises.length > 8 && (
                        <p style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--text-dim)' }}>+{t.exercises.length - 8} more…</p>
                      )}
                    </div>
                  )}
                  {/* Info */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {/* Row 1: name + exercise count + single-template week previews */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 700, fontSize: 16, color: t.name ? 'var(--text)' : 'var(--text-faint)', fontStyle: t.name ? 'normal' : 'italic' }}>
                        {t.name || 'Untitled template'}
                      </span>
                      {t.archived && (
                        <span style={{ background: 'var(--card-alt)', color: 'var(--text-dim)', fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 999, border: '1px solid var(--border-strong)' }}>
                          Archived
                        </span>
                      )}
                      <span style={{ background: 'var(--badge-teal-bg)', color: 'var(--badge-teal-text)', fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 999 }}>
                        {t.exercises.length} exercise{t.exercises.length !== 1 ? 's' : ''}
                      </span>
                      {!isGrouped && Array.from({ length: weeks }, (_, i) => i + 1).map(w => (
                        <button
                          key={w}
                          onClick={e => { e.stopPropagation(); setPreviewTpl(t); setPreviewWeek(w); }}
                          style={{ background: 'var(--btn-purple-bg)', color: 'var(--btn-purple-text)', fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 999, border: '1px solid var(--btn-purple-border)', cursor: 'pointer' }}
                          title={`Preview Week ${w}`}
                        >
                          W{w}
                        </button>
                      ))}
                    </div>
                    {/* Row 2: version selectors — only for grouped templates, below exercise count */}
                    {isGrouped && (
                      <div style={{ display: 'flex', gap: 6, marginTop: 7, flexWrap: 'wrap' }}>
                        {allVersions.map(v => {
                          const vWeeks = numWeeks(v.exercises);
                          const tooltipName = v.name && v.name !== t.name ? v.name : undefined;
                          return (
                            <button
                              key={v.id}
                              onClick={e => { e.stopPropagation(); router.push(`/plans/library/${v.id}`); }}
                              style={{ background: 'var(--btn-red-bg)', color: 'var(--btn-red-text)', fontSize: 11, fontWeight: 700, padding: '3px 11px', borderRadius: 999, border: '1px solid var(--btn-red-border)', cursor: 'pointer' }}
                              title={tooltipName ? `Week ${vWeeks} — ${tooltipName}` : `View / Edit Week ${vWeeks} version`}
                            >
                              Week {vWeeks} →
                            </button>
                          );
                        })}
                      </div>
                    )}
                    {t.description && (
                      <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: '6px 0 0 0' }}>{t.description}</p>
                    )}
                    {/* Derived muscle group chips */}
                    {(() => {
                      const muscleGroups = derivedMuscleGroups(t.exercises);
                      return muscleGroups.length > 0 ? (
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                          {muscleGroups.map((mg: string) => (
                            <span
                              key={mg}
                              onClick={e => { e.stopPropagation(); setBodyFilterGroup(null); setBodyFilter(bodyFilter === mg ? '' : mg); }}
                              style={{ padding: '2px 10px', borderRadius: 999, fontSize: 11, fontWeight: 600, background: 'var(--card-alt)', color: 'var(--text-muted)', cursor: 'pointer', border: bodyFilter === mg ? `1px solid ${TEAL}` : '1px solid transparent' }}
                            >
                              {mg}
                            </span>
                          ))}
                        </div>
                      ) : null;
                    })()}
                    {/* Assigned patients */}
                    {(planAssignments[t.name] ?? []).length > 0 && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>Assigned to</span>
                        {(planAssignments[t.name] ?? []).map(a => (
                          <span
                            key={a.planId}
                            style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 8px 3px 10px', borderRadius: 999, fontSize: 11, fontWeight: 600, background: 'var(--badge-teal-bg)', color: 'var(--badge-teal-text)', border: '1px solid var(--btn-teal-border)', flexWrap: 'wrap' }}
                          >
                            {a.patientName}
                            {a.weeks.map(w => (
                              <span key={w} style={{ background: `${PURPLE}25`, color: PURPLE, fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 999 }}>W{w}</span>
                            ))}
                            {deriveWeekList(t.exercises).length > 1 && (
                              <button
                                onClick={e => { e.stopPropagation(); setEditingAssignment({ planId: a.planId, planName: t.name, patientName: a.patientName, weeks: a.weeks, exercisesRaw: a.exercisesRaw, templateId: t.id, availableWeeks: deriveWeekList(t.exercises) }); setEditingAssWeeks([...a.weeks]); }}
                                style={{ background: `${PURPLE}30`, border: `1px solid ${PURPLE}60`, color: PURPLE, borderRadius: 6, padding: '1px 6px', fontSize: 10, fontWeight: 700, cursor: 'pointer' }}
                                title={`Edit weeks shared with this ${isEmployer ? 'employee' : 'patient'}`}
                              >
                                Edit
                              </button>
                            )}
                            <button
                              onClick={e => { e.stopPropagation(); handleUnassign(a.planId, t.name); }}
                              disabled={unassigning === a.planId}
                              style={{ background: 'none', border: 'none', color: 'inherit', cursor: unassigning === a.planId ? 'not-allowed' : 'pointer', padding: '0 0 0 2px', fontSize: 14, lineHeight: 1, opacity: unassigning === a.planId ? 0.4 : 0.7 }}
                              title={`Un-assign this ${isEmployer ? 'employee' : 'patient'}`}
                            >
                              ×
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                    <p style={{ color: 'var(--text-faint)', fontSize: 12, margin: '4px 0 0 0' }}>
                      Created {new Date(t.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </p>
                  </div>

                  {/* Actions */}
                  <div onClick={e => e.stopPropagation()} style={{ display: 'flex', gap: 8, flexShrink: 0, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                    {!isGrouped && (
                      <button
                        onClick={() => router.push(`/plans/library/${t.id}`)}
                        style={{ background: 'var(--btn-teal-bg)', color: 'var(--btn-teal-text)', border: '1px solid var(--btn-teal-border)', borderRadius: 8, padding: '8px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
                      >
                        View / Edit
                      </button>
                    )}
                    {!t.archived && (
                      <button
                        onClick={() => openAssign(t)}
                        style={{ background: 'var(--btn-purple-bg)', color: 'var(--btn-purple-text)', border: '1px solid var(--btn-purple-border)', borderRadius: 8, padding: '8px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
                      >
                        Assign to {isEmployer ? 'Employee' : 'Patient'}
                      </button>
                    )}
                    {isGrouped ? (
                      // Archive + Delete per version
                      allVersions.map(v => (
                        <div key={v.id} style={{ display: 'flex', gap: 6 }}>
                          <button
                            onClick={() => handleArchive(v, !v.archived)}
                            disabled={archiving === v.id}
                            style={{ background: 'var(--card-alt)', color: 'var(--text-muted)', border: '1px solid var(--border-strong)', borderRadius: 8, padding: '8px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer', opacity: archiving === v.id ? 0.5 : 1 }}
                          >
                            {v.archived ? `Restore ${numWeeks(v.exercises)}wk` : `Archive ${numWeeks(v.exercises)}wk`}
                          </button>
                          <button
                            onClick={() => handleDelete(v)}
                            disabled={deleting === v.id}
                            style={{ background: 'var(--btn-red-bg)', color: 'var(--btn-red-text)', border: '1px solid var(--btn-red-border)', borderRadius: 8, padding: '8px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer', opacity: deleting === v.id ? 0.5 : 1 }}
                          >
                            Del {numWeeks(v.exercises)}wk
                          </button>
                        </div>
                      ))
                    ) : (
                      <>
                        <button
                          onClick={() => handleArchive(t, !t.archived)}
                          disabled={archiving === t.id}
                          style={{ background: 'var(--card-alt)', color: 'var(--text-muted)', border: '1px solid var(--border-strong)', borderRadius: 8, padding: '8px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer', opacity: archiving === t.id ? 0.5 : 1 }}
                        >
                          {t.archived ? 'Restore' : 'Archive'}
                        </button>
                        <button
                          onClick={() => handleDelete(t)}
                          disabled={deleting === t.id}
                          style={{ background: 'var(--btn-red-bg)', color: 'var(--btn-red-text)', border: '1px solid var(--btn-red-border)', borderRadius: 8, padding: '8px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer', opacity: deleting === t.id ? 0.5 : 1 }}
                        >
                          Delete
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      {/* Template preview modal */}
      {previewTpl && (
        <div
          onClick={() => setPreviewTpl(null)}
          onKeyDown={e => { if (e.key === 'Escape') setPreviewTpl(null); }}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 24 }}
        >
          <div onClick={e => e.stopPropagation()} style={{ background: 'var(--modal-bg)', border: '1px solid var(--border)', borderRadius: 20, width: '100%', maxWidth: 560, maxHeight: 'calc(100vh - 80px)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            {/* Header */}
            <div style={{ padding: '24px 28px 16px', borderBottom: '1px solid var(--border-subtle)' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
                <div>
                  <h2 style={{ fontWeight: 800, fontSize: 20, margin: '0 0 6px' }}>
                    {previewTpl.name || 'Untitled template'}
                  </h2>
                  {previewTpl.description && (
                    <p style={{ color: 'var(--text-muted)', fontSize: 14, margin: '0 0 6px' }}>{previewTpl.description}</p>
                  )}
                  <span style={{ background: 'var(--badge-teal-bg)', color: 'var(--badge-teal-text)', fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 999 }}>
                    {previewTpl.exercises.length} exercise{previewTpl.exercises.length !== 1 ? 's' : ''}
                  </span>
                </div>
                <button onClick={() => setPreviewTpl(null)} style={{ background: 'var(--card-alt)', border: 'none', color: 'var(--text-muted)', borderRadius: 8, width: 32, height: 32, fontSize: 18, cursor: 'pointer', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
              </div>
              {/* Week tabs — only shown for multi-week templates */}
              {previewTotalWeeks > 1 && (
                <div style={{ display: 'flex', gap: 6 }}>
                  {Array.from({ length: previewTotalWeeks }, (_, i) => i + 1).map(w => (
                    <button key={w} onClick={() => setPreviewWeek(w)} style={{ padding: '5px 14px', borderRadius: 8, fontSize: 13, fontWeight: 700, border: `1px solid ${previewWeek === w ? 'var(--btn-purple-border)' : 'var(--border-strong)'}`, background: previewWeek === w ? 'var(--badge-purple-bg)' : 'transparent', color: previewWeek === w ? 'var(--badge-purple-text)' : 'var(--text-muted)', cursor: 'pointer' }}>
                      Week {w}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Exercise list for selected week */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '16px 28px' }}>
              {previewTpl.exercises.length === 0 ? (
                <p style={{ color: 'var(--text-dim)', fontSize: 14, textAlign: 'center', padding: '24px 0' }}>No exercises added yet.</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {previewTpl.exercises.map((ex: any, i: number) => {
                    const sets = getPreviewSets(ex, previewWeek);
                    const reps = sets[0]?.reps;
                    const secs = sets[0]?.seconds;
                    return (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', borderBottom: i < previewTpl.exercises.length - 1 ? '1px solid var(--border-subtle)' : 'none' }}>
                        <div>
                          <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>{i + 1}. {ex.exercise?.name ?? '—'}</span>
                          {ex.exercise?.muscleGroup && (
                            <span style={{ fontSize: 12, color: 'var(--text-dim)', marginLeft: 8 }}>{ex.exercise.muscleGroup}</span>
                          )}
                        </div>
                        <span style={{ fontSize: 12, color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>
                          {sets.length} sets
                          {reps !== undefined ? ` · ${reps} reps` : ''}
                          {secs !== undefined ? ` · ${secs}s` : ''}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Footer actions */}
            <div style={{ padding: '16px 28px', borderTop: '1px solid var(--border-subtle)', display: 'flex', gap: 10 }}>
              <button
                onClick={() => router.push(`/plans/library/${previewTpl.id}`)}
                style={{ flex: 1, background: 'var(--btn-teal-bg)', color: 'var(--btn-teal-text)', border: '1px solid var(--btn-teal-border)', borderRadius: 10, padding: '11px 0', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}
              >
                View / Edit
              </button>
              <button
                onClick={() => { setPreviewTpl(null); openAssign(previewTpl); }}
                style={{ flex: 1, background: PURPLE, color: 'var(--text)', border: 'none', borderRadius: 10, padding: '11px 0', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}
              >
                Assign to {isEmployer ? 'Employee' : 'Patient'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Assign to Patient/Employee modal */}
      {assignTpl && (
        <div
          onClick={() => { if (!assigning) setAssignTpl(null); }}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200, padding: 24 }}
        >
          <div onClick={e => e.stopPropagation()} style={{ background: 'var(--modal-bg)', border: '1px solid var(--border)', borderRadius: 20, width: '100%', maxWidth: 500, maxHeight: 'calc(100vh - 80px)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            {/* Header */}
            <div style={{ padding: '22px 28px 18px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
              <div>
                <h2 style={{ fontWeight: 800, fontSize: 18, margin: '0 0 4px' }}>Assign to {isEmployer ? 'Employee' : 'Patient'}</h2>
                <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: 0 }}>{assignTpl.name || 'Untitled template'}</p>
              </div>
              <button onClick={() => setAssignTpl(null)} style={{ background: 'var(--card-alt)', border: 'none', color: 'var(--text-muted)', borderRadius: 8, width: 32, height: 32, fontSize: 18, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>×</button>
            </div>

            {/* Body */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '20px 28px', display: 'flex', flexDirection: 'column', gap: 18 }}>

              {/* Plan name */}
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Plan Name</label>
                <input
                  value={assignPlanName}
                  onChange={e => setAssignPlanName(e.target.value)}
                  placeholder="Plan name…"
                  style={{ width: '100%', boxSizing: 'border-box', background: 'var(--card-alt)', border: '1px solid var(--border-strong)', borderRadius: 10, padding: '10px 14px', color: 'var(--text)', fontSize: 14, outline: 'none' }}
                />
              </div>

              {/* Patient */}
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{isEmployer ? 'Employee' : 'Patient'}</label>
                <select
                  value={assignPatientId}
                  onChange={e => setAssignPatientId(e.target.value)}
                  style={{ width: '100%', boxSizing: 'border-box', background: 'var(--card-alt)', border: '1px solid var(--border-strong)', borderRadius: 10, padding: '10px 14px', color: assignPatientId ? 'var(--text)' : 'var(--text-muted)', fontSize: 14, outline: 'none', cursor: 'pointer' }}
                >
                  <option value="">{isEmployer ? 'Select an employee…' : 'Select a patient…'}</option>
                  {patients.map(p => (
                    <option key={p.id} value={p.id}>{p.display_name}</option>
                  ))}
                </select>
                {patients.length === 0 && (
                  <p style={{ color: 'var(--text-dim)', fontSize: 12, margin: '6px 0 0' }}>{isEmployer ? 'No linked employees found.' : 'No linked patients found.'}</p>
                )}
              </div>

              {/* Week selection — only if multi-week */}
              {numWeeks(assignTpl.exercises) > 1 && (
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    Weeks to Assign
                    <span style={{ fontWeight: 400, marginLeft: 6, textTransform: 'none', letterSpacing: 0 }}>— select one or more</span>
                  </label>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {Array.from({ length: numWeeks(assignTpl.exercises) }, (_, i) => i + 1).map(w => {
                      const active = assignWeeks.includes(w);
                      return (
                        <button
                          key={w}
                          onClick={() => setAssignWeeks(prev => active ? prev.filter(x => x !== w) : [...prev, w].sort((a, b) => a - b))}
                          style={{ padding: '7px 18px', borderRadius: 999, fontSize: 13, fontWeight: 700, border: `1px solid ${active ? 'var(--btn-purple-border)' : 'var(--border-strong)'}`, background: active ? 'var(--badge-purple-bg)' : 'transparent', color: active ? 'var(--badge-purple-text)' : 'var(--text-muted)', cursor: 'pointer' }}
                        >
                          Week {w}
                        </button>
                      );
                    })}
                  </div>
                  {assignWeeks.length === 0 && (
                    <p style={{ color: 'var(--text-dim)', fontSize: 12, margin: '6px 0 0' }}>Select at least one week.</p>
                  )}
                </div>
              )}

              {/* Reminder */}
              <div style={{ background: 'var(--card-alt)', borderRadius: 12, padding: '14px 16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div>
                    <p style={{ margin: 0, fontWeight: 700, fontSize: 14 }}>Set a Reminder</p>
                    <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--text-muted)' }}>Get reminded to update this {isEmployer ? 'employee' : 'patient'}'s plan</p>
                  </div>
                  <button
                    onClick={() => setAssignReminder(v => !v)}
                    style={{ width: 42, height: 24, borderRadius: 999, border: 'none', cursor: 'pointer', background: assignReminder ? TEAL : 'var(--border-strong)', transition: 'background 0.2s', position: 'relative', flexShrink: 0 }}
                  >
                    <span style={{ position: 'absolute', top: 3, left: assignReminder ? 21 : 3, width: 18, height: 18, borderRadius: '50%', background: 'white', transition: 'left 0.2s' }} />
                  </button>
                </div>
                {assignReminder && (
                  <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <div style={{ display: 'flex', gap: 10 }}>
                      <div style={{ flex: 1 }}>
                        <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--text-dim)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Date</label>
                        <input
                          type="date"
                          value={assignRemindDate}
                          onChange={e => setAssignRemindDate(e.target.value)}
                          min={new Date().toISOString().split('T')[0]}
                          style={{ width: '100%', boxSizing: 'border-box', background: 'var(--card)', border: '1px solid var(--border-strong)', borderRadius: 8, padding: '8px 10px', color: 'var(--text)', fontSize: 13, outline: 'none' }}
                        />
                      </div>
                      <div style={{ flex: 1 }}>
                        <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--text-dim)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Time</label>
                        <input
                          type="time"
                          value={assignRemindTime}
                          onChange={e => setAssignRemindTime(e.target.value)}
                          style={{ width: '100%', boxSizing: 'border-box', background: 'var(--card)', border: '1px solid var(--border-strong)', borderRadius: 8, padding: '8px 10px', color: 'var(--text)', fontSize: 13, outline: 'none' }}
                        />
                      </div>
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--text-dim)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Note (optional)</label>
                      <input
                        value={assignRemindNote}
                        onChange={e => setAssignRemindNote(e.target.value)}
                        placeholder="e.g. Advance to Week 3"
                        style={{ width: '100%', boxSizing: 'border-box', background: 'var(--card)', border: '1px solid var(--border-strong)', borderRadius: 8, padding: '8px 10px', color: 'var(--text)', fontSize: 13, outline: 'none' }}
                      />
                    </div>
                  </div>
                )}
              </div>

              {assignError && (
                <p style={{ margin: 0, color: '#f87171', fontSize: 13, fontWeight: 600 }}>{assignError}</p>
              )}
            </div>

            {/* Footer */}
            <div style={{ padding: '16px 28px', borderTop: '1px solid var(--border-subtle)', display: 'flex', gap: 10 }}>
              <button
                onClick={() => setAssignTpl(null)}
                disabled={assigning}
                style={{ flex: 1, background: 'var(--card-alt)', border: '1px solid var(--border-strong)', color: 'var(--text-muted)', borderRadius: 10, padding: '11px 0', fontSize: 14, fontWeight: 700, cursor: 'pointer', opacity: assigning ? 0.5 : 1 }}
              >
                Cancel
              </button>
              <button
                onClick={handleAssign}
                disabled={assigning || assignSuccess || assignWeeks.length === 0}
                style={{ flex: 2, background: assignSuccess ? TEAL : PURPLE, color: assignSuccess ? '#0f1117' : 'var(--text)', border: 'none', borderRadius: 10, padding: '11px 0', fontSize: 14, fontWeight: 700, cursor: assigning || assignWeeks.length === 0 ? 'not-allowed' : 'pointer', opacity: assigning || assignWeeks.length === 0 ? 0.6 : 1 }}
              >
                {assignSuccess ? '✓ Assigned!' : assigning ? 'Assigning…' : 'Assign Plan'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Assignment Weeks modal */}
      {editingAssignment && (
        <div
          onClick={() => { if (!savingAssWeeks) setEditingAssignment(null); }}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 300, padding: 24 }}
        >
          <div onClick={e => e.stopPropagation()} style={{ background: 'var(--modal-bg)', border: '1px solid var(--border)', borderRadius: 20, width: '100%', maxWidth: 420, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ padding: '22px 28px 18px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
              <div>
                <h2 style={{ fontWeight: 800, fontSize: 18, margin: '0 0 4px' }}>Edit Weeks</h2>
                <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: 0 }}>{editingAssignment.patientName}</p>
              </div>
              <button onClick={() => setEditingAssignment(null)} style={{ background: 'var(--card-alt)', border: 'none', color: 'var(--text-muted)', borderRadius: 8, width: 32, height: 32, fontSize: 18, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>×</button>
            </div>
            <div style={{ padding: '20px 28px', display: 'flex', flexDirection: 'column', gap: 16 }}>
              <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>
                Select which weeks to share with this {isEmployer ? 'employee' : 'patient'}. Currently assigned: {editingAssignment.weeks.map(w => `W${w}`).join(', ')}.
              </p>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {editingAssignment.availableWeeks.map(w => {
                  const on = editingAssWeeks.includes(w);
                  return (
                    <button
                      key={w}
                      onClick={() => setEditingAssWeeks(prev => on ? prev.filter(x => x !== w) : [...prev, w].sort((a, b) => a - b))}
                      style={{ padding: '8px 20px', borderRadius: 10, fontWeight: 700, fontSize: 14, cursor: 'pointer', border: `2px solid ${on ? PURPLE : 'var(--border-strong)'}`, background: on ? `${PURPLE}25` : 'transparent', color: on ? PURPLE : 'var(--text-muted)', transition: 'all 0.15s' }}
                    >
                      Week {w}
                    </button>
                  );
                })}
              </div>
              {editingAssWeeks.length === 0 && (
                <p style={{ margin: 0, fontSize: 12, color: '#f87171', fontWeight: 600 }}>
                  Select at least one week.
                </p>
              )}
            </div>
            <div style={{ padding: '16px 28px', borderTop: '1px solid var(--border-subtle)', display: 'flex', gap: 10 }}>
              <button
                onClick={() => setEditingAssignment(null)}
                disabled={savingAssWeeks}
                style={{ flex: 1, background: 'var(--card-alt)', border: '1px solid var(--border-strong)', color: 'var(--text-muted)', borderRadius: 10, padding: '11px 0', fontSize: 14, fontWeight: 700, cursor: 'pointer', opacity: savingAssWeeks ? 0.5 : 1 }}
              >
                Cancel
              </button>
              <button
                onClick={handleSaveAssWeeks}
                disabled={savingAssWeeks || editingAssWeeks.length === 0}
                style={{ flex: 2, background: PURPLE, color: 'var(--text)', border: 'none', borderRadius: 10, padding: '11px 0', fontSize: 14, fontWeight: 700, cursor: savingAssWeeks || editingAssWeeks.length === 0 ? 'not-allowed' : 'pointer', opacity: savingAssWeeks || editingAssWeeks.length === 0 ? 0.6 : 1 }}
              >
                {savingAssWeeks ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
