'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { getSupabase } from '@/lib/supabase';

const TEAL   = '#5fcfbf';
const PURPLE = '#C471ED';
const MASTER_ID = process.env.NEXT_PUBLIC_FEATURED_PRACTITIONER_ID || '969ea6c6-ba6d-4ee4-8bb8-a7cee267f40c';

interface Program {
  template_id:            string;
  template_name:          string;
  template_description:   string | null;
  featured_duration_days: number | null;
  employer_count:         number;
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
    return { ...ex, id: crypto.randomUUID(), sets, exercise, practitionerNotes: ex.practitionerNotes ?? ex.notes ?? '' };
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

export default function MasterProgramsPage() {
  const router = useRouter();
  const [programs,      setPrograms]      = useState<Program[]>([]);
  const [ratings,       setRatings]       = useState<Record<string, ProgramRating>>({});
  const [trends,        setTrends]        = useState<Record<string, TrendRow[]>>({});
  const [loading,       setLoading]       = useState(true);

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

  useEffect(() => {
    const sb = getSupabase();
    sb.auth.getSession().then(async ({ data }) => {
      if (!data.session || data.session.user.id !== MASTER_ID) { router.push('/login'); return; }
      const [{ data: rows }, { data: ratingRows }, { data: trendRows }] = await Promise.all([
        sb.rpc('get_master_programs', { p_practitioner_id: MASTER_ID }),
        sb.rpc('get_featured_program_ratings', { p_practitioner_id: MASTER_ID }),
        sb.rpc('get_program_engagement_trend', { p_practitioner_id: MASTER_ID }),
      ]);
      setPrograms((rows as Program[]) ?? []);
      const ratingMap: Record<string, ProgramRating> = {};
      for (const r of (ratingRows as ProgramRating[]) ?? []) ratingMap[r.plan_name] = r;
      setRatings(ratingMap);
      const trendMap: Record<string, TrendRow[]> = {};
      for (const t of (trendRows as TrendRow[]) ?? []) {
        if (!trendMap[t.plan_name]) trendMap[t.plan_name] = [];
        trendMap[t.plan_name].push(t);
      }
      setTrends(trendMap);
      setLoading(false);
    });
  }, [router]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setShowCreate(false); }
    if (showCreate) window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showCreate]);

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
      template_id:            (data as any).id,
      template_name:          (data as any).name,
      template_description:   (data as any).description ?? null,
      featured_duration_days: (data as any).featured_duration_days ?? null,
      employer_count:         0,
    }, ...prev]);
    setShowCreate(false);
    setCreating(false);
  }

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p style={{ color: 'var(--text-muted)' }}>Loading…</p>
      </div>
    );
  }

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

        {programs.length === 0 ? (
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
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {programs.map(p => (
              <div key={p.template_id} style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16, padding: '22px 24px', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6, flexWrap: 'wrap' }}>
                    <h2 style={{ fontSize: 17, fontWeight: 700, margin: 0 }}>{p.template_name}</h2>
                    {p.featured_duration_days && (
                      <span style={{ background: `${TEAL}20`, color: TEAL, fontSize: 11, fontWeight: 700, padding: '2px 9px', borderRadius: 999 }}>
                        {p.featured_duration_days}d program
                      </span>
                    )}
                  </div>
                  {p.template_description && (
                    <p style={{ color: 'var(--text-muted)', fontSize: 14, margin: '0 0 10px', lineHeight: 1.5 }}>{p.template_description}</p>
                  )}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 2 }}>

                    {/* Clients launched */}
                    <p style={{ fontSize: 13, color: 'var(--text-dim)', margin: 0 }}>
                      <span style={{ fontWeight: 700, color: p.employer_count > 0 ? PURPLE : 'var(--text-dim)' }}>{p.employer_count}</span>{' '}
                      client{p.employer_count !== 1 ? 's' : ''} launched this program
                    </p>

                    {/* Completion rate */}
                    {(() => {
                      const r = ratings[p.template_name];
                      if (!r) return null;
                      const completed = Number(r.completed_count ?? 0);
                      const total     = Number(r.total_count ?? 0);
                      if (total === 0) return null;
                      const pct = Math.round((completed / total) * 100);
                      return (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontSize: 12 }}>
                            <span style={{ fontWeight: 700, color: completed > 0 ? TEAL : 'var(--text-dim)' }}>{completed}/{total}</span>
                            <span style={{ color: 'var(--text-dim)' }}> employees completed</span>
                          </span>
                          <div style={{ width: 72, height: 4, background: 'var(--border)', borderRadius: 2, overflow: 'hidden' }}>
                            <div style={{ height: '100%', width: `${pct}%`, background: TEAL, borderRadius: 2 }} />
                          </div>
                          <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>{pct}%</span>
                        </div>
                      );
                    })()}

                    {/* Ratings */}
                    {(() => {
                      const r = ratings[p.template_name];
                      if (!r || Number(r.rating_count) === 0) return (
                        <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>No ratings yet</span>
                      );
                      const eff = r.avg_effectiveness ?? r.avg_satisfaction;
                      const enj = r.avg_enjoyment;
                      return (
                        <span style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                          {eff != null && (
                            <span style={{ color: 'var(--text)', fontWeight: 700 }}>⭐ {eff}/5 Effectiveness</span>
                          )}
                          {enj != null && (
                            <span style={{ color: 'var(--text)', fontWeight: 700 }}>⭐ {enj}/5 Enjoyment</span>
                          )}
                          <span style={{ color: 'var(--text-dim)' }}>({r.rating_count} rating{Number(r.rating_count) !== 1 ? 's' : ''})</span>
                        </span>
                      );
                    })()}

                    {/* Weekly engagement chart */}
                    {(() => {
                      const trendData = (trends[p.template_name] ?? [])
                        .filter(w => w.week_number >= 1 && w.week_number <= 8)
                        .sort((a, b) => a.week_number - b.week_number);
                      if (trendData.length === 0) return null;
                      const maxCount = Math.max(...trendData.map(w => Number(w.workout_count)), 1);
                      return (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingTop: 4 }}>
                          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Workouts / Week</span>
                          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 5 }}>
                            {trendData.map(week => {
                              const barHeight = Math.max(4, (Number(week.workout_count) / maxCount) * 36);
                              return (
                                <div key={week.week_number} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                                  <span style={{ fontSize: 9, color: 'var(--text-dim)', lineHeight: 1 }}>{week.workout_count}</span>
                                  <div style={{ width: 22, height: barHeight, background: TEAL, borderRadius: 3, opacity: 0.75 }} />
                                  <span style={{ fontSize: 9, color: 'var(--text-dim)', lineHeight: 1 }}>W{week.week_number}</span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })()}

                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
                  <a href={`/plans/library/${p.template_id}?returnTo=/master/programs`} style={{ background: 'none', border: `1.5px solid ${TEAL}`, color: TEAL, borderRadius: 10, padding: '8px 16px', fontSize: 13, fontWeight: 700, textDecoration: 'none', whiteSpace: 'nowrap' }}>
                    Edit Template
                  </a>
                  <button
                    onClick={() => handleDelete(p)}
                    style={{ background: 'none', border: '1.5px solid #EF444450', color: '#EF4444', borderRadius: 10, padding: '8px 14px', fontSize: 13, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

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
    </div>
  );
}
