'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { getSupabase } from '@/lib/supabase';
import ScheduleModal from './ScheduleModal';
import { DayPicker } from 'react-day-picker';
import type { DateRange } from 'react-day-picker';
import 'react-day-picker/style.css';
import { addMonths, startOfMonth, format } from 'date-fns';

const TEAL   = '#5fcfbf';
const PURPLE = '#C471ED';
const AMBER  = '#F59E0B';
const MASTER_ID = process.env.NEXT_PUBLIC_FEATURED_PRACTITIONER_ID || '969ea6c6-ba6d-4ee4-8bb8-a7cee267f40c';

interface Program {
  template_id:             string;
  template_name:           string;
  template_description:    string | null;
  featured_duration_days:  number | null;
  employer_count:          number;
  catalog_available_from:  string | null;
  catalog_available_until: string | null;
}

interface ProgramRating {
  plan_name:         string;
  avg_effectiveness: number | null;
  avg_enjoyment:     number | null;
  avg_satisfaction:  number | null;
  rating_count:      number;
  completed_count:   number;
  total_count:       number;
}

interface DayRating {
  plan_name:         string;
  day_id:            string;
  day_label:         string | null;
  day_order:         number | null;
  avg_effectiveness: number | null;
  avg_enjoyment:     number | null;
  rating_count:      number;
}

interface TrendRow {
  plan_name:     string;
  week_number:   number;
  workout_count: number;
}

interface ParsedPreview {
  name:          string;
  description:   string;
  duration:      string;
  exerciseCount: number;
  raw:           any;
}

function sanitizeJson(raw: string): string {
  let text = raw.trim().replace(/[﻿​‌‍]/g, '');
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced) text = fenced[1].trim();
  const start = text.indexOf('{');
  const end   = text.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) text = text.slice(start, end + 1);
  return text
    .replace(/[""]/g, '"').replace(/['']/g, "'")
    .replace(/[–—]/g, '-').replace(/[ ]/g, ' ')
    .replace(/,(\s*[}\]])/g, '$1');
}

function parseExercises(rawExercises: any[]): any[] {
  const FORCE_REPS     = ['dead bug', 'deadbug', 'bird dog', 'birddog'];
  const PER_SIDE_NAMES = ['dead bug', 'deadbug', 'bird dog', 'birddog'];
  return rawExercises.map((ex: any) => {
    const nameLC   = String(ex.exercise?.name ?? '').toLowerCase();
    const notesLC  = String(ex.practitionerNotes ?? ex.notes ?? '').toLowerCase();
    const forceReps = FORCE_REPS.some(n => nameLC.includes(n));
    const isSplitName =
      PER_SIDE_NAMES.some(n => nameLC.includes(n)) ||
      ['per side','each side','single leg','single arm','single-leg','single-arm'].some(p => nameLC.includes(p) || notesLC.includes(p));
    const rawType = forceReps ? 'weighted' : String(ex.exercise?.type ?? 'weighted');
    // Desk-friendly cardio: has cardioduration but no treadmill fields → store as duration (seconds)
    const isDesktopCardio = rawType === 'cardio' && Array.isArray(ex.sets) &&
      ex.sets.length > 0 && ex.sets.every((s: any) => s.cardioduration != null && !(s.speed > 0) && !(s.distance > 0) && !(s.incline > 0));
    const exType = isDesktopCardio ? 'duration' : rawType;
    const sets = Array.isArray(ex.sets) ? ex.sets.map((s: any) => {
      const base: any = { ...s, id: crypto.randomUUID() };
      const split = base.isSplit || isSplitName;
      if (split) {
        base.isSplit = true;
        if (base.leftReps === undefined && base.reps !== undefined) { base.leftReps = base.reps; base.rightReps = base.reps; delete base.reps; }
        if (exType === 'duration' && base.leftDuration === undefined && base.duration !== undefined) { base.leftDuration = base.duration; base.rightDuration = base.duration; delete base.duration; }
      }
      if (isDesktopCardio && base.cardioduration != null) {
        base.duration = base.cardioduration;
        delete base.cardioduration; delete base.cardioSeconds;
        delete base.speed; delete base.incline; delete base.distance;
      }
      if (exType === 'weighted' && base.duration !== undefined && base.reps === undefined && base.leftReps === undefined) {
        if (split) { base.leftReps = 10; base.rightReps = 10; } else { base.reps = 10; }
        delete base.duration;
      }
      if (exType === 'duration' && (base.duration === undefined || base.duration === 0) && base.reps !== undefined && base.reps > 0) {
        base.duration = base.reps; delete base.reps; delete base.weight;
      }
      return base;
    }) : [];
    const exercise = forceReps && ex.exercise
      ? { ...ex.exercise, type: 'weighted' }
      : isDesktopCardio && ex.exercise
        ? { ...ex.exercise, type: 'duration' }
        : ex.exercise;
    const effectiveNotes = ex.practitionerNotes || ex.notes || '';
    return { ...ex, id: crypto.randomUUID(), sets, exercise, practitionerNotes: effectiveNotes, notes: '' };
  });
}

function countExercises(parsed: any): number {
  if (Array.isArray(parsed.exercises)) return parsed.exercises.length;
  if (Array.isArray(parsed.days)) {
    return parsed.days.reduce((sum: number, d: any) =>
      sum + (Array.isArray(d.sessions) ? d.sessions.reduce((s2: number, sess: any) =>
        s2 + (Array.isArray(sess.exercises) ? sess.exercises.length : 0), 0) : 0), 0);
  }
  return 0;
}

function structureExercises(parsed: any): any {
  // Flat exercises array → keep as flat array (simple single-session plan)
  if (Array.isArray(parsed.exercises)) {
    return parseExercises(parsed.exercises);
  }
  // Days structure → convert to mobile-expected { days, frequencyPerWeek } format
  if (Array.isArray(parsed.days)) {
    const days = parsed.days.map((day: any, idx: number) => {
      let exercises: any[] = [];
      if (Array.isArray(day.sessions)) {
        for (const sess of day.sessions)
          if (Array.isArray(sess.exercises)) exercises.push(...parseExercises(sess.exercises));
      } else if (Array.isArray(day.exercises)) {
        exercises = parseExercises(day.exercises);
      }
      return {
        id:       day.id ?? crypto.randomUUID(),
        label:    day.name ?? day.label ?? `Day ${idx + 1}`,
        exercises,
      };
    });
    return { days, frequencyPerWeek: days.length };
  }
  return [];
}

function tryParsePreview(text: string): ParsedPreview | null {
  try {
    const parsed = JSON.parse(sanitizeJson(text));
    const count = countExercises(parsed);
    if (!count) return null;
    return {
      name:          String(parsed.name ?? ''),
      description:   String(parsed.description ?? ''),
      duration:      parsed.featured_duration_days ? String(parsed.featured_duration_days) : '30',
      exerciseCount: count,
      raw:           parsed,
    };
  } catch {
    return null;
  }
}

const IMPORT_PROMPT = `Generate a corporate wellness workout in JSON. This is a SHORT desk-friendly routine (≈5 minutes, no equipment) that employees complete 1–3 times throughout their workday.

Use this exact JSON format:

{
  "name": "Program Name",
  "description": "One-sentence description shown to employees",
  "featured_duration_days": 30,
  "exercises": [ ...exercises... ]
}

Each exercise object:
{
  "id": "ex1",
  "exercise": { "id": "ex1", "name": "Exercise Name", "muscleGroup": "Core", "equipment": "Bodyweight", "type": "weighted" },
  "sets": [ { "id": "set1", "weight": 0, "reps": 10, "unit": "kg" } ],
  "practitionerNotes": "1–2 sentence form cue. Modification: easier/seated/low-impact alternative for those with physical limitations."
}

── PRACTITIONER NOTES RULES ──
Every exercise MUST have practitionerNotes with exactly two parts:
1. Form cue: 1–2 sentences on how to do the movement correctly (posture, breathing, range of motion).
2. Modification line starting with "Modification:" — a simpler or seated/stationary version for employees who are injured, elderly, or otherwise unable to do the standard movement.

── SET FORMAT ──
Rep-based:  { "id": "...", "reps": 10, "weight": 0, "unit": "kg" }
Duration:   { "id": "...", "duration": 30 }   (seconds — must be > 0)

── EXERCISE TYPE RULES ──
• "duration" → holds, stretches, breathing (e.g. plank, hip flexor stretch, 90/90 breathing). Always specify actual seconds.
• "weighted" → movement-based bodyweight (e.g. glute bridge, shoulder roll, neck stretch with reps). Set weight: 0.

── PER-SIDE EXERCISES ──
Use "isSplit": true with "leftReps" and "rightReps" (per-side count, NOT total). Do NOT use "reps" for per-side.
RIGHT: { "isSplit": true, "leftReps": 8, "rightReps": 8, "weight": 0, "unit": "kg" }`;

interface PreviewTemplate {
  id:                    string;
  name:                  string;
  description:           string | null;
  featured_duration_days: number | null;
  exercises:             any;
}

interface ActivePreview {
  id:               string;
  plan_template_id: string;
  name:             string;
  ends_at:          string;
}

function exCount(tpl: PreviewTemplate): number {
  if (Array.isArray(tpl.exercises)) return tpl.exercises.length;
  if (tpl.exercises?.days) return (tpl.exercises.days as any[]).reduce((s: number, d: any) => s + (d.exercises?.length ?? 0), 0);
  return 0;
}

function setLabel(s: any): string {
  if (s.isSplit)        return `${s.leftReps ?? s.leftDuration ?? '?'} per side`;
  if (s.duration)       return `${s.duration}s`;
  if (s.seconds)        return `${s.seconds}s`;
  if (s.cardioduration != null || s.cardioSeconds != null) {
    const m = s.cardioduration ?? 0; const sec = s.cardioSeconds ?? 0;
    return sec > 0 ? `${m}:${String(sec).padStart(2, '0')} min cardio` : `${m} min cardio`;
  }
  const w = s.weight && s.weight > 0 ? ` @ ${s.weight}${s.unit ?? 'kg'}` : '';
  return `${s.reps ?? '?'} reps${w}`;
}

function serializeExercisesForMobile(exercises: any): any {
  if (!exercises) return exercises;
  function cvtSet(s: any, exType: string): any {
    if (exType !== 'duration') return s;
    const { seconds, ...rest } = s;
    return seconds != null ? { ...rest, duration: rest.duration ?? seconds } : s;
  }
  function cvtEx(ex: any): any {
    const type = ex.exercise?.type;
    return {
      ...ex,
      sets:  (ex.sets  ?? []).map((s: any) => cvtSet(s, type)),
      weeks: (ex.weeks ?? []).map((w: any) => ({ ...w, sets: (w.sets ?? []).map((s: any) => cvtSet(s, type)) })),
    };
  }
  if (Array.isArray(exercises)) return exercises.map(cvtEx);
  if (exercises.days) {
    return { ...exercises, days: exercises.days.map((d: any) => ({ ...d, exercises: (d.exercises ?? []).map(cvtEx) })) };
  }
  return exercises;
}

function getMonthOptions(): Date[] {
  const months: Date[] = [];
  const base = new Date();
  for (let i = 0; i <= 12; i++) months.push(startOfMonth(addMonths(base, i)));
  return months;
}

export default function MasterProgramsPage() {
  const router = useRouter();
  const [programs,      setPrograms]      = useState<Program[]>([]);
  const [ratings,       setRatings]       = useState<Record<string, ProgramRating>>({});
  const [dayRatings,    setDayRatings]    = useState<Record<string, DayRating[]>>({});
  const [trends,        setTrends]        = useState<Record<string, TrendRow[]>>({});
  const [loading,       setLoading]       = useState(true);
  const [activeTab,     setActiveTab]     = useState<'programs' | 'analytics'>('programs');
  const [programSubTab, setProgramSubTab] = useState<'active' | 'future' | 'past'>('active');
  const [scheduleModal, setScheduleModal] = useState<Program | null>(null);
  const [savingAvailId, setSavingAvailId] = useState<string | null>(null);

  const [showCreate,    setShowCreate]    = useState(false);
  const [jsonInput,     setJsonInput]     = useState('');
  const [preview,       setPreview]       = useState<ParsedPreview | null>(null);
  const [overrideName,  setOverrideName]  = useState('');
  const [overrideDesc,  setOverrideDesc]  = useState('');
  const [overrideDur,   setOverrideDur]   = useState('30');
  const [isDragging,    setIsDragging]    = useState(false);
  const [parseError,    setParseError]    = useState('');
  const [creating,      setCreating]      = useState(false);
  const [promptCopied,  setPromptCopied]  = useState(false);
  const dropRef = useRef<HTMLDivElement>(null);

  // Preview state
  const [previewDesignTpl,   setPreviewDesignTpl]   = useState<PreviewTemplate | null>(null);
  const [previewLaunchTpl,   setPreviewLaunchTpl]   = useState<PreviewTemplate | null>(null);
  const [previewLoading,     setPreviewLoading]     = useState<string | null>(null);
  const [previewLaunching,   setPreviewLaunching]   = useState(false);
  const [previewLaunchDone,  setPreviewLaunchDone]  = useState(false);
  const [previewLaunchError, setPreviewLaunchError] = useState('');
  const [masterPatients,     setMasterPatients]     = useState<string[]>([]);
  const [activePreviews,     setActivePreviews]     = useState<ActivePreview[]>([]);
  const [endingPreviewId,    setEndingPreviewId]    = useState<string | null>(null);
  const [dateTab,            setDateTab]            = useState<'month' | 'custom'>('month');
  const [selectedMonths,     setSelectedMonths]     = useState<Date[]>([]);
  const [range,              setRange]              = useState<DateRange | undefined>();
  const [scheduleType,       setScheduleType]       = useState<'all_days' | 'work_days'>('work_days');
  const [workDays,           setWorkDays]           = useState<number[]>([1, 2, 3, 4, 5]);

  useEffect(() => {
    const sb = getSupabase();
    sb.auth.getSession().then(async ({ data }) => {
      if (!data.session || data.session.user.id !== MASTER_ID) { router.push('/login'); return; }
      const today = new Date().toISOString().slice(0, 10);
      const [{ data: rows }, { data: ratingRows }, { data: trendRows }, { data: dayRatingRows }, { data: previewRows }, { data: patientRows }] = await Promise.all([
        sb.rpc('get_master_programs', { p_practitioner_id: MASTER_ID }),
        sb.rpc('get_featured_program_ratings', { p_practitioner_id: MASTER_ID }),
        sb.rpc('get_program_engagement_trend', { p_practitioner_id: MASTER_ID }),
        sb.rpc('get_featured_program_day_ratings', { p_practitioner_id: MASTER_ID }),
        sb.from('employer_programs').select('id, plan_template_id, name, ends_at').eq('employer_id', MASTER_ID).gte('ends_at', today),
        sb.from('patient_links').select('patient_id').eq('practitioner_id', MASTER_ID),
      ]);
      setPrograms((rows as Program[]) ?? []);
      const ratingMap: Record<string, ProgramRating> = {};
      for (const r of (ratingRows as ProgramRating[]) ?? []) ratingMap[r.plan_name] = r;
      setRatings(ratingMap);
      const dayRatingMap: Record<string, DayRating[]> = {};
      for (const d of (dayRatingRows as DayRating[]) ?? []) {
        if (!dayRatingMap[d.plan_name]) dayRatingMap[d.plan_name] = [];
        dayRatingMap[d.plan_name].push(d);
      }
      setDayRatings(dayRatingMap);
      const trendMap: Record<string, TrendRow[]> = {};
      for (const t of (trendRows as TrendRow[]) ?? []) {
        if (!trendMap[t.plan_name]) trendMap[t.plan_name] = [];
        trendMap[t.plan_name].push(t);
      }
      setTrends(trendMap);
      setActivePreviews((previewRows as ActivePreview[]) ?? []);
      setMasterPatients((patientRows ?? []).map((l: any) => l.patient_id as string));
      setLoading(false);
    });
  }, [router]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      if (previewDesignTpl) { setPreviewDesignTpl(null); return; }
      if (previewLaunchTpl) { setPreviewLaunchTpl(null); return; }
      setShowCreate(false);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showCreate, previewDesignTpl, previewLaunchTpl]);

  // Auto-parse JSON as it's typed/pasted
  useEffect(() => {
    if (!jsonInput.trim()) { setPreview(null); setParseError(''); return; }
    const p = tryParsePreview(jsonInput);
    if (p) {
      setPreview(p);
      setOverrideName(p.name);
      setOverrideDesc(p.description);
      setOverrideDur(p.duration);
      setParseError('');
    } else {
      setPreview(null);
      // Only show error if there's enough text to be a real attempt
      if (jsonInput.trim().length > 20) setParseError('Could not parse JSON — check the format.');
      else setParseError('');
    }
  }, [jsonInput]);

  function openCreate() {
    setJsonInput(''); setPreview(null); setParseError('');
    setOverrideName(''); setOverrideDesc(''); setOverrideDur('30');
    setPromptCopied(false); setIsDragging(false);
    setShowCreate(true);
  }

  async function handleCopyPrompt() {
    await navigator.clipboard.writeText(IMPORT_PROMPT);
    setPromptCopied(true);
    setTimeout(() => setPromptCopied(false), 2000);
  }

  function loadText(text: string) {
    setJsonInput(text);
    setParseError('');
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(true);
  }

  function handleDragLeave(e: React.DragEvent) {
    if (!dropRef.current?.contains(e.relatedTarget as Node)) setIsDragging(false);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = ev => loadText(String(ev.target?.result ?? ''));
      reader.readAsText(file);
    } else {
      const text = e.dataTransfer.getData('text');
      if (text) loadText(text);
    }
  }

  async function handleDelete(p: Program) {
    if (!confirm(`Delete "${p.template_name}"? This cannot be undone.`)) return;
    const sb = getSupabase();
    const { error } = await sb.from('plan_templates').delete().eq('id', p.template_id);
    if (error) {
      alert(error.message.includes('foreign key') || error.message.includes('restrict')
        ? `Cannot delete — ${p.employer_count} employer(s) have launched this program.`
        : 'Delete failed: ' + error.message);
      return;
    }
    setPrograms(prev => prev.filter(x => x.template_id !== p.template_id));
  }

  async function handleCreate() {
    if (!preview) { setParseError('Paste or drop the AI JSON first.'); return; }
    const name = overrideName.trim();
    if (!name) { setParseError('Program name cannot be empty.'); return; }
    setCreating(true);
    const exercises = structureExercises(preview.raw);
    const isEmpty = Array.isArray(exercises) ? exercises.length === 0 : !exercises?.days?.some((d: any) => d.exercises?.length > 0);
    if (isEmpty) { setParseError('No exercises found in the JSON.'); setCreating(false); return; }
    const dur = parseInt(overrideDur, 10);
    const sb = getSupabase();
    const { data, error } = await sb
      .from('plan_templates')
      .insert({
        practitioner_id:        MASTER_ID,
        name,
        description:            overrideDesc.trim() || null,
        exercises,
        is_featured:            true,
        featured_duration_days: isNaN(dur) || dur <= 0 ? null : dur,
      })
      .select('id, name, description, featured_duration_days')
      .single();
    if (error) { setParseError('Could not save: ' + error.message); setCreating(false); return; }
    setPrograms(prev => [{
      template_id:             (data as any).id,
      template_name:           (data as any).name,
      template_description:    (data as any).description ?? null,
      featured_duration_days:  (data as any).featured_duration_days ?? null,
      employer_count:          0,
      catalog_available_from:  null,
      catalog_available_until: null,
    }, ...prev]);
    setShowCreate(false);
    setCreating(false);
  }

  async function handleSaveAvailability(p: Program, from: string, until: string) {
    setSavingAvailId(p.template_id);
    const sb = getSupabase();
    const { error } = await sb.from('plan_templates').update({
      catalog_available_from:  from,
      catalog_available_until: until,
    }).eq('id', p.template_id);
    if (error) { alert('Save failed: ' + error.message); setSavingAvailId(null); return; }
    setPrograms(prev => prev.map(x => x.template_id === p.template_id
      ? { ...x, catalog_available_from: from, catalog_available_until: until }
      : x));
    setScheduleModal(null);
    setSavingAvailId(null);
  }

  async function handleClearAvailability(p: Program) {
    if (!confirm(`Remove catalog dates from "${p.template_name}"? It will become a draft and disappear from the employer catalog.`)) return;
    setSavingAvailId(p.template_id);
    const sb = getSupabase();
    const { error } = await sb.from('plan_templates').update({
      catalog_available_from:  null,
      catalog_available_until: null,
    }).eq('id', p.template_id);
    if (error) { alert('Clear failed: ' + error.message); setSavingAvailId(null); return; }
    setPrograms(prev => prev.map(x => x.template_id === p.template_id
      ? { ...x, catalog_available_from: null, catalog_available_until: null }
      : x));
    setSavingAvailId(null);
  }

  async function openPreviewDesign(p: Program) {
    setPreviewLoading(p.template_id);
    const sb = getSupabase();
    const { data } = await sb.from('plan_templates').select('id, name, description, featured_duration_days, exercises').eq('id', p.template_id).single();
    setPreviewLoading(null);
    if (data) setPreviewDesignTpl(data as PreviewTemplate);
  }

  async function openPreviewLaunch(p: Program) {
    setPreviewLoading(p.template_id);
    const sb = getSupabase();
    const { data } = await sb.from('plan_templates').select('id, name, description, featured_duration_days, exercises').eq('id', p.template_id).single();
    setPreviewLoading(null);
    if (data) {
      setPreviewLaunchTpl(data as PreviewTemplate);
      setPreviewLaunchDone(false);
      setPreviewLaunchError('');
      setDateTab('month');
      setSelectedMonths([]);
      setRange(undefined);
      setScheduleType('work_days');
      setWorkDays([1, 2, 3, 4, 5]);
    }
  }

  async function handlePreviewLaunch() {
    if (!previewLaunchTpl) return;
    let start: string; let end: string;
    if (dateTab === 'month') {
      if (selectedMonths.length === 0) { setPreviewLaunchError('Select at least one month.'); return; }
      const sorted = [...selectedMonths].sort((a, b) => a.getTime() - b.getTime());
      start = format(startOfMonth(sorted[0]), 'yyyy-MM-dd');
      const lastMonth = sorted[sorted.length - 1];
      const endDate = new Date(lastMonth.getFullYear(), lastMonth.getMonth() + 1, 0);
      end = format(endDate, 'yyyy-MM-dd');
    } else {
      if (!range?.from) { setPreviewLaunchError('Select a start date.'); return; }
      start = format(range.from, 'yyyy-MM-dd');
      end   = range.to ? format(range.to, 'yyyy-MM-dd') : start;
    }
    setPreviewLaunching(true);
    setPreviewLaunchError('');
    const sb = getSupabase();
    const employees = masterPatients;
    const serialized = serializeExercisesForMobile(previewLaunchTpl.exercises);
    if (employees.length > 0) {
      await sb.from('workout_plans').delete().eq('practitioner_id', MASTER_ID).in('patient_id', employees).eq('name', previewLaunchTpl.name);
      const { error: wpErr } = await sb.from('workout_plans').insert(
        employees.map(patientId => ({
          practitioner_id: MASTER_ID,
          patient_id:      patientId,
          name:            previewLaunchTpl.name,
          exercises:       serialized,
        }))
      );
      if (wpErr) { setPreviewLaunchError('Failed to assign workout plans: ' + wpErr.message); setPreviewLaunching(false); return; }
    }
    const { data: epData, error: epErr } = await sb.from('employer_programs').insert({
      employer_id:       MASTER_ID,
      plan_template_id:  previewLaunchTpl.id,
      name:              previewLaunchTpl.name,
      started_at:        start,
      ends_at:           end,
      schedule_type:     scheduleType,
      work_days:         workDays,
    }).select('id, plan_template_id, name, ends_at').single();
    if (epErr) { setPreviewLaunchError('Failed to create employer program: ' + epErr.message); setPreviewLaunching(false); return; }
    setActivePreviews(prev => [...prev, epData as ActivePreview]);
    setPreviewLaunching(false);
    setPreviewLaunchDone(true);
  }

  async function handleEndPreview(ap: ActivePreview) {
    setEndingPreviewId(ap.id);
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const sb = getSupabase();
    await sb.from('employer_programs').update({ ends_at: yesterday }).eq('id', ap.id);
    await sb.from('workout_plans').delete().eq('practitioner_id', MASTER_ID).eq('name', ap.name);
    setActivePreviews(prev => prev.filter(x => x.id !== ap.id));
    setEndingPreviewId(null);
  }

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p style={{ color: 'var(--text-muted)' }}>Loading…</p>
      </div>
    );
  }

  const monthOptions = getMonthOptions();

  function toggleMonth(m: Date) {
    setSelectedMonths(prev => {
      const exists = prev.some(x => x.getTime() === m.getTime());
      return exists ? prev.filter(x => x.getTime() !== m.getTime()) : [...prev, m];
    });
  }

  const DatePickerUI = (
    <div>
      <div style={{ display: 'flex', background: 'var(--input-bg)', borderRadius: 10, padding: 3, gap: 3, marginBottom: 16, width: 'fit-content' }}>
        {(['month', 'custom'] as const).map(t => (
          <button key={t} onClick={() => setDateTab(t)} style={{ border: 'none', borderRadius: 8, padding: '6px 16px', fontSize: 12, fontWeight: 700, cursor: 'pointer', background: dateTab === t ? 'var(--card)' : 'transparent', color: dateTab === t ? 'var(--text)' : 'var(--text-dim)' }}>
            {t === 'month' ? 'By Month' : 'Custom Range'}
          </button>
        ))}
      </div>
      {dateTab === 'month' ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 4 }}>
          {monthOptions.map(m => {
            const active = selectedMonths.some(x => x.getTime() === m.getTime());
            return (
              <button key={m.toISOString()} onClick={() => toggleMonth(m)} style={{ border: `1.5px solid ${active ? AMBER : 'var(--border-strong)'}`, background: active ? `${AMBER}20` : 'none', color: active ? AMBER : 'var(--text-dim)', borderRadius: 8, padding: '5px 13px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                {format(m, 'MMM yyyy')}
              </button>
            );
          })}
        </div>
      ) : (
        <DayPicker className="liftlog-rdp" mode="range" selected={range} onSelect={setRange} />
      )}
    </div>
  );

  const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const SchedulePickerUI = (
    <div style={{ marginTop: 16 }}>
      <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' as const, letterSpacing: '0.05em', display: 'block', marginBottom: 8 }}>Schedule Type</label>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        {(['work_days', 'all_days'] as const).map(t => (
          <button key={t} onClick={() => setScheduleType(t)} style={{ border: `1.5px solid ${scheduleType === t ? AMBER : 'var(--border-strong)'}`, background: scheduleType === t ? `${AMBER}20` : 'none', color: scheduleType === t ? AMBER : 'var(--text-dim)', borderRadius: 8, padding: '5px 13px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
            {t === 'work_days' ? 'Work Days' : 'All Days'}
          </button>
        ))}
      </div>
      {scheduleType === 'work_days' && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {DAY_LABELS.map((label, i) => {
            const active = workDays.includes(i);
            return (
              <button key={i} onClick={() => setWorkDays(prev => active ? prev.filter(d => d !== i) : [...prev, i].sort())} style={{ border: `1.5px solid ${active ? AMBER : 'var(--border-strong)'}`, background: active ? `${AMBER}20` : 'none', color: active ? AMBER : 'var(--text-dim)', borderRadius: 8, padding: '5px 10px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                {label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );

  const inputStyle: React.CSSProperties = {
    background: 'var(--input-bg)', border: '1px solid var(--border-strong)',
    borderRadius: 10, padding: '10px 14px', color: 'var(--text)',
    fontSize: 14, outline: 'none', width: '100%', boxSizing: 'border-box',
  };

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', color: 'var(--text)', fontFamily: 'sans-serif' }}>
      <main style={{ maxWidth: 900, margin: '0 auto', padding: '40px 32px' }}>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 32, flexWrap: 'wrap', gap: 16 }}>
          <div>
            <h1 style={{ fontSize: 28, fontWeight: 800, margin: '0 0 6px' }}>Programs</h1>
            <p style={{ color: 'var(--text-muted)', margin: 0, fontSize: 14 }}>
              {programs.length} featured plan template{programs.length !== 1 ? 's' : ''}
            </p>
          </div>
          <button onClick={openCreate} style={{ background: TEAL, color: '#0f1117', border: 'none', borderRadius: 12, padding: '11px 22px', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>
            + New Featured Program
          </button>
        </div>

        {/* Tab switcher */}
        <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', marginBottom: 24 }}>
          {(['programs', 'analytics'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                padding: '10px 20px', fontSize: 14, fontWeight: 700,
                color: activeTab === tab ? 'var(--text)' : 'var(--text-dim)',
                borderBottom: `2px solid ${activeTab === tab ? TEAL : 'transparent'}`,
                marginBottom: -1, transition: 'color 0.15s',
              }}
            >
              {tab === 'programs' ? 'Programs' : 'Analytics'}
            </button>
          ))}
        </div>

        {activeTab === 'programs' && (programs.length === 0 ? (
          <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 20, padding: '60px', textAlign: 'center' }}>
            <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'center' }}>
              <svg width="72" height="72" viewBox="0 0 56 56" fill="none" xmlns="http://www.w3.org/2000/svg">
                <rect width="56" height="56" rx="14" fill="#1EDBA820" />
                {/* clipboard body */}
                <rect x="14" y="16" width="28" height="28" rx="3" stroke="#1EDBA8" strokeWidth="2" />
                {/* clip at top */}
                <rect x="22" y="12" width="12" height="7" rx="2" stroke="#1EDBA8" strokeWidth="2" />
                {/* lines */}
                <line x1="19" y1="26" x2="37" y2="26" stroke="#1EDBA8" strokeWidth="2" strokeLinecap="round" />
                <line x1="19" y1="32" x2="37" y2="32" stroke="#1EDBA8" strokeWidth="2" strokeLinecap="round" />
                <line x1="19" y1="38" x2="29" y2="38" stroke="#1EDBA8" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </div>
            <p style={{ color: 'var(--text-muted)', fontSize: 15, marginBottom: 24 }}>
              No featured programs yet. Click "New Featured Program" to create one with AI.
            </p>
            <button onClick={openCreate} style={{ background: TEAL, color: '#0f1117', border: 'none', borderRadius: 12, padding: '11px 24px', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>
              + New Featured Program
            </button>
          </div>
        ) : (() => {
            const today = new Date().toISOString().slice(0, 10);
            const fmtD  = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

            function getStatus(p: Program): 'live' | 'scheduled' | 'draft' | 'past' {
              if (!p.catalog_available_from) return 'draft';
              if (p.catalog_available_from > today) return 'scheduled';
              if (!p.catalog_available_until || p.catalog_available_until >= today) return 'live';
              return 'past';
            }

            const live      = programs.filter(p => getStatus(p) === 'live');
            const scheduled = programs.filter(p => getStatus(p) === 'scheduled');
            const drafts    = programs.filter(p => getStatus(p) === 'draft');
            const past      = programs.filter(p => getStatus(p) === 'past');

            function ProgramCard({ p }: { p: Program }) {
              const status       = getStatus(p);
              const r            = ratings[p.template_name];
              const hasR         = r != null && Number(r.rating_count) > 0 && p.employer_count > 0;
              const eff          = hasR ? (r.avg_effectiveness ?? r.avg_satisfaction) : null;
              const enj          = hasR ? r.avg_enjoyment : null;
              const isSaving     = savingAvailId === p.template_id;
              const isLoading    = previewLoading === p.template_id;
              const activePreview = activePreviews.find(ap => ap.plan_template_id === p.template_id);
              const border       = status === 'live' ? `${TEAL}50` : status === 'scheduled' ? `${PURPLE}40` : status === 'past' ? `${AMBER}30` : 'var(--border)';
              return (
                <div style={{ background: 'var(--card)', border: `1px solid ${border}`, borderRadius: 16, padding: '20px 24px' }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 6 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', flex: 1 }}>
                      <h2 style={{ fontSize: 17, fontWeight: 700, margin: 0 }}>{p.template_name}</h2>
                      {p.catalog_available_from && (
                        <span style={{ background: 'var(--border)', color: 'var(--text-muted)', fontSize: 11, fontWeight: 600, padding: '2px 9px', borderRadius: 999 }}>
                          {new Date(p.catalog_available_from + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
                        </span>
                      )}
                      {p.featured_duration_days && (
                        <span style={{ background: `${TEAL}20`, color: TEAL, fontSize: 11, fontWeight: 700, padding: '2px 9px', borderRadius: 999 }}>{p.featured_duration_days}d</span>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                      <a href={`/plans/library/${p.template_id}?returnTo=/master/programs`} style={{ background: 'none', border: `1.5px solid ${TEAL}`, color: TEAL, borderRadius: 10, padding: '7px 14px', fontSize: 13, fontWeight: 700, textDecoration: 'none', whiteSpace: 'nowrap' }}>Edit Template</a>
                      <button onClick={() => handleDelete(p)} style={{ background: 'none', border: '1.5px solid #EF444450', color: '#EF4444', borderRadius: 10, padding: '7px 12px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>Delete</button>
                    </div>
                  </div>
                  {p.template_description && (
                    <p style={{ color: 'var(--text-muted)', fontSize: 14, margin: '0 0 10px', lineHeight: 1.5 }}>{p.template_description}</p>
                  )}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', marginBottom: 16 }}>
                    <span style={{ fontSize: 13, color: 'var(--text-dim)' }}>
                      <span style={{ fontWeight: 700, color: p.employer_count > 0 ? PURPLE : 'var(--text-dim)' }}>{p.employer_count}</span>
                      {' '}client{p.employer_count !== 1 ? 's' : ''} {status === 'live' ? 'currently running' : status === 'past' ? 'ran this' : 'launched this'}
                    </span>
                    {hasR ? (
                      <span style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                        {eff != null && <span style={{ fontWeight: 700 }}>⭐ {eff} / 5 Effectiveness</span>}
                        {enj != null && <span style={{ fontWeight: 700 }}>⭐ {enj} / 5 Enjoyment</span>}
                        <span style={{ color: 'var(--text-dim)' }}>({r.rating_count} rating{Number(r.rating_count) !== 1 ? 's' : ''})</span>
                      </span>
                    ) : (
                      <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>{p.employer_count > 0 ? 'No ratings yet' : 'No data yet'}</span>
                    )}
                  </div>
                  {/* Preview buttons */}
                  <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
                    <button
                      onClick={() => openPreviewDesign(p)}
                      disabled={!!previewLoading}
                      style={{ background: 'none', border: `1.5px solid ${TEAL}60`, color: TEAL, borderRadius: 8, padding: '6px 14px', fontSize: 13, fontWeight: 700, cursor: previewLoading ? 'not-allowed' : 'pointer', opacity: previewLoading ? 0.5 : 1 }}
                    >
                      {isLoading ? 'Loading…' : 'Preview Design'}
                    </button>
                    <button
                      onClick={() => openPreviewLaunch(p)}
                      disabled={!!previewLoading}
                      style={{ background: 'none', border: `1.5px solid ${AMBER}60`, color: AMBER, borderRadius: 8, padding: '6px 14px', fontSize: 13, fontWeight: 700, cursor: previewLoading ? 'not-allowed' : 'pointer', opacity: previewLoading ? 0.5 : 1 }}
                    >
                      {isLoading ? 'Loading…' : 'Preview Launch'}
                    </button>
                    {activePreview && (
                      <>
                        <span style={{ background: `${AMBER}20`, color: AMBER, fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 999 }}>Preview Active</span>
                        <button
                          onClick={() => handleEndPreview(activePreview)}
                          disabled={endingPreviewId === activePreview.id}
                          style={{ background: 'none', border: '1.5px solid #EF444450', color: '#EF4444', borderRadius: 8, padding: '6px 12px', fontSize: 13, fontWeight: 700, cursor: 'pointer', opacity: endingPreviewId === activePreview.id ? 0.5 : 1 }}
                        >
                          {endingPreviewId === activePreview.id ? 'Ending…' : 'End Preview'}
                        </button>
                      </>
                    )}
                  </div>
                  <div style={{ borderTop: '1px solid var(--border)', paddingTop: 14, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                    <div>
                      {status === 'draft' && (
                        <p style={{ fontSize: 13, color: 'var(--text-dim)', margin: 0 }}>Not scheduled — click Schedule to add to the employer catalog</p>
                      )}
                      {status === 'scheduled' && p.catalog_available_from && (
                        <p style={{ fontSize: 13, color: PURPLE, margin: 0, fontWeight: 600 }}>
                          Scheduled {fmtD(p.catalog_available_from)} → {p.catalog_available_until ? fmtD(p.catalog_available_until) : '∞'}
                          <span style={{ fontWeight: 400, color: 'var(--text-dim)', marginLeft: 8 }}>
                            ({Math.max(0, Math.ceil((new Date(p.catalog_available_from + 'T12:00:00').getTime() - Date.now()) / 86400000))} days away)
                          </span>
                        </p>
                      )}
                      {status === 'live' && (
                        <p style={{ fontSize: 13, color: TEAL, margin: 0, fontWeight: 600 }}>
                          Live{p.catalog_available_until ? ` until ${fmtD(p.catalog_available_until)}` : ''}
                        </p>
                      )}
                      {status === 'past' && p.catalog_available_from && p.catalog_available_until && (
                        <p style={{ fontSize: 13, color: AMBER, margin: 0 }}>
                          Ran {fmtD(p.catalog_available_from)} → {fmtD(p.catalog_available_until)}
                        </p>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                      <button
                        onClick={() => setScheduleModal(p)}
                        disabled={isSaving}
                        style={{ background: status === 'draft' ? TEAL : 'none', color: status === 'draft' ? '#0f1117' : 'var(--text-dim)', border: status === 'draft' ? 'none' : '1px solid var(--border-strong)', borderRadius: 8, padding: '6px 14px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
                      >
                        {status === 'draft' ? 'Schedule →' : 'Edit Schedule'}
                      </button>
                      {p.catalog_available_from && (
                        <button
                          onClick={() => handleClearAvailability(p)}
                          disabled={isSaving}
                          style={{ background: 'none', border: '1px solid var(--border-strong)', color: 'var(--text-dim)', borderRadius: 8, padding: '6px 10px', fontSize: 13, cursor: 'pointer' }}
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            }

            const future = [...scheduled, ...drafts];

            const pastByMonth: Record<string, Program[]> = {};
            for (const p of past) {
              const key = p.catalog_available_until?.slice(0, 7) ?? 'unknown';
              (pastByMonth[key] ??= []).push(p);
            }
            const pastMonthKeys = Object.keys(pastByMonth).sort().reverse();

            return (
              <>
                {/* Sub-tabs: Active | Future | Past */}
                <div style={{ display: 'flex', background: 'var(--input-bg)', borderRadius: 12, padding: 4, marginBottom: 24, gap: 4, width: 'fit-content' }}>
                  {(['active', 'future', 'past'] as const).map(t => (
                    <button
                      key={t}
                      onClick={() => setProgramSubTab(t)}
                      style={{
                        border: 'none', borderRadius: 9, padding: '8px 20px',
                        fontSize: 13, fontWeight: 700, cursor: 'pointer',
                        background: programSubTab === t ? 'var(--card)' : 'transparent',
                        color: programSubTab === t ? 'var(--text)' : 'var(--text-dim)',
                        transition: 'background 0.15s', whiteSpace: 'nowrap' as const,
                      }}
                    >
                      {t === 'active'
                        ? `Active${live.length ? ` (${live.length})` : ''}`
                        : t === 'future'
                          ? `Future${future.length ? ` (${future.length})` : ''}`
                          : `Past${past.length ? ` (${past.length})` : ''}`}
                    </button>
                  ))}
                </div>

                {programSubTab === 'active' && (
                  live.length === 0
                    ? <p style={{ color: 'var(--text-dim)', fontSize: 14, padding: '24px 0' }}>No programs are currently live.</p>
                    : <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>{live.map(p => <ProgramCard key={p.template_id} p={p} />)}</div>
                )}

                {programSubTab === 'future' && (
                  future.length === 0
                    ? <p style={{ color: 'var(--text-dim)', fontSize: 14, padding: '24px 0' }}>No upcoming programs — create one above and schedule it.</p>
                    : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                        {scheduled.length > 0 && (
                          <>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                              <span style={{ width: 8, height: 8, borderRadius: '50%', background: PURPLE, display: 'inline-block', flexShrink: 0 }} />
                              <span style={{ fontSize: 12, fontWeight: 800, color: PURPLE, textTransform: 'uppercase' as const, letterSpacing: '0.08em' }}>Scheduled ({scheduled.length})</span>
                            </div>
                            {scheduled.map(p => <ProgramCard key={p.template_id} p={p} />)}
                          </>
                        )}
                        {drafts.length > 0 && (
                          <>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: scheduled.length > 0 ? 16 : 0, marginBottom: 4 }}>
                              <span style={{ fontSize: 12, fontWeight: 800, color: 'var(--text-dim)', textTransform: 'uppercase' as const, letterSpacing: '0.08em' }}>Drafts ({drafts.length})</span>
                            </div>
                            {drafts.map(p => <ProgramCard key={p.template_id} p={p} />)}
                          </>
                        )}
                      </div>
                    )
                )}

                {programSubTab === 'past' && (
                  past.length === 0
                    ? <p style={{ color: 'var(--text-dim)', fontSize: 14, padding: '24px 0' }}>No past programs yet.</p>
                    : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
                        {pastMonthKeys.map(monthKey => {
                          const label = monthKey === 'unknown'
                            ? 'Unknown'
                            : new Date(monthKey + '-01T12:00:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
                          return (
                            <div key={monthKey}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                                <span style={{ fontSize: 12, fontWeight: 800, color: AMBER, textTransform: 'uppercase' as const, letterSpacing: '0.08em' }}>{label}</span>
                                <div style={{ flex: 1, height: 1, background: AMBER + '30' }} />
                              </div>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                                {pastByMonth[monthKey].map(p => <ProgramCard key={p.template_id} p={p} />)}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )
                )}
              </>
            );
          })()
        )}

        {activeTab === 'analytics' && (
          programs.length === 0 ? (
            <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '60px 0', fontSize: 15 }}>No programs yet.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {programs.map(p => {
                const r        = ratings[p.template_name];
                const days     = dayRatings[p.template_name] ?? [];
                const completed = Number(r?.completed_count ?? 0);
                const total = Number(r?.total_count ?? 0);
                const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
                const trendData = (trends[p.template_name] ?? [])
                  .filter(w => w.week_number >= 1 && w.week_number <= 8)
                  .sort((a, b) => a.week_number - b.week_number);
                const maxCount = Math.max(...trendData.map(w => Number(w.workout_count)), 1);
                const hasData = (p.employer_count > 0) && (total > 0 || (r != null && Number(r.rating_count) > 0) || trendData.length > 0);
                return (
                  <div key={p.template_id} style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16, padding: '22px 24px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: hasData ? 18 : 6, flexWrap: 'wrap' }}>
                      <h2 style={{ fontSize: 17, fontWeight: 700, margin: 0 }}>{p.template_name}</h2>
                      {p.featured_duration_days && (
                        <span style={{ background: `${TEAL}20`, color: TEAL, fontSize: 11, fontWeight: 700, padding: '2px 9px', borderRadius: 999 }}>
                          {p.featured_duration_days}d program
                        </span>
                      )}
                    </div>
                    {!hasData ? (
                      <p style={{ color: 'var(--text-dim)', fontSize: 13, margin: 0 }}>No data yet — employees need to log workouts.</p>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                        {total > 0 && (
                          <div>
                            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' as const, letterSpacing: '0.05em', display: 'block', marginBottom: 8 }}>Completion</span>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                              <span style={{ fontSize: 14 }}>
                                <span style={{ fontWeight: 700, color: completed > 0 ? TEAL : 'var(--text-dim)' }}>{completed}/{total}</span>
                                <span style={{ color: 'var(--text-dim)' }}> employees completed</span>
                              </span>
                              <div style={{ width: 120, height: 6, background: 'var(--border)', borderRadius: 3, overflow: 'hidden' }}>
                                <div style={{ height: '100%', width: `${pct}%`, background: TEAL, borderRadius: 3 }} />
                              </div>
                              <span style={{ fontSize: 13, color: 'var(--text-dim)', fontWeight: 700 }}>{pct}%</span>
                            </div>
                          </div>
                        )}
                        {r != null && Number(r.rating_count) > 0 && (
                          <div>
                            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' as const, letterSpacing: '0.05em', display: 'block', marginBottom: 8 }}>Ratings</span>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', marginBottom: days.length > 0 ? 12 : 0 }}>
                              {(r.avg_effectiveness ?? r.avg_satisfaction) != null && (
                                <span style={{ color: 'var(--text)', fontWeight: 700, fontSize: 14 }}>⭐ {r.avg_effectiveness ?? r.avg_satisfaction} / 5 Effectiveness</span>
                              )}
                              {r.avg_enjoyment != null && (
                                <span style={{ color: 'var(--text)', fontWeight: 700, fontSize: 14 }}>⭐ {r.avg_enjoyment} / 5 Enjoyment</span>
                              )}
                              <span style={{ color: 'var(--text-dim)', fontSize: 13 }}>({r.rating_count} rating{Number(r.rating_count) !== 1 ? 's' : ''})</span>
                            </div>
                            {days.length > 0 && (() => {
                              const effValues = days.map(d => d.avg_effectiveness).filter((v): v is number => v != null);
                              const enjValues = days.map(d => d.avg_enjoyment).filter((v): v is number => v != null);
                              const bestEffDay  = effValues.length > 0 ? Math.max(...effValues) : null;
                              const worstEffDay = effValues.length > 1 ? Math.min(...effValues) : null;
                              const bestEnjDay  = enjValues.length > 0 ? Math.max(...enjValues) : null;
                              const worstEnjDay = enjValues.length > 1 ? Math.min(...enjValues) : null;
                              return (
                                <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10 }}>
                                  <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' as const, letterSpacing: '0.05em', display: 'block', marginBottom: 8 }}>By Day</span>
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                    {days.map(d => {
                                      const eff = d.avg_effectiveness;
                                      const enj = d.avg_enjoyment;
                                      const isBestEff  = eff != null && eff === bestEffDay;
                                      const isWorstEff = eff != null && eff === worstEffDay;
                                      const isBestEnj  = enj != null && enj === bestEnjDay;
                                      const isWorstEnj = enj != null && enj === worstEnjDay;
                                      return (
                                        <div key={d.day_id} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                                          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', minWidth: 52, flexShrink: 0 }}>
                                            {d.day_label ?? `Day ${d.day_order ?? '?'}`}
                                          </span>
                                          {eff != null && (
                                            <span style={{ fontSize: 12, color: isBestEff ? TEAL : isWorstEff ? '#EF4444' : 'var(--text-dim)', fontWeight: isBestEff || isWorstEff ? 700 : 400 }}>
                                              {eff} eff
                                              {isBestEff ? ' ↑' : isWorstEff ? ' ↓' : ''}
                                            </span>
                                          )}
                                          {enj != null && (
                                            <span style={{ fontSize: 12, color: isBestEnj ? TEAL : isWorstEnj ? '#EF4444' : 'var(--text-dim)', fontWeight: isBestEnj || isWorstEnj ? 700 : 400 }}>
                                              {enj} enj
                                              {isBestEnj ? ' ↑' : isWorstEnj ? ' ↓' : ''}
                                            </span>
                                          )}
                                          <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>({d.rating_count})</span>
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                              );
                            })()}
                          </div>
                        )}
                        {trendData.length === 1 && (
                          <div>
                            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' as const, letterSpacing: '0.05em', display: 'block', marginBottom: 4 }}>Workouts / Week</span>
                            <span style={{ fontSize: 14, color: 'var(--text-dim)' }}>
                              <span style={{ fontWeight: 700, color: 'var(--text)' }}>{trendData[0].workout_count}</span> workout{Number(trendData[0].workout_count) !== 1 ? 's' : ''} in Week 1
                            </span>
                          </div>
                        )}
                        {trendData.length > 1 && (
                          <div>
                            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' as const, letterSpacing: '0.05em', display: 'block', marginBottom: 8 }}>Workouts / Week</span>
                            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
                              {trendData.map(week => {
                                const barHeight = Math.max(6, (Number(week.workout_count) / maxCount) * 56);
                                return (
                                  <div key={week.week_number} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                                    <span style={{ fontSize: 11, color: 'var(--text-dim)', lineHeight: 1 }}>{week.workout_count}</span>
                                    <div style={{ width: 28, height: barHeight, background: TEAL, borderRadius: 4, opacity: 0.8 }} />
                                    <span style={{ fontSize: 11, color: 'var(--text-dim)', lineHeight: 1 }}>W{week.week_number}</span>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )
        )}
      </main>

      {scheduleModal && (
        <ScheduleModal
          programName={scheduleModal.template_name}
          currentFrom={scheduleModal.catalog_available_from}
          currentUntil={scheduleModal.catalog_available_until}
          saving={savingAvailId === scheduleModal.template_id}
          onSave={(from, until) => handleSaveAvailability(scheduleModal, from, until)}
          onClose={() => setScheduleModal(null)}
        />
      )}

      {/* DayPicker theme overrides */}
      <style>{`
        .liftlog-rdp { --rdp-accent-color: ${TEAL}; --rdp-accent-background-color: ${TEAL}20; color: var(--text); }
        .liftlog-rdp .rdp-day_button { color: var(--text); }
        .liftlog-rdp .rdp-day_button:hover { background: ${TEAL}30; }
        .liftlog-rdp .rdp-selected .rdp-day_button { background: ${TEAL}; color: #0f1117; }
        .liftlog-rdp .rdp-range_middle .rdp-day_button { background: ${TEAL}20; color: var(--text); }
        .liftlog-rdp .rdp-nav button { color: var(--text); }
        .liftlog-rdp .rdp-weekday { color: var(--text-dim); }
      `}</style>

      {showCreate && (
        <div
          onClick={e => { if (e.target === e.currentTarget) setShowCreate(false); }}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 1000, padding: '40px 24px', overflowY: 'auto' }}
        >
          <div style={{ background: 'var(--modal-bg)', border: '1px solid var(--border)', borderRadius: 24, padding: '36px', width: '100%', maxWidth: 560, marginBottom: 40 }}>
            <h2 style={{ fontSize: 22, fontWeight: 800, margin: '0 0 6px' }}>New Featured Program</h2>
            <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: '0 0 24px' }}>
              Ask Claude to write a 5-minute desk workout, then drop or paste the JSON below.
            </p>

            {/* Step 1 — Copy prompt */}
            <button
              onClick={handleCopyPrompt}
              style={{ width: '100%', background: promptCopied ? TEAL : PURPLE, color: promptCopied ? '#0f1117' : '#fff', border: 'none', borderRadius: 12, padding: '13px 0', fontWeight: 700, fontSize: 14, cursor: 'pointer', marginBottom: 20, transition: 'background 0.2s' }}
            >
              {promptCopied ? '✓ Prompt copied — paste it into Claude or ChatGPT' : '1.  Copy AI Prompt'}
            </button>

            {/* Step 2 — Drop zone */}
            <div
              ref={dropRef}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              style={{ position: 'relative', marginBottom: preview ? 20 : 0 }}
            >
              <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 8 }}>
                2.  Drop or paste the JSON response
              </label>
              <div style={{
                border: `2px dashed ${isDragging ? TEAL : preview ? TEAL : 'var(--border-strong)'}`,
                borderRadius: 14, position: 'relative', transition: 'border-color 0.15s',
                background: isDragging ? `${TEAL}10` : 'transparent',
              }}>
                <textarea
                  value={jsonInput}
                  onChange={e => loadText(e.target.value)}
                  placeholder={'Drop a .json file here, or paste the JSON…'}
                  rows={preview ? 4 : 9}
                  style={{
                    display: 'block', width: '100%', boxSizing: 'border-box',
                    background: 'transparent', border: 'none', outline: 'none',
                    padding: '16px', color: 'var(--text)', fontFamily: 'monospace',
                    fontSize: 12, resize: 'vertical', lineHeight: 1.5,
                  }}
                />
                {isDragging && (
                  <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none', borderRadius: 12, background: `${TEAL}18` }}>
                    <p style={{ color: TEAL, fontWeight: 800, fontSize: 16, margin: 0 }}>Drop JSON here</p>
                  </div>
                )}
              </div>
            </div>

            {/* Auto-parsed preview */}
            {preview && (
              <div style={{ background: `${TEAL}12`, border: `1px solid ${TEAL}40`, borderRadius: 14, padding: '18px 20px', marginBottom: 20 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                  <span style={{ fontSize: 15 }}>✓</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: TEAL }}>Parsed — {preview.exerciseCount} exercise{preview.exerciseCount !== 1 ? 's' : ''} detected</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div>
                    <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 4 }}>Name</label>
                    <input value={overrideName} onChange={e => setOverrideName(e.target.value)} style={inputStyle} />
                  </div>
                  <div>
                    <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 4 }}>Description</label>
                    <textarea value={overrideDesc} onChange={e => setOverrideDesc(e.target.value)} rows={2} style={{ ...inputStyle, resize: 'vertical' }} />
                  </div>
                  <div>
                    <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 4 }}>Challenge Duration (days)</label>
                    <input type="number" min="1" value={overrideDur} onChange={e => setOverrideDur(e.target.value)} style={{ ...inputStyle, width: 100 }} />
                  </div>
                </div>
              </div>
            )}

            {parseError && (
              <p style={{ color: '#EF4444', fontSize: 13, margin: '0 0 16px' }}>{parseError}</p>
            )}

            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setShowCreate(false)} style={{ flex: 1, background: 'none', border: '1px solid var(--border-strong)', borderRadius: 10, padding: '12px 0', fontWeight: 700, fontSize: 14, color: 'var(--text-muted)', cursor: 'pointer' }}>
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={creating || !preview}
                style={{ flex: 2, background: preview ? TEAL : 'var(--border-strong)', color: preview ? '#0f1117' : 'var(--text-dim)', border: 'none', borderRadius: 10, padding: '12px 0', fontWeight: 700, fontSize: 14, cursor: creating || !preview ? 'not-allowed' : 'pointer', opacity: creating ? 0.7 : 1, transition: 'background 0.2s, color 0.2s' }}
              >
                {creating ? 'Creating…' : 'Create Featured Program'}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Preview Design modal */}
      {previewDesignTpl && (() => {
        const tpl = previewDesignTpl;
        const flat: any[] = Array.isArray(tpl.exercises)
          ? tpl.exercises
          : (tpl.exercises?.days ?? []).flatMap((d: any) => d.exercises ?? []);
        const days: { label: string; exercises: any[] }[] | null =
          !Array.isArray(tpl.exercises) && tpl.exercises?.days
            ? tpl.exercises.days
            : null;
        return (
          <div
            onClick={e => { if (e.target === e.currentTarget) setPreviewDesignTpl(null); }}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 1000, padding: '40px 24px', overflowY: 'auto' }}
          >
            <div style={{ background: 'var(--modal-bg)', border: '1px solid var(--border)', borderRadius: 24, padding: '32px', width: '100%', maxWidth: 540, marginBottom: 40 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                <h2 style={{ fontSize: 20, fontWeight: 800, margin: 0 }}>{tpl.name}</h2>
                <button onClick={() => setPreviewDesignTpl(null)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 22, cursor: 'pointer', lineHeight: 1, padding: 4 }}>×</button>
              </div>
              {tpl.featured_duration_days && (
                <span style={{ background: `${TEAL}20`, color: TEAL, fontSize: 11, fontWeight: 700, padding: '2px 9px', borderRadius: 999, display: 'inline-block', marginBottom: 10 }}>{tpl.featured_duration_days}d program</span>
              )}
              {tpl.description && (
                <p style={{ color: 'var(--text-muted)', fontSize: 14, margin: '0 0 16px', lineHeight: 1.5 }}>{tpl.description}</p>
              )}
              <div style={{ fontSize: 12, color: 'var(--text-dim)', fontWeight: 700, marginBottom: 14 }}>
                {exCount(tpl)} exercise{exCount(tpl) !== 1 ? 's' : ''}
              </div>
              {days ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
                  {days.map((day: any, di: number) => (
                    <div key={di}>
                      <div style={{ fontSize: 12, fontWeight: 800, color: TEAL, textTransform: 'uppercase' as const, letterSpacing: '0.07em', marginBottom: 8 }}>{day.label ?? `Day ${di + 1}`}</div>
                      {(day.exercises ?? []).map((ex: any, ei: number) => (
                        <div key={ei} style={{ background: 'var(--input-bg)', borderRadius: 10, padding: '12px 14px', marginBottom: 8 }}>
                          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                            {ex.illustrationUrl && (
                              <img src={ex.illustrationUrl} alt="" style={{ width: 56, height: 56, borderRadius: 8, objectFit: 'cover', flexShrink: 0, border: '1px solid var(--border)' }} />
                            )}
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>{ex.exercise?.name ?? 'Exercise'}</div>
                              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                {(ex.sets ?? []).map((s: any, si: number) => (
                                  <span key={si} style={{ fontSize: 12, color: 'var(--text-dim)', background: 'var(--card)', borderRadius: 6, padding: '2px 8px' }}>Set {si + 1}: {setLabel(s)}</span>
                                ))}
                              </div>
                              {(ex.practitionerNotes || ex.notes) && <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '6px 0 0', lineHeight: 1.5 }}>{ex.practitionerNotes || ex.notes}</p>}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {flat.map((ex: any, ei: number) => (
                    <div key={ei} style={{ background: 'var(--input-bg)', borderRadius: 10, padding: '12px 14px' }}>
                      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                        {ex.illustrationUrl && (
                          <img src={ex.illustrationUrl} alt="" style={{ width: 56, height: 56, borderRadius: 8, objectFit: 'cover', flexShrink: 0, border: '1px solid var(--border)' }} />
                        )}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>{ex.exercise?.name ?? 'Exercise'}</div>
                          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                            {(ex.sets ?? []).map((s: any, si: number) => (
                              <span key={si} style={{ fontSize: 12, color: 'var(--text-dim)', background: 'var(--card)', borderRadius: 6, padding: '2px 8px' }}>Set {si + 1}: {setLabel(s)}</span>
                            ))}
                          </div>
                          {(ex.practitionerNotes || ex.notes) && <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '6px 0 0', lineHeight: 1.5 }}>{ex.practitionerNotes || ex.notes}</p>}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <button onClick={() => setPreviewDesignTpl(null)} style={{ marginTop: 24, width: '100%', background: 'none', border: '1px solid var(--border-strong)', borderRadius: 10, padding: '11px 0', fontWeight: 700, fontSize: 14, color: 'var(--text-muted)', cursor: 'pointer' }}>
                Close
              </button>
            </div>
          </div>
        );
      })()}

      {/* Preview Launch modal */}
      {previewLaunchTpl && (
        <div
          onClick={e => { if (e.target === e.currentTarget) setPreviewLaunchTpl(null); }}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 1000, padding: '40px 24px', overflowY: 'auto' }}
        >
          <div style={{ background: 'var(--modal-bg)', border: '1px solid var(--border)', borderRadius: 24, padding: '32px', width: '100%', maxWidth: 540, marginBottom: 40 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <h2 style={{ fontSize: 20, fontWeight: 800, margin: 0 }}>Preview Launch</h2>
              <button onClick={() => setPreviewLaunchTpl(null)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 22, cursor: 'pointer', lineHeight: 1, padding: 4 }}>×</button>
            </div>
            <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: '0 0 20px' }}>
              Simulates the employer launch flow using your master account. Creates real <code style={{ fontSize: 12 }}>employer_programs</code> and <code style={{ fontSize: 12 }}>workout_plans</code> rows assigned to your {masterPatients.length} linked patient{masterPatients.length !== 1 ? 's' : ''} as test employees.
            </p>
            <div style={{ background: `${AMBER}12`, border: `1px solid ${AMBER}40`, borderRadius: 12, padding: '12px 16px', marginBottom: 20, fontSize: 13, color: AMBER, fontWeight: 600 }}>
              This creates real data. Use "End Preview" on the card when done to clean up.
            </div>

            {previewLaunchDone ? (
              <div style={{ textAlign: 'center', padding: '24px 0' }}>
                <div style={{ fontSize: 32, marginBottom: 12 }}>✓</div>
                <p style={{ fontWeight: 800, fontSize: 16, color: TEAL, margin: '0 0 8px' }}>Preview launched!</p>
                <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: '0 0 20px' }}>Open GymTracker on your master account to test the employee experience.</p>
                <button onClick={() => setPreviewLaunchTpl(null)} style={{ background: TEAL, color: '#0f1117', border: 'none', borderRadius: 10, padding: '12px 32px', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>
                  Done
                </button>
              </div>
            ) : (
              <>
                <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' as const, letterSpacing: '0.05em', display: 'block', marginBottom: 10 }}>Preview Dates</label>
                {DatePickerUI}
                {SchedulePickerUI}
                {previewLaunchError && (
                  <p style={{ color: '#EF4444', fontSize: 13, margin: '14px 0 0' }}>{previewLaunchError}</p>
                )}
                <div style={{ display: 'flex', gap: 10, marginTop: 24 }}>
                  <button onClick={() => setPreviewLaunchTpl(null)} style={{ flex: 1, background: 'none', border: '1px solid var(--border-strong)', borderRadius: 10, padding: '12px 0', fontWeight: 700, fontSize: 14, color: 'var(--text-muted)', cursor: 'pointer' }}>
                    Cancel
                  </button>
                  <button
                    onClick={handlePreviewLaunch}
                    disabled={previewLaunching}
                    style={{ flex: 2, background: AMBER, color: '#0f1117', border: 'none', borderRadius: 10, padding: '12px 0', fontWeight: 700, fontSize: 14, cursor: previewLaunching ? 'not-allowed' : 'pointer', opacity: previewLaunching ? 0.7 : 1 }}
                  >
                    {previewLaunching ? 'Launching…' : 'Launch Preview →'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
