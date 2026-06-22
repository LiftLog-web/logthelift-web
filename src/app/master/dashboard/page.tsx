'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getSupabase } from '@/lib/supabase';

const TEAL   = '#5fcfbf';
const PURPLE = '#C471ED';
const MASTER_ID = process.env.NEXT_PUBLIC_FEATURED_PRACTITIONER_ID || '969ea6c6-ba6d-4ee4-8bb8-a7cee267f40c';

interface Stats {
  avg_effectiveness:     number | null;
  effectiveness_count:   number;
  avg_enjoyment:         number | null;
  enjoyment_count:       number;
  active_employer_count: number;
  total_employee_count:  number;
}

interface UpcomingProgram {
  id:                      string;
  name:                    string;
  catalog_available_from:  string;
  catalog_available_until: string | null;
  featured_duration_days:  number | null;
}

function StarDisplay({ value, color }: { value: number; color: string }) {
  const full  = Math.round(value);
  const stars = '★'.repeat(full) + '☆'.repeat(5 - full);
  return <span style={{ color, fontSize: 14 }}>{stars}</span>;
}

function fmtDate(d: string) {
  return new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtMonth(d: string) {
  return new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

function isLive(p: UpcomingProgram): boolean {
  const today = new Date().toISOString().slice(0, 10);
  return p.catalog_available_from <= today && (!p.catalog_available_until || p.catalog_available_until >= today);
}

export default function MasterDashboardPage() {
  const router = useRouter();
  const [displayName, setDisplayName]         = useState('');
  const [email, setEmail]                     = useState('');
  const [stats, setStats]                     = useState<Stats | null>(null);
  const [upcoming, setUpcoming]               = useState<UpcomingProgram[]>([]);
  const [loading, setLoading]                 = useState(true);

  useEffect(() => {
    const sb = getSupabase();
    sb.auth.getSession().then(async ({ data }) => {
      if (!data.session || data.session.user.id !== MASTER_ID) {
        router.push('/login');
        return;
      }

      const today = new Date().toISOString().slice(0, 10);

      const [profResult, statsResult, upcomingResult] = await Promise.all([
        sb.from('profiles').select('display_name, email').eq('id', MASTER_ID).single(),
        sb.rpc('get_featured_program_stats', { p_practitioner_id: MASTER_ID }),
        sb
          .from('plan_templates')
          .select('id, name, catalog_available_from, catalog_available_until, featured_duration_days')
          .eq('practitioner_id', MASTER_ID)
          .eq('is_featured', true)
          .not('catalog_available_from', 'is', null)
          .gte('catalog_available_until', today)
          .order('catalog_available_from', { ascending: true })
          .limit(6),
      ]);

      setDisplayName((profResult.data as any)?.display_name ?? '');
      setEmail((profResult.data as any)?.email ?? '');
      setStats((statsResult.data as Stats[])?.[0] ?? null);
      setUpcoming((upcomingResult.data as UpcomingProgram[]) ?? []);
      setLoading(false);
    });
  }, [router]);

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p style={{ color: 'var(--text-muted)' }}>Loading…</p>
      </div>
    );
  }

  const noData = !stats || (stats.effectiveness_count === 0 && stats.enjoyment_count === 0);

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', color: 'var(--text)', fontFamily: 'sans-serif' }}>
      <main style={{ maxWidth: 900, margin: '0 auto', padding: '40px 32px' }}>

        {/* Header */}
        <div style={{ marginBottom: 36 }}>
          <h1 style={{ fontSize: 28, fontWeight: 800, margin: '0 0 6px' }}>Dashboard</h1>
          <p style={{ color: 'var(--text-muted)', margin: 0, fontSize: 14 }}>
            {displayName} · {email}
          </p>
        </div>

        {/* Summary numbers */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14, marginBottom: 32 }}>
          <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16, padding: '22px 20px' }}>
            <p style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text-dim)', margin: '0 0 10px' }}>Active Clients</p>
            <p style={{ fontSize: 32, fontWeight: 800, color: 'var(--text)', margin: '0 0 4px' }}>
              {stats?.active_employer_count ?? '—'}
            </p>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>running a program</p>
          </div>

          <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16, padding: '22px 20px' }}>
            <p style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text-dim)', margin: '0 0 10px' }}>Total Employees</p>
            <p style={{ fontSize: 32, fontWeight: 800, color: 'var(--text)', margin: '0 0 4px' }}>
              {stats?.total_employee_count ?? '—'}
            </p>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>across all clients</p>
          </div>

          <div style={{ background: 'var(--card)', border: `1px solid ${PURPLE}30`, borderRadius: 16, padding: '22px 20px' }}>
            <p style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text-dim)', margin: '0 0 10px' }}>Avg Effectiveness</p>
            {stats?.avg_effectiveness != null ? (
              <>
                <p style={{ fontSize: 32, fontWeight: 800, color: PURPLE, margin: '0 0 4px' }}>
                  {Number(stats.avg_effectiveness).toFixed(1)}
                  <span style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-muted)', marginLeft: 2 }}>/5</span>
                </p>
                <StarDisplay value={Number(stats.avg_effectiveness)} color={PURPLE} />
                <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '6px 0 0' }}>
                  {stats.effectiveness_count} rating{stats.effectiveness_count !== 1 ? 's' : ''}
                </p>
              </>
            ) : (
              <p style={{ fontSize: 24, fontWeight: 800, color: 'var(--text-dim)', margin: 0 }}>—</p>
            )}
          </div>

          <div style={{ background: 'var(--card)', border: `1px solid ${TEAL}30`, borderRadius: 16, padding: '22px 20px' }}>
            <p style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text-dim)', margin: '0 0 10px' }}>Avg Enjoyment</p>
            {stats?.avg_enjoyment != null ? (
              <>
                <p style={{ fontSize: 32, fontWeight: 800, color: TEAL, margin: '0 0 4px' }}>
                  {Number(stats.avg_enjoyment).toFixed(1)}
                  <span style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-muted)', marginLeft: 2 }}>/5</span>
                </p>
                <StarDisplay value={Number(stats.avg_enjoyment)} color={TEAL} />
                <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '6px 0 0' }}>
                  {stats.enjoyment_count} rating{stats.enjoyment_count !== 1 ? 's' : ''}
                </p>
              </>
            ) : (
              <p style={{ fontSize: 24, fontWeight: 800, color: 'var(--text-dim)', margin: 0 }}>—</p>
            )}
          </div>
        </div>

        {noData && (
          <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16, padding: '28px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 14 }}>
            No rating data yet. Ratings appear once employees complete workouts and submit feedback in the app.
          </div>
        )}

        {/* Program Schedule */}
        <div style={{ marginTop: 32 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>Program Schedule</h2>
            <a href="/master/programs" style={{ fontSize: 13, color: TEAL, textDecoration: 'none', fontWeight: 600 }}>
              Manage →
            </a>
          </div>

          {upcoming.length === 0 ? (
            <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16, padding: '28px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 14 }}>
              No programs scheduled. Head to Programs to set catalog dates.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {upcoming.map(p => {
                const live = isLive(p);
                return (
                  <div
                    key={p.id}
                    style={{
                      background: 'var(--card)',
                      border: `1px solid ${live ? TEAL + '40' : 'var(--border)'}`,
                      borderRadius: 14,
                      padding: '16px 20px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 14,
                    }}
                  >
                    {/* Status dot */}
                    <div style={{
                      width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                      background: live ? TEAL : 'var(--border-strong)',
                      boxShadow: live ? `0 0 6px ${TEAL}80` : 'none',
                    }} />

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontSize: 14, fontWeight: 700, margin: '0 0 3px', color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {p.name}
                      </p>
                      <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>
                        {fmtDate(p.catalog_available_from)}
                        {p.catalog_available_until && ` → ${fmtDate(p.catalog_available_until)}`}
                      </p>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                      {p.featured_duration_days && (
                        <span style={{ fontSize: 11, fontWeight: 600, color: PURPLE, background: PURPLE + '18', borderRadius: 999, padding: '2px 8px' }}>
                          {p.featured_duration_days}d
                        </span>
                      )}
                      <span style={{
                        fontSize: 11, fontWeight: 700, borderRadius: 999, padding: '3px 10px',
                        background: live ? TEAL + '18' : `${TEAL}08`,
                        color: live ? TEAL : 'var(--text-dim)',
                        border: `1px solid ${live ? TEAL + '40' : 'var(--border-strong)'}`,
                      }}>
                        {live ? 'LIVE' : fmtMonth(p.catalog_available_from)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

      </main>
    </div>
  );
}
