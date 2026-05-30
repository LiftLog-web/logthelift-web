'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getSupabase } from '@/lib/supabase';

const TEAL   = '#5fcfbf';
const PURPLE = '#C471ED';

const BODY_PART_TAGS = ['Shoulder','Knee','Hip','Lower Back','Core','Full Body','Upper Body','Lower Body','Chest','Back','Arms','Legs','Calves'];
const GOAL_TAGS      = ['Strength','Hypertrophy','Rehab','Mobility','Cardio','HIIT','Power','Endurance','Flexibility'];

interface Template {
  id: string;
  name: string;
  description: string | null;
  exercises: any[];
  tags?: string[];
  created_at: string;
}

function numWeeks(exercises: any[]): number {
  let max = 1;
  for (const ex of exercises) {
    for (const w of ex.weeks ?? []) {
      if (w.week > max) max = w.week;
    }
  }
  return max;
}

function weekSets(ex: any, week: number): any[] {
  if (week === 1) return ex.sets ?? [];
  return ex.weeks?.find((w: any) => w.week === week)?.sets ?? ex.sets ?? [];
}

function weekExerciseName(ex: any, week: number): string {
  if (week === 1) return ex.exercise?.name ?? '—';
  return ex.weeks?.find((w: any) => w.week === week)?.exerciseOverride?.name ?? ex.exercise?.name ?? '—';
}

function fmtSets(sets: any[]): string {
  const n = sets.length;
  const s = sets[0];
  if (!s || n === 0) return '—';
  if (s.seconds !== undefined) return `${n} × ${s.seconds}s`;
  if (s.reps !== undefined) return `${n} × ${s.reps}`;
  return `${n} sets`;
}

export default function PlanLibraryPage() {
  const router = useRouter();
  const [authed,      setAuthed]      = useState(false);
  const [userId,      setUserId]      = useState('');
  const [templates,   setTemplates]   = useState<Template[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [creating,    setCreating]    = useState(false);
  const [deleting,    setDeleting]    = useState<string | null>(null);
  const [search,      setSearch]      = useState('');
  const [activeBody,  setActiveBody]  = useState<string | null>(null);
  const [activeGoal,  setActiveGoal]  = useState<string | null>(null);
  const [previewTpl,  setPreviewTpl]  = useState<Template | null>(null);
  const [previewWeek, setPreviewWeek] = useState(1);

  useEffect(() => {
    const sb = getSupabase();
    sb.auth.getSession().then(async ({ data }) => {
      if (!data.session) { router.push('/login'); return; }
      const { data: prof } = await sb.from('profiles').select('role, is_gym_owner').eq('id', data.session.user.id).single();
      if (prof?.role !== 'practitioner' && !prof?.is_gym_owner) { router.push('/profile'); return; }
      setAuthed(true);
      setUserId(data.session.user.id);
      const { data: rows } = await sb
        .from('plan_templates')
        .select('*')
        .eq('practitioner_id', data.session.user.id)
        .order('created_at', { ascending: false });
      setTemplates(rows ?? []);
      setLoading(false);
    });
  }, [router]);

  const handleCreate = async () => {
    setCreating(true);
    const { data, error } = await getSupabase()
      .from('plan_templates')
      .insert({ practitioner_id: userId, name: '', description: null, exercises: [] })
      .select()
      .single();
    if (!error && data) router.push(`/plans/library/${data.id}`);
    else setCreating(false);
  };

  const handleDelete = async (t: Template) => {
    if (!confirm(`Delete "${t.name || 'Untitled template'}"? This cannot be undone.`)) return;
    setDeleting(t.id);
    await getSupabase().from('plan_templates').delete().eq('id', t.id);
    setTemplates(prev => prev.filter(x => x.id !== t.id));
    setDeleting(null);
  };

  const filtered = templates.filter(t => {
    const tags = t.tags ?? [];
    if (search && !t.name.toLowerCase().includes(search.toLowerCase())) return false;
    if (activeBody && !tags.includes(activeBody)) return false;
    if (activeGoal && !tags.includes(activeGoal)) return false;
    return true;
  });

  // Which body/goal tags are actually used
  const usedBodyTags = BODY_PART_TAGS.filter(tag => templates.some(t => (t.tags ?? []).includes(tag)));
  const usedGoalTags = GOAL_TAGS.filter(tag => templates.some(t => (t.tags ?? []).includes(tag)));

  if (!authed || loading) {
    return (
      <div style={{ minHeight: '100vh', background: '#0f1117', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ width: 32, height: 32, border: `3px solid ${TEAL}`, borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  const tagChip = (label: string, active: boolean, onClick: () => void) => (
    <button
      key={label}
      onClick={onClick}
      style={{
        padding: '4px 13px', borderRadius: 999, fontSize: 12, fontWeight: 700,
        border: `1px solid ${active ? TEAL : 'rgba(255,255,255,0.15)'}`,
        background: active ? `${TEAL}22` : 'transparent',
        color: active ? TEAL : 'rgba(255,255,255,0.4)',
        cursor: 'pointer', whiteSpace: 'nowrap',
      }}
    >
      {label}
    </button>
  );

  return (
    <div style={{ minHeight: '100vh', background: '#0f1117', color: '#fff', fontFamily: 'sans-serif' }}>
      <main style={{ maxWidth: 1100, margin: '0 auto', padding: '40px 32px' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, flexWrap: 'wrap', gap: 16 }}>
          <div>
            <h1 style={{ fontSize: 28, fontWeight: 800, margin: 0 }}>Plan Library</h1>
            <p style={{ color: 'rgba(255,255,255,0.4)', marginTop: 6, marginBottom: 0 }}>
              Reusable templates with week-by-week progression
            </p>
          </div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            {templates.length > 0 && (
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search templates…"
                style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 10, padding: '10px 16px', color: '#fff', fontSize: 14, outline: 'none', width: 220 }}
              />
            )}
            <button
              onClick={handleCreate}
              disabled={creating}
              style={{ background: TEAL, color: '#0f1117', borderRadius: 10, padding: '10px 22px', fontWeight: 700, fontSize: 14, border: 'none', cursor: creating ? 'not-allowed' : 'pointer', opacity: creating ? 0.7 : 1 }}
            >
              {creating ? 'Creating…' : '+ New Template'}
            </button>
          </div>
        </div>

        {/* Filters */}
        {(usedBodyTags.length > 0 || usedGoalTags.length > 0) && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 20, marginBottom: 4 }}>
            {usedBodyTags.length > 0 && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.25)', textTransform: 'uppercase', letterSpacing: '0.06em', marginRight: 4 }}>Body Part</span>
                {tagChip('All', !activeBody, () => setActiveBody(null))}
                {usedBodyTags.map(tag => tagChip(tag, activeBody === tag, () => setActiveBody(activeBody === tag ? null : tag)))}
              </div>
            )}
            {usedGoalTags.length > 0 && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.25)', textTransform: 'uppercase', letterSpacing: '0.06em', marginRight: 4 }}>Goal</span>
                {tagChip('All', !activeGoal, () => setActiveGoal(null))}
                {usedGoalTags.map(tag => tagChip(tag, activeGoal === tag, () => setActiveGoal(activeGoal === tag ? null : tag)))}
              </div>
            )}
          </div>
        )}

        {/* Empty state */}
        {templates.length === 0 ? (
          <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 20, padding: 60, textAlign: 'center', marginTop: 32 }}>
            <p style={{ fontSize: 40, marginBottom: 16 }}>📋</p>
            <p style={{ color: 'rgba(255,255,255,0.4)', marginBottom: 24 }}>No templates yet. Create your first reusable plan template.</p>
            <button onClick={handleCreate} disabled={creating} style={{ background: TEAL, color: '#0f1117', borderRadius: 12, padding: '12px 28px', fontWeight: 700, fontSize: 15, border: 'none', cursor: 'pointer' }}>
              Create First Template
            </button>
          </div>
        ) : filtered.length === 0 ? (
          <p style={{ color: 'rgba(255,255,255,0.3)', marginTop: 40, textAlign: 'center' }}>No templates match your filters.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 24 }}>
            {filtered.map(t => {
              const weeks   = numWeeks(t.exercises);
              const tplTags = t.tags ?? [];
              const bodyTags = tplTags.filter(tg => BODY_PART_TAGS.includes(tg));
              const goalTags = tplTags.filter(tg => GOAL_TAGS.includes(tg));
              const visibleEx = t.exercises.slice(0, 5);
              const extraEx = t.exercises.length - visibleEx.length;
              const weekCols = Array.from({ length: Math.min(weeks, 4) }, (_, i) => i + 1);

              return (
                <div
                  key={t.id}
                  onClick={() => { setPreviewTpl(t); setPreviewWeek(1); }}
                  style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 16, overflow: 'hidden', cursor: 'pointer', transition: 'border-color 0.15s' }}
                  onMouseEnter={e => (e.currentTarget.style.borderColor = `${TEAL}50`)}
                  onMouseLeave={e => (e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)')}
                >
                  {/* Card header */}
                  <div style={{ padding: '18px 24px 14px', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
                        <span style={{ fontWeight: 700, fontSize: 16, color: t.name ? '#fff' : 'rgba(255,255,255,0.3)', fontStyle: t.name ? 'normal' : 'italic' }}>
                          {t.name || 'Untitled template'}
                        </span>
                        {bodyTags.map(tg => (
                          <span key={tg} style={{ background: `${TEAL}18`, color: TEAL, fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 999 }}>{tg}</span>
                        ))}
                        {goalTags.map(tg => (
                          <span key={tg} style={{ background: `${PURPLE}18`, color: PURPLE, fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 999 }}>{tg}</span>
                        ))}
                      </div>
                      {t.description && (
                        <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13, margin: '0 0 2px' }}>{t.description}</p>
                      )}
                      <p style={{ color: 'rgba(255,255,255,0.2)', fontSize: 11, margin: 0 }}>
                        Created {new Date(t.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                        {' · '}{t.exercises.length} exercise{t.exercises.length !== 1 ? 's' : ''}
                        {' · '}{weeks}-week program
                      </p>
                    </div>
                    <div onClick={e => e.stopPropagation()} style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                      <button
                        onClick={() => router.push(`/plans/library/${t.id}`)}
                        style={{ background: `${TEAL}20`, color: TEAL, border: `1px solid ${TEAL}40`, borderRadius: 8, padding: '7px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
                      >
                        View / Edit
                      </button>
                      <button
                        onClick={() => router.push(`/plans/new?template=${t.id}`)}
                        style={{ background: `${PURPLE}20`, color: PURPLE, border: `1px solid ${PURPLE}40`, borderRadius: 8, padding: '7px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
                      >
                        Assign to Patient
                      </button>
                      <button
                        onClick={() => handleDelete(t)}
                        disabled={deleting === t.id}
                        style={{ background: 'rgba(239,68,68,0.1)', color: '#EF4444', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, padding: '7px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer', opacity: deleting === t.id ? 0.5 : 1 }}
                      >
                        Delete
                      </button>
                    </div>
                  </div>

                  {/* Progression table */}
                  {t.exercises.length > 0 && (
                    <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', overflowX: 'auto' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                        <thead>
                          <tr style={{ background: 'rgba(255,255,255,0.03)' }}>
                            <th style={{ padding: '8px 24px', textAlign: 'left', fontWeight: 600, color: 'rgba(255,255,255,0.35)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', width: '40%' }}>Exercise</th>
                            {weekCols.map(w => (
                              <th key={w} style={{ padding: '8px 16px', textAlign: 'center', fontWeight: 700, color: w === 1 ? TEAL : 'rgba(255,255,255,0.35)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap' }}>
                                Week {w}
                              </th>
                            ))}
                            {weeks > 4 && (
                              <th style={{ padding: '8px 16px', textAlign: 'center', color: 'rgba(255,255,255,0.2)', fontSize: 11 }}>+{weeks - 4} more</th>
                            )}
                          </tr>
                        </thead>
                        <tbody>
                          {visibleEx.map((ex: any, i: number) => (
                            <tr key={i} style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                              <td style={{ padding: '9px 24px', color: '#fff', fontWeight: 500 }}>
                                {weekExerciseName(ex, 1)}
                                {ex.exercise?.muscleGroup && (
                                  <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: 11, marginLeft: 6 }}>{ex.exercise.muscleGroup}</span>
                                )}
                              </td>
                              {weekCols.map(w => {
                                const sets = weekSets(ex, w);
                                const label = fmtSets(sets);
                                const prevLabel = w > 1 ? fmtSets(weekSets(ex, w - 1)) : null;
                                const changed = prevLabel !== null && label !== prevLabel;
                                return (
                                  <td key={w} style={{ padding: '9px 16px', textAlign: 'center', color: changed ? TEAL : 'rgba(255,255,255,0.5)', fontWeight: changed ? 700 : 400, whiteSpace: 'nowrap' }}>
                                    {label}
                                  </td>
                                );
                              })}
                              {weeks > 4 && <td />}
                            </tr>
                          ))}
                          {extraEx > 0 && (
                            <tr style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                              <td colSpan={weekCols.length + 1 + (weeks > 4 ? 1 : 0)} style={{ padding: '8px 24px', color: 'rgba(255,255,255,0.25)', fontSize: 12, fontStyle: 'italic' }}>
                                +{extraEx} more exercise{extraEx !== 1 ? 's' : ''}
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </main>

      {/* Template preview modal */}
      {previewTpl && (() => {
        const weeks = numWeeks(previewTpl.exercises);
        const weekCols = Array.from({ length: weeks }, (_, i) => i + 1);
        return (
          <div
            onClick={() => setPreviewTpl(null)}
            onKeyDown={e => { if (e.key === 'Escape') setPreviewTpl(null); }}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 24 }}
          >
            <div onClick={e => e.stopPropagation()} style={{ background: '#1a1d27', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 20, width: '100%', maxWidth: 640, maxHeight: 'calc(100vh - 80px)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              {/* Header */}
              <div style={{ padding: '24px 28px 16px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                  <div>
                    <h2 style={{ fontWeight: 800, fontSize: 20, margin: '0 0 6px' }}>{previewTpl.name || 'Untitled template'}</h2>
                    {previewTpl.description && <p style={{ color: 'rgba(255,255,255,0.45)', fontSize: 14, margin: '0 0 10px' }}>{previewTpl.description}</p>}
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {(previewTpl.tags ?? []).filter(tg => BODY_PART_TAGS.includes(tg)).map(tg => (
                        <span key={tg} style={{ background: `${TEAL}18`, color: TEAL, fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 999 }}>{tg}</span>
                      ))}
                      {(previewTpl.tags ?? []).filter(tg => GOAL_TAGS.includes(tg)).map(tg => (
                        <span key={tg} style={{ background: `${PURPLE}18`, color: PURPLE, fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 999 }}>{tg}</span>
                      ))}
                    </div>
                  </div>
                  <button onClick={() => setPreviewTpl(null)} style={{ background: 'rgba(255,255,255,0.07)', border: 'none', color: 'rgba(255,255,255,0.5)', borderRadius: 8, width: 32, height: 32, fontSize: 18, cursor: 'pointer', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
                </div>
                {/* Week tabs */}
                {weeks > 1 && (
                  <div style={{ display: 'flex', gap: 6, marginTop: 14 }}>
                    {weekCols.map(w => (
                      <button
                        key={w}
                        onClick={() => setPreviewWeek(w)}
                        style={{ padding: '5px 14px', borderRadius: 8, fontSize: 13, fontWeight: 700, border: `1px solid ${previewWeek === w ? TEAL : 'rgba(255,255,255,0.15)'}`, background: previewWeek === w ? `${TEAL}22` : 'transparent', color: previewWeek === w ? TEAL : 'rgba(255,255,255,0.4)', cursor: 'pointer' }}
                      >
                        Week {w}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Exercise list for selected week */}
              <div style={{ flex: 1, overflowY: 'auto', padding: '16px 28px' }}>
                {previewTpl.exercises.length === 0 ? (
                  <p style={{ color: 'rgba(255,255,255,0.3)', fontSize: 14, textAlign: 'center', padding: '24px 0' }}>No exercises added yet.</p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    {previewTpl.exercises.map((ex: any, i: number) => {
                      const sets = weekSets(ex, previewWeek);
                      const exName = weekExerciseName(ex, previewWeek);
                      return (
                        <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', borderBottom: i < previewTpl.exercises.length - 1 ? '1px solid rgba(255,255,255,0.06)' : 'none' }}>
                          <div>
                            <span style={{ fontSize: 14, fontWeight: 600, color: '#fff' }}>{i + 1}. {exName}</span>
                            {ex.exercise?.muscleGroup && (
                              <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)', marginLeft: 8 }}>{ex.exercise.muscleGroup}</span>
                            )}
                          </div>
                          <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.45)', whiteSpace: 'nowrap' }}>
                            {fmtSets(sets)}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Footer */}
              <div style={{ padding: '16px 28px', borderTop: '1px solid rgba(255,255,255,0.08)', display: 'flex', gap: 10 }}>
                <button onClick={() => router.push(`/plans/library/${previewTpl.id}`)} style={{ flex: 1, background: `${TEAL}20`, color: TEAL, border: `1px solid ${TEAL}40`, borderRadius: 10, padding: '11px 0', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>
                  View / Edit
                </button>
                <button onClick={() => router.push(`/plans/new?template=${previewTpl.id}`)} style={{ flex: 1, background: PURPLE, color: '#fff', border: 'none', borderRadius: 10, padding: '11px 0', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>
                  Assign to Patient
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
