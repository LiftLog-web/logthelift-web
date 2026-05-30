'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getSupabase } from '@/lib/supabase';

const TEAL   = '#5fcfbf';
const PURPLE = '#C471ED';

const BODY_PART_TAGS = ['Arms','Back','Balance','Calves','Cardio','Chest','Core','Full Body','Glutes','Hamstrings','Hip','Isometrics','Legs','Lower Back','Lower Body','Pilates','Plyometrics','Shoulders','Upper Body','Yoga'];

interface Template {
  id: string;
  name: string;
  description: string | null;
  exercises: any[];
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

export default function PlanLibraryPage() {
  const router = useRouter();
  const [authed,     setAuthed]     = useState(false);
  const [userId,     setUserId]     = useState('');
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
  const [bodyFilterOpen, setBodyFilterOpen] = useState(false);
  const [bodySearch,     setBodySearch]     = useState('');
  const [nameModal,      setNameModal]      = useState(false);
  const [newName,        setNewName]        = useState('');

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
    const name = newName.trim();
    if (!name) return;
    setCreating(true);
    setNameModal(false);
    const { data, error } = await getSupabase()
      .from('plan_templates')
      .insert({ practitioner_id: userId, name, description: null, exercises: [] })
      .select()
      .single();
    if (!error && data) router.push(`/plans/library/${data.id}`);
    else setCreating(false);
    setNewName('');
  };

  const handleDelete = async (t: Template) => {
    if (!confirm(`Delete "${t.name || 'Untitled template'}"? This cannot be undone.`)) return;
    setDeleting(t.id);
    await getSupabase().from('plan_templates').delete().eq('id', t.id);
    setTemplates(prev => prev.filter(x => x.id !== t.id));
    setDeleting(null);
  };

  // Collect all unique tags across templates for the filter row
  const allTags = Array.from(new Set(templates.flatMap(t => (t as any).tags ?? []))).sort() as string[];

  const filtered = templates.filter(t => {
    const tags = (t as any).tags ?? [];
    if (search && !t.name.toLowerCase().includes(search.toLowerCase())) return false;
    if (activeTag && !tags.includes(activeTag)) return false;
    if (bodyFilter) {
      const inTags = tags.includes(bodyFilter);
      const inExercises = t.exercises.some((ex: any) =>
        ex?.exercise?.muscleGroup === bodyFilter || ex?.muscleGroup === bodyFilter
      );
      if (!inTags && !inExercises) return false;
    }
    return true;
  });

  // Group same-named templates so duplicates appear as one row
  const groupedFiltered: Array<{ canonical: Template; variants: Template[] }> = [];
  const nameGroupIndex = new Map<string, number>();
  for (const t of filtered) {
    if (t.name) {
      const existing = nameGroupIndex.get(t.name);
      if (existing !== undefined) {
        groupedFiltered[existing].variants.push(t);
        continue;
      }
      nameGroupIndex.set(t.name, groupedFiltered.length);
    }
    groupedFiltered.push({ canonical: t, variants: [] });
  }

  if (!authed || loading) {
    return (
      <div style={{ minHeight: '100vh', background: '#0f1117', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ width: 32, height: 32, border: `3px solid ${TEAL}`, borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: '#0f1117', color: '#fff', fontFamily: 'sans-serif' }}>
      <main style={{ maxWidth: 1100, margin: '0 auto', padding: '40px 32px' }}>
        {/* Page header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, flexWrap: 'wrap', gap: 16 }}>
          <div>
            <h1 style={{ fontSize: 28, fontWeight: 800, margin: 0 }}>📋 Plan Library</h1>
            <p style={{ color: 'rgba(255,255,255,0.4)', marginTop: 6, marginBottom: 0 }}>
              Reusable templates with week-by-week progression
            </p>
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            {templates.length > 0 && (
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search templates…"
                style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 10, padding: '10px 16px', color: '#fff', fontSize: 14, outline: 'none', width: 200 }}
              />
            )}
            {/* Body part filter */}
            {templates.length > 0 && (
              <div style={{ position: 'relative' }}>
                <button
                  onClick={() => setBodyFilterOpen(o => !o)}
                  style={{ background: bodyFilter ? `${TEAL}22` : 'rgba(255,255,255,0.07)', border: `1px solid ${bodyFilter ? TEAL : 'rgba(255,255,255,0.15)'}`, borderRadius: 10, padding: '10px 16px', color: bodyFilter ? TEAL : 'rgba(255,255,255,0.7)', fontSize: 14, fontWeight: bodyFilter ? 700 : 400, cursor: 'pointer', whiteSpace: 'nowrap' }}
                >
                  {bodyFilter || 'Body Part'} {bodyFilterOpen ? '▲' : '▼'}
                </button>
                {bodyFilterOpen && (
                  <div
                    style={{ position: 'absolute', right: 0, top: 'calc(100% + 6px)', background: '#1a1d27', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 12, zIndex: 50, width: 220, boxShadow: '0 8px 24px rgba(0,0,0,0.5)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
                  >
                    {/* Search inside dropdown */}
                    <div style={{ padding: '10px 12px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                      <input
                        autoFocus
                        value={bodySearch}
                        onChange={e => setBodySearch(e.target.value)}
                        placeholder="Search body parts…"
                        onKeyDown={e => { if (e.key === 'Escape') { setBodyFilterOpen(false); setBodySearch(''); } }}
                        style={{ width: '100%', boxSizing: 'border-box', background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8, padding: '7px 10px', color: '#fff', fontSize: 13, outline: 'none' }}
                      />
                    </div>
                    <button
                      onMouseDown={() => { setBodyFilter(''); setBodyFilterOpen(false); setBodySearch(''); }}
                      style={{ textAlign: 'left', padding: '9px 16px', background: !bodyFilter ? `${TEAL}18` : 'none', border: 'none', color: !bodyFilter ? TEAL : 'rgba(255,255,255,0.5)', fontSize: 13, fontWeight: !bodyFilter ? 700 : 400, cursor: 'pointer', borderBottom: '1px solid rgba(255,255,255,0.06)' }}
                    >
                      All body parts
                    </button>
                    <div style={{ maxHeight: 220, overflowY: 'auto' }}>
                      {BODY_PART_TAGS.filter(tag => tag.toLowerCase().includes(bodySearch.toLowerCase())).map(tag => (
                        <button
                          key={tag}
                          onMouseDown={() => { setBodyFilter(tag); setBodyFilterOpen(false); setBodySearch(''); }}
                          style={{ display: 'block', width: '100%', textAlign: 'left', padding: '9px 16px', background: bodyFilter === tag ? `${TEAL}18` : 'none', border: 'none', borderBottom: '1px solid rgba(255,255,255,0.04)', color: bodyFilter === tag ? TEAL : '#fff', fontSize: 13, fontWeight: bodyFilter === tag ? 700 : 400, cursor: 'pointer' }}
                          onMouseEnter={e => { if (bodyFilter !== tag) (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.05)'; }}
                          onMouseLeave={e => { if (bodyFilter !== tag) (e.currentTarget as HTMLButtonElement).style.background = 'none'; }}
                        >
                          {tag}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
            <button
              onClick={() => { setNewName(''); setNameModal(true); }}
              disabled={creating}
              style={{ background: TEAL, color: '#0f1117', borderRadius: 10, padding: '10px 22px', fontWeight: 700, fontSize: 14, border: 'none', cursor: creating ? 'not-allowed' : 'pointer', opacity: creating ? 0.7 : 1 }}
            >
              {creating ? 'Creating…' : '+ New Template'}
            </button>
          </div>
        </div>

        {/* Tag filter chips — only shown when at least one template has tags */}
        {allTags.length > 0 && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 16, marginBottom: 4 }}>
            <button
              onClick={() => setActiveTag(null)}
              style={{
                padding: '5px 14px', borderRadius: 999, fontSize: 12, fontWeight: 700,
                border: `1px solid ${!activeTag ? TEAL : 'rgba(255,255,255,0.18)'}`,
                background: !activeTag ? `${TEAL}22` : 'transparent',
                color: !activeTag ? TEAL : 'rgba(255,255,255,0.45)',
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
                  border: `1px solid ${activeTag === tag ? TEAL : 'rgba(255,255,255,0.18)'}`,
                  background: activeTag === tag ? `${TEAL}22` : 'transparent',
                  color: activeTag === tag ? TEAL : 'rgba(255,255,255,0.45)',
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
          <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 20, padding: 60, textAlign: 'center', marginTop: 32 }}>
            <p style={{ fontSize: 40, marginBottom: 16 }}>📋</p>
            <p style={{ color: 'rgba(255,255,255,0.4)', marginBottom: 24 }}>
              No templates yet. Create your first reusable plan template.
            </p>
            <button
              onClick={() => { setNewName(''); setNameModal(true); }}
              disabled={creating}
              style={{ background: TEAL, color: '#0f1117', borderRadius: 12, padding: '12px 28px', fontWeight: 700, fontSize: 15, border: 'none', cursor: 'pointer' }}
            >
              Create First Template
            </button>
          </div>
        ) : filtered.length === 0 ? (
          <p style={{ color: 'rgba(255,255,255,0.3)', marginTop: 40, textAlign: 'center' }}>No templates match "{search}"</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 28 }}>
            {groupedFiltered.map(({ canonical: t, variants }) => {
              const allVersions = [t, ...variants];
              const isGrouped = variants.length > 0;
              const weeks = numWeeks(t.exercises);
              return (
                <div
                  key={t.id}
                  onClick={() => setPreviewTpl(t)}
                  style={{ position: 'relative', background: hoveredId === t.id ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.04)', border: `1px solid ${hoveredId === t.id ? 'rgba(95,207,191,0.3)' : 'rgba(255,255,255,0.1)'}`, borderRadius: 16, padding: '20px 24px', display: 'flex', alignItems: 'center', gap: 20, transition: 'background 0.15s, border-color 0.15s', cursor: 'pointer' }}
                  onMouseEnter={() => setHoveredId(t.id)}
                  onMouseLeave={() => setHoveredId(null)}
                >
                  {/* Hover preview panel */}
                  {hoveredId === t.id && t.exercises.length > 0 && (
                    <div style={{
                      position: 'absolute', right: 'calc(100% + 12px)', top: 0,
                      width: 240, background: '#1a1d26', border: '1px solid rgba(255,255,255,0.15)',
                      borderRadius: 12, padding: '14px 16px', zIndex: 50,
                      boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
                      pointerEvents: 'none',
                    }}>
                      <p style={{ margin: '0 0 10px', fontWeight: 700, fontSize: 13, color: 'rgba(255,255,255,0.6)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                        {t.exercises.length} exercise{t.exercises.length !== 1 ? 's' : ''}
                      </p>
                      {t.exercises.slice(0, 8).map((ex: any, i: number) => (
                        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', borderBottom: i < Math.min(t.exercises.length, 8) - 1 ? '1px solid rgba(255,255,255,0.06)' : 'none' }}>
                          <span style={{ color: '#fff', fontSize: 13, fontWeight: 500 }}>{ex.exercise?.name ?? '—'}</span>
                          <span style={{ marginLeft: 'auto', fontSize: 11, color: 'rgba(255,255,255,0.3)', whiteSpace: 'nowrap' }}>{ex.sets?.length ?? 0} sets</span>
                        </div>
                      ))}
                      {t.exercises.length > 8 && (
                        <p style={{ margin: '8px 0 0', fontSize: 12, color: 'rgba(255,255,255,0.3)' }}>+{t.exercises.length - 8} more…</p>
                      )}
                    </div>
                  )}
                  {/* Info */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 700, fontSize: 16, color: t.name ? '#fff' : 'rgba(255,255,255,0.3)', fontStyle: t.name ? 'normal' : 'italic' }}>
                        {t.name || 'Untitled template'}
                      </span>
                      <span style={{ background: `${TEAL}20`, color: TEAL, fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 999 }}>
                        {t.exercises.length} exercise{t.exercises.length !== 1 ? 's' : ''}
                      </span>
                      {isGrouped ? (
                        // Multiple versions: show each as a clickable week-count badge
                        allVersions.map(v => {
                          const vWeeks = numWeeks(v.exercises);
                          return (
                            <button
                              key={v.id}
                              onClick={e => { e.stopPropagation(); router.push(`/plans/library/${v.id}`); }}
                              style={{ background: `${PURPLE}20`, color: PURPLE, fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 999, border: `1px solid ${PURPLE}40`, cursor: 'pointer' }}
                              title={`View / Edit ${vWeeks}-week version`}
                            >
                              {vWeeks}-week
                            </button>
                          );
                        })
                      ) : (
                        // Single template: show per-week preview buttons
                        Array.from({ length: weeks }, (_, i) => i + 1).map(w => (
                          <button
                            key={w}
                            onClick={e => { e.stopPropagation(); setPreviewTpl(t); setPreviewWeek(w); }}
                            style={{ background: `${PURPLE}20`, color: PURPLE, fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 999, border: `1px solid ${PURPLE}40`, cursor: 'pointer' }}
                            title={`Preview Week ${w}`}
                          >
                            W{w}
                          </button>
                        ))
                      )}
                    </div>
                    {t.description && (
                      <p style={{ color: 'rgba(255,255,255,0.45)', fontSize: 13, margin: '6px 0 0 0' }}>{t.description}</p>
                    )}
                    {/* Tags */}
                    {((t as any).tags ?? []).length > 0 && (
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                        {((t as any).tags as string[]).map((tag: string) => (
                          <span
                            key={tag}
                            onClick={e => { e.stopPropagation(); setActiveTag(activeTag === tag ? null : tag); }}
                            style={{ padding: '2px 10px', borderRadius: 999, fontSize: 11, fontWeight: 600, background: 'rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.5)', cursor: 'pointer', border: activeTag === tag ? `1px solid ${TEAL}` : '1px solid transparent' }}
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                    <p style={{ color: 'rgba(255,255,255,0.25)', fontSize: 12, margin: '4px 0 0 0' }}>
                      Created {new Date(t.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </p>
                  </div>

                  {/* Actions */}
                  <div onClick={e => e.stopPropagation()} style={{ display: 'flex', gap: 8, flexShrink: 0, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                    {!isGrouped && (
                      <button
                        onClick={() => router.push(`/plans/library/${t.id}`)}
                        style={{ background: `${TEAL}20`, color: TEAL, border: `1px solid ${TEAL}40`, borderRadius: 8, padding: '8px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
                      >
                        View / Edit
                      </button>
                    )}
                    <button
                      onClick={() => router.push(`/plans/new?template=${t.id}`)}
                      style={{ background: `${PURPLE}20`, color: PURPLE, border: `1px solid ${PURPLE}40`, borderRadius: 8, padding: '8px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
                    >
                      Assign to Patient
                    </button>
                    {isGrouped ? (
                      // Delete per version
                      allVersions.map(v => (
                        <button
                          key={v.id}
                          onClick={() => handleDelete(v)}
                          disabled={deleting === v.id}
                          style={{ background: 'rgba(239,68,68,0.1)', color: '#EF4444', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, padding: '8px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer', opacity: deleting === v.id ? 0.5 : 1 }}
                        >
                          Del {numWeeks(v.exercises)}wk
                        </button>
                      ))
                    ) : (
                      <button
                        onClick={() => handleDelete(t)}
                        disabled={deleting === t.id}
                        style={{ background: 'rgba(239,68,68,0.1)', color: '#EF4444', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, padding: '8px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer', opacity: deleting === t.id ? 0.5 : 1 }}
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      {/* Name modal for new template */}
      {nameModal && (
        <div onClick={() => setNameModal(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200, padding: 24 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: '#1a1d27', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 20, padding: 32, width: '100%', maxWidth: 440 }}>
            <h2 style={{ fontWeight: 700, fontSize: 18, margin: '0 0 6px' }}>Name your template</h2>
            <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13, marginBottom: 20 }}>Give it a descriptive name so it's easy to find later.</p>
            <input
              autoFocus
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && newName.trim()) handleCreate(); if (e.key === 'Escape') setNameModal(false); }}
              placeholder="e.g. Knee Rehab Phase 1"
              style={{ width: '100%', boxSizing: 'border-box', background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 10, padding: '11px 14px', color: '#fff', fontSize: 15, outline: 'none', marginBottom: 16 }}
            />
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setNameModal(false)} style={{ flex: 1, background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.15)', color: 'rgba(255,255,255,0.6)', borderRadius: 10, padding: '11px 0', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>Cancel</button>
              <button onClick={handleCreate} disabled={!newName.trim() || creating} style={{ flex: 2, background: newName.trim() ? TEAL : 'rgba(255,255,255,0.08)', color: newName.trim() ? '#0f1117' : 'rgba(255,255,255,0.3)', borderRadius: 10, padding: '11px 0', fontWeight: 700, fontSize: 14, border: 'none', cursor: newName.trim() ? 'pointer' : 'not-allowed' }}>
                {creating ? 'Creating…' : 'Create Template'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Template preview modal */}
      {previewTpl && (() => {
        const totalWeeks = numWeeks(previewTpl.exercises);
        const weekSets = (ex: any, week: number) => week === 1 ? ex.sets ?? [] : ex.weeks?.find((w: any) => w.week === week)?.sets ?? ex.sets ?? [];
        const fmtSets = (sets: any[]) => {
          const n = sets.length; const s = sets[0];
          if (!s || n === 0) return '—';
          if (s.seconds !== undefined) return `${n} × ${s.seconds}s`;
          if (s.reps !== undefined) return `${n} × ${s.reps} reps`;
          return `${n} sets`;
        };
        return (
        <div
          onClick={() => setPreviewTpl(null)}
          onKeyDown={e => { if (e.key === 'Escape') setPreviewTpl(null); }}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 24 }}
        >
          <div onClick={e => e.stopPropagation()} style={{ background: '#1a1d27', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 20, width: '100%', maxWidth: 560, maxHeight: 'calc(100vh - 80px)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            {/* Header */}
            <div style={{ padding: '24px 28px 16px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
                <div>
                  <h2 style={{ fontWeight: 800, fontSize: 20, margin: '0 0 6px' }}>
                    {previewTpl.name || 'Untitled template'}
                  </h2>
                  {previewTpl.description && (
                    <p style={{ color: 'rgba(255,255,255,0.45)', fontSize: 14, margin: '0 0 6px' }}>{previewTpl.description}</p>
                  )}
                  <span style={{ background: `${TEAL}20`, color: TEAL, fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 999 }}>
                    {previewTpl.exercises.length} exercise{previewTpl.exercises.length !== 1 ? 's' : ''}
                  </span>
                </div>
                <button onClick={() => setPreviewTpl(null)} style={{ background: 'rgba(255,255,255,0.07)', border: 'none', color: 'rgba(255,255,255,0.5)', borderRadius: 8, width: 32, height: 32, fontSize: 18, cursor: 'pointer', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
              </div>
              {/* Week tabs */}
              {totalWeeks > 1 && (
                <div style={{ display: 'flex', gap: 6 }}>
                  {Array.from({ length: totalWeeks }, (_, i) => i + 1).map(w => (
                    <button key={w} onClick={() => setPreviewWeek(w)} style={{ padding: '5px 14px', borderRadius: 8, fontSize: 13, fontWeight: 700, border: `1px solid ${previewWeek === w ? PURPLE : 'rgba(255,255,255,0.15)'}`, background: previewWeek === w ? `${PURPLE}22` : 'transparent', color: previewWeek === w ? PURPLE : 'rgba(255,255,255,0.4)', cursor: 'pointer' }}>
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
                    return (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', borderBottom: i < previewTpl.exercises.length - 1 ? '1px solid rgba(255,255,255,0.06)' : 'none' }}>
                      <div>
                        <span style={{ fontSize: 14, fontWeight: 600, color: '#fff' }}>{i + 1}. {ex.exercise?.name ?? '—'}</span>
                        {ex.exercise?.muscleGroup && (
                          <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)', marginLeft: 8 }}>{ex.exercise.muscleGroup}</span>
                        )}
                      </div>
                      <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)', whiteSpace: 'nowrap' }}>
                        {ex.sets?.length ?? ex.targetSets ?? 0} sets
                        {ex.sets?.[0]?.reps ? ` · ${ex.sets[0].reps} reps` : ''}
                        {ex.sets?.[0]?.duration ? ` · ${ex.sets[0].duration}s` : ''}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Footer actions */}
            <div style={{ padding: '16px 28px', borderTop: '1px solid rgba(255,255,255,0.08)', display: 'flex', gap: 10 }}>
              <button
                onClick={() => router.push(`/plans/library/${previewTpl.id}`)}
                style={{ flex: 1, background: `${TEAL}20`, color: TEAL, border: `1px solid ${TEAL}40`, borderRadius: 10, padding: '11px 0', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}
              >
                View / Edit
              </button>
              <button
                onClick={() => router.push(`/plans/new?template=${previewTpl.id}`)}
                style={{ flex: 1, background: PURPLE, color: '#fff', border: 'none', borderRadius: 10, padding: '11px 0', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}
              >
                Assign to Patient
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
