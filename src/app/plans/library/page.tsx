'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getSupabase } from '@/lib/supabase';

const TEAL   = '#5fcfbf';
const PURPLE = '#C471ED';

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
    if (!error && data) {
      router.push(`/plans/library/${data.id}`);
    } else {
      setCreating(false);
    }
  };

  const handleDelete = async (t: Template) => {
    if (!confirm(`Delete "${t.name || 'Untitled template'}"? This cannot be undone.`)) return;
    setDeleting(t.id);
    await getSupabase().from('plan_templates').delete().eq('id', t.id);
    setTemplates(prev => prev.filter(x => x.id !== t.id));
    setDeleting(null);
  };

  const filtered = templates.filter(t => t.name.toLowerCase().includes(search.toLowerCase()));

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
      {/* Nav */}
      <nav style={{ borderBottom: '1px solid rgba(255,255,255,0.1)', padding: '16px 32px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', maxWidth: 1100, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <a href="/" style={{ color: TEAL, fontWeight: 800, fontSize: 20, textDecoration: 'none' }}>LiftLog</a>
          <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: 14 }}>/ </span>
          <a href="/plans" style={{ color: 'rgba(255,255,255,0.5)', fontSize: 14, textDecoration: 'none' }}>Plans</a>
          <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: 14 }}>/ Library</span>
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          <a href="/profile" style={{ color: 'rgba(255,255,255,0.5)', fontSize: 14, textDecoration: 'none', padding: '8px 16px' }}>Profile</a>
          <button
            onClick={handleCreate}
            disabled={creating}
            style={{ background: TEAL, color: '#0f1117', borderRadius: 10, padding: '8px 20px', fontWeight: 700, fontSize: 14, border: 'none', cursor: creating ? 'not-allowed' : 'pointer', opacity: creating ? 0.7 : 1 }}
          >
            {creating ? 'Creating…' : '+ New Template'}
          </button>
        </div>
      </nav>

      <main style={{ maxWidth: 1100, margin: '0 auto', padding: '40px 32px' }}>
        {/* Page header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, flexWrap: 'wrap', gap: 16 }}>
          <div>
            <h1 style={{ fontSize: 28, fontWeight: 800, margin: 0 }}>📋 Plan Library</h1>
            <p style={{ color: 'rgba(255,255,255,0.4)', marginTop: 6, marginBottom: 0 }}>
              Reusable templates with week-by-week progression
            </p>
          </div>
          {templates.length > 0 && (
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search templates…"
              style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 10, padding: '10px 16px', color: '#fff', fontSize: 14, outline: 'none', width: 220 }}
            />
          )}
        </div>

        {/* Empty state */}
        {templates.length === 0 ? (
          <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 20, padding: 60, textAlign: 'center', marginTop: 32 }}>
            <p style={{ fontSize: 40, marginBottom: 16 }}>📋</p>
            <p style={{ color: 'rgba(255,255,255,0.4)', marginBottom: 24 }}>
              No templates yet. Create your first reusable plan template.
            </p>
            <button
              onClick={handleCreate}
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
            {filtered.map(t => {
              const weeks = numWeeks(t.exercises);
              return (
                <div
                  key={t.id}
                  style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 16, padding: '20px 24px', display: 'flex', alignItems: 'center', gap: 20 }}
                >
                  {/* Info */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 700, fontSize: 16, color: t.name ? '#fff' : 'rgba(255,255,255,0.3)', fontStyle: t.name ? 'normal' : 'italic' }}>
                        {t.name || 'Untitled template'}
                      </span>
                      <span style={{ background: `${TEAL}20`, color: TEAL, fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 999 }}>
                        {t.exercises.length} exercise{t.exercises.length !== 1 ? 's' : ''}
                      </span>
                      <span style={{ background: `${PURPLE}20`, color: PURPLE, fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 999 }}>
                        {weeks}-week program
                      </span>
                    </div>
                    {t.description && (
                      <p style={{ color: 'rgba(255,255,255,0.45)', fontSize: 13, margin: '6px 0 0 0' }}>{t.description}</p>
                    )}
                    <p style={{ color: 'rgba(255,255,255,0.25)', fontSize: 12, margin: '4px 0 0 0' }}>
                      Created {new Date(t.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </p>
                  </div>

                  {/* Actions */}
                  <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                    <button
                      onClick={() => router.push(`/plans/library/${t.id}`)}
                      style={{ background: `${TEAL}20`, color: TEAL, border: `1px solid ${TEAL}40`, borderRadius: 8, padding: '8px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => router.push(`/plans/new?template=${t.id}`)}
                      style={{ background: `${PURPLE}20`, color: PURPLE, border: `1px solid ${PURPLE}40`, borderRadius: 8, padding: '8px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
                    >
                      Use for Patient →
                    </button>
                    <button
                      onClick={() => handleDelete(t)}
                      disabled={deleting === t.id}
                      style={{ background: 'rgba(239,68,68,0.1)', color: '#EF4444', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, padding: '8px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer', opacity: deleting === t.id ? 0.5 : 1 }}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
