'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState } from 'react';
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

// ── JSON sanitizer (same as mobile sanitizeImportJson) ───────────────────────
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

// ── Exercise parser (same logic as mobile parseExerciseList) ─────────────────
function parseExercises(rawExercises: any[]): any[] {
  const MOVEMENT_FORCE_REPS  = ['dead bug', 'deadbug', 'bird dog', 'birddog'];
  const INHERENTLY_PER_SIDE  = ['dead bug', 'deadbug', 'bird dog', 'birddog'];
  return rawExercises.map((ex: any) => {
    const nameLC   = String(ex.exercise?.name ?? '').toLowerCase();
    const notesLC  = String(ex.practitionerNotes ?? ex.notes ?? '').toLowerCase();
    const forceReps = MOVEMENT_FORCE_REPS.some(n => nameLC.includes(n));
    const nameImpliesPerSide =
      INHERENTLY_PER_SIDE.some(n => nameLC.includes(n)) ||
      ['per side','each side','single leg','single arm','single-leg','single-arm'].some(p => nameLC.includes(p) || notesLC.includes(p));
    const exType = forceReps ? 'weighted' : String(ex.exercise?.type ?? 'weighted');
    const sets = Array.isArray(ex.sets) ? ex.sets.map((s: any) => {
      const base: any = { ...s, id: crypto.randomUUID() };
      const isSplit = base.isSplit || nameImpliesPerSide;
      if (isSplit) {
        base.isSplit = true;
        if (base.leftReps === undefined && base.reps !== undefined) { base.leftReps = base.reps; base.rightReps = base.reps; delete base.reps; }
        if (exType === 'duration' && base.leftDuration === undefined && base.duration !== undefined) { base.leftDuration = base.duration; base.rightDuration = base.duration; delete base.duration; }
      }
      if (exType === 'weighted' && base.duration !== undefined && base.reps === undefined && base.leftReps === undefined) {
        if (isSplit) { base.leftReps = 10; base.rightReps = 10; } else { base.reps = 10; }
        delete base.duration;
      }
      if (exType === 'duration' && (base.duration === undefined || base.duration === 0) && base.reps !== undefined && base.reps > 0) {
        base.duration = base.reps; delete base.reps; delete base.weight;
      }
      return base;
    }) : [];
    const exercise = forceReps && ex.exercise ? { ...ex.exercise, type: 'weighted' } : ex.exercise;
    return { ...ex, id: crypto.randomUUID(), sets, exercise, practitionerNotes: ex.practitionerNotes ?? ex.notes ?? '' };
  });
}

const IMPORT_PROMPT = `You can generate either a single workout or a multi-day plan.

SINGLE WORKOUT format:
{
  "name": "Workout Name",
  "description": "Optional description",
  "exercises": [ ...exercises... ]
}

MULTI-DAY PLAN format:
{
  "name": "Plan Name",
  "description": "Optional description",
  "days": [
    {
      "id": "day1",
      "name": "Day 1 - Lower Body",
      "sessions": [
        { "id": "session1", "name": "Strength Session", "exercises": [ ...exercises... ] }
      ]
    }
  ]
}

Each exercise object:
{
  "id": "ex1",
  "exercise": { "id": "ex1", "name": "Exercise Name", "muscleGroup": "Legs", "equipment": "Barbell", "type": "weighted" },
  "sets": [ { "id": "set1", "weight": 80, "reps": 8, "unit": "kg" } ],
  "practitionerNotes": "Brief coaching cue for the patient (form tip, breathing, focus point)"
}

── SET FORMAT ──
Rep-based:  { "id": "...", "reps": 8, "weight": 0, "unit": "kg" }
Duration:   { "id": "...", "duration": 30 }   (seconds — must be > 0)
Cardio:     { "id": "...", "cardioduration": 20, "speed": 3.5, "incline": 0 }

── EXERCISE TYPE RULES ──
• Use "duration" for holds, stretches, and breathing exercises (e.g. hip flexor stretch, 90/90 breathing, plank, pigeon pose, wall sit). Always fill in the actual hold time in seconds — never use 0.
• Use "weighted" for movement-based exercises including bodyweight moves (dead bugs, bird dogs, glute bridges, squats, lunges). Use "reps" and set "weight": 0 for bodyweight.
• Use "cardio" for machine cardio (treadmill, bike, rower, etc.).

IMPORTANT: For "duration" exercises, always specify the actual hold time in seconds. "duration": 0 is invalid.

── PER-SIDE EXERCISES ──
For single-leg, single-arm, or "X reps per side" exercises use "isSplit": true with "leftReps" and "rightReps" set to the PER-SIDE count (not the total). Do NOT use "reps" for per-side exercises.
WRONG: { "reps": 16 }
RIGHT: { "isSplit": true, "leftReps": 8, "rightReps": 8, "weight": 0, "unit": "kg" }`;

export default function MasterProgramsPage() {
  const router = useRouter();
  const [programs,  setPrograms]  = useState<Program[]>([]);
  const [loading,   setLoading]   = useState(true);

  // Create modal state
  const [showCreate,   setShowCreate]   = useState(false);
  const [progName,     setProgName]     = useState('');
  const [progDesc,     setProgDesc]     = useState('');
  const [progDuration, setProgDuration] = useState('30');
  const [jsonInput,    setJsonInput]    = useState('');
  const [parseError,   setParseError]   = useState('');
  const [creating,     setCreating]     = useState(false);
  const [promptCopied, setPromptCopied] = useState(false);

  useEffect(() => {
    const sb = getSupabase();
    sb.auth.getSession().then(async ({ data }) => {
      if (!data.session || data.session.user.id !== MASTER_ID) {
        router.push('/login');
        return;
      }
      const { data: rows } = await sb.rpc('get_master_programs', { p_practitioner_id: MASTER_ID });
      setPrograms((rows as Program[]) ?? []);
      setLoading(false);
    });
  }, [router]);

  function openCreate() {
    setProgName(''); setProgDesc(''); setProgDuration('30');
    setJsonInput(''); setParseError(''); setPromptCopied(false);
    setShowCreate(true);
  }

  async function handleCopyPrompt() {
    await navigator.clipboard.writeText(IMPORT_PROMPT);
    setPromptCopied(true);
    setTimeout(() => setPromptCopied(false), 2000);
  }

  async function handleCreate() {
    setParseError('');
    if (!progName.trim())  { setParseError('Enter a program name.'); return; }
    if (!jsonInput.trim()) { setParseError('Paste the AI JSON above.'); return; }

    setCreating(true);
    try {
      const parsed = JSON.parse(sanitizeJson(jsonInput));
      if (!parsed.name && !parsed.exercises && !parsed.days) {
        setParseError('Invalid format — must have a "name" and "exercises" or "days".');
        setCreating(false);
        return;
      }

      let exercises: any[] = [];
      if (Array.isArray(parsed.exercises)) {
        exercises = parseExercises(parsed.exercises);
      } else if (Array.isArray(parsed.days)) {
        // Flatten all sessions across all days into a single exercises list
        for (const day of parsed.days) {
          for (const session of (Array.isArray(day.sessions) ? day.sessions : [])) {
            if (Array.isArray(session.exercises)) {
              exercises.push(...parseExercises(session.exercises));
            }
          }
        }
      }

      if (exercises.length === 0) {
        setParseError('No exercises found in the JSON.');
        setCreating(false);
        return;
      }

      const sb = getSupabase();
      const dur = parseInt(progDuration, 10);
      const { data, error } = await sb
        .from('plan_templates')
        .insert({
          practitioner_id:        MASTER_ID,
          name:                   progName.trim(),
          description:            progDesc.trim() || (parsed.description ? String(parsed.description) : null),
          exercises,
          is_featured:            true,
          featured_duration_days: isNaN(dur) || dur <= 0 ? null : dur,
        })
        .select('id, name, description, featured_duration_days')
        .single();

      if (error) { setParseError('Could not save: ' + error.message); setCreating(false); return; }

      // Add to local list
      setPrograms(prev => [{
        template_id:            (data as any).id,
        template_name:          (data as any).name,
        template_description:   (data as any).description ?? null,
        featured_duration_days: (data as any).featured_duration_days ?? null,
        employer_count:         0,
      }, ...prev]);

      setShowCreate(false);
    } catch {
      setParseError('Could not parse JSON — check the format and try again.');
    }
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
          <button
            onClick={openCreate}
            style={{ background: TEAL, color: '#0f1117', border: 'none', borderRadius: 12, padding: '11px 22px', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}
          >
            + New Featured Program
          </button>
        </div>

        {programs.length === 0 ? (
          <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 20, padding: '60px', textAlign: 'center' }}>
            <p style={{ fontSize: 32, marginBottom: 12 }}>📋</p>
            <p style={{ color: 'var(--text-muted)', fontSize: 15, marginBottom: 24 }}>
              No featured programs yet. Click "New Featured Program" to create one with AI.
            </p>
            <button
              onClick={openCreate}
              style={{ background: TEAL, color: '#0f1117', border: 'none', borderRadius: 12, padding: '11px 24px', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}
            >
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
                      <span style={{ background: `${TEAL}20`, color: TEAL, fontSize: 11, fontWeight: 700, padding: '2px 9px', borderRadius: 999, whiteSpace: 'nowrap' }}>
                        {p.featured_duration_days}d program
                      </span>
                    )}
                  </div>
                  {p.template_description && (
                    <p style={{ color: 'var(--text-muted)', fontSize: 14, margin: '0 0 10px', lineHeight: 1.5 }}>
                      {p.template_description}
                    </p>
                  )}
                  <p style={{ fontSize: 13, color: 'var(--text-dim)', margin: 0 }}>
                    <span style={{ fontWeight: 700, color: p.employer_count > 0 ? PURPLE : 'var(--text-dim)' }}>
                      {p.employer_count}
                    </span>{' '}
                    client{p.employer_count !== 1 ? 's' : ''} launched this program
                  </p>
                </div>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexShrink: 0 }}>
                  <a
                    href={`/plans/library/${p.template_id}`}
                    style={{ background: 'none', border: `1.5px solid ${TEAL}`, color: TEAL, borderRadius: 10, padding: '8px 16px', fontSize: 13, fontWeight: 700, textDecoration: 'none', whiteSpace: 'nowrap' }}
                  >
                    Edit Template
                  </a>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {/* Create modal */}
      {showCreate && (
        <div
          onClick={e => { if (e.target === e.currentTarget) setShowCreate(false); }}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 1000, padding: '40px 24px', overflowY: 'auto' }}
        >
          <div style={{ background: 'var(--modal-bg)', border: '1px solid var(--border)', borderRadius: 24, padding: '36px', width: '100%', maxWidth: 600, marginBottom: 40 }}>
            <h2 style={{ fontSize: 22, fontWeight: 800, margin: '0 0 28px' }}>New Featured Program</h2>

            {/* Program details */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 28 }}>
              <div>
                <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 6 }}>Program Name</label>
                <input value={progName} onChange={e => setProgName(e.target.value)} placeholder="e.g. Desk Warrior" style={inputStyle} />
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 6 }}>Description</label>
                <textarea
                  value={progDesc}
                  onChange={e => setProgDesc(e.target.value)}
                  placeholder="Short description shown to employers…"
                  rows={2}
                  style={{ ...inputStyle, resize: 'vertical' }}
                />
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 6 }}>Challenge Duration (days)</label>
                <input type="number" min="1" value={progDuration} onChange={e => setProgDuration(e.target.value)} style={{ ...inputStyle, width: 120 }} />
              </div>
            </div>

            {/* AI prompt section */}
            <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, padding: '18px 20px', marginBottom: 18 }}>
              <p style={{ fontSize: 13, fontWeight: 700, margin: '0 0 8px' }}>
                1. Copy this prompt and send it to Claude or ChatGPT:
              </p>
              <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 12px', lineHeight: 1.5 }}>
                Tell the AI you want a 5-minute desk workout with no equipment, then paste this format prompt so it responds in the correct JSON structure.
              </p>
              <button
                onClick={handleCopyPrompt}
                style={{ background: promptCopied ? TEAL : PURPLE, color: promptCopied ? '#0f1117' : '#fff', border: 'none', borderRadius: 9, padding: '9px 18px', fontWeight: 700, fontSize: 13, cursor: 'pointer', transition: 'background 0.2s' }}
              >
                {promptCopied ? '✓ Copied!' : 'Copy Format Prompt'}
              </button>
            </div>

            <div style={{ marginBottom: 18 }}>
              <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 6 }}>
                2. Paste the AI JSON response here:
              </label>
              <textarea
                value={jsonInput}
                onChange={e => setJsonInput(e.target.value)}
                placeholder={'{\n  "name": "Desk Warrior",\n  "exercises": [...]\n}'}
                rows={10}
                style={{ ...inputStyle, fontFamily: 'monospace', fontSize: 12, resize: 'vertical' }}
              />
            </div>

            {parseError && (
              <p style={{ color: '#EF4444', fontSize: 13, margin: '0 0 16px' }}>{parseError}</p>
            )}

            <div style={{ display: 'flex', gap: 10 }}>
              <button
                onClick={() => setShowCreate(false)}
                style={{ flex: 1, background: 'none', border: '1px solid var(--border-strong)', borderRadius: 10, padding: '12px 0', fontWeight: 700, fontSize: 14, color: 'var(--text-muted)', cursor: 'pointer' }}
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={creating}
                style={{ flex: 2, background: TEAL, color: '#0f1117', border: 'none', borderRadius: 10, padding: '12px 0', fontWeight: 700, fontSize: 14, cursor: creating ? 'not-allowed' : 'pointer', opacity: creating ? 0.7 : 1 }}
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
