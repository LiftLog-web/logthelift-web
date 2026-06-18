'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getSupabase } from '@/lib/supabase';

const TEAL   = '#5fcfbf';
const PURPLE = '#C471ED';
const MASTER_ID = process.env.NEXT_PUBLIC_FEATURED_PRACTITIONER_ID ?? '';

interface Stats {
  avg_effectiveness:     number | null;
  effectiveness_count:   number;
  avg_enjoyment:         number | null;
  enjoyment_count:       number;
  active_employer_count: number;
  total_employee_count:  number;
}

function StarDisplay({ value, color }: { value: number; color: string }) {
  const full  = Math.round(value);
  const stars = '★'.repeat(full) + '☆'.repeat(5 - full);
  return <span style={{ color, fontSize: 14 }}>{stars}</span>;
}

export default function MasterDashboardPage() {
  const router = useRouter();
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail]             = useState('');
  const [stats, setStats]             = useState<Stats | null>(null);
  const [loading, setLoading]         = useState(true);

  useEffect(() => {
    const sb = getSupabase();
    sb.auth.getSession().then(async ({ data }) => {
      if (!data.session || data.session.user.id !== MASTER_ID) {
        router.push('/login');
        return;
      }

      const [profResult, statsResult] = await Promise.all([
        sb.from('profiles').select('display_name, email').eq('id', MASTER_ID).single(),
        sb.rpc('get_featured_program_stats', { p_practitioner_id: MASTER_ID }),
      ]);

      setDisplayName((profResult.data as any)?.display_name ?? '');
      setEmail((profResult.data as any)?.email ?? '');
      setStats((statsResult.data as Stats[])?.[0] ?? null);
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

        {/* Quick links */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 14, marginTop: 32 }}>
          <a href="/master/clients" style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16, padding: '22px 24px', textDecoration: 'none', color: 'var(--text)', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <p style={{ fontWeight: 700, fontSize: 16, margin: 0 }}>View Clients →</p>
            <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: 0 }}>See all employers running your programs.</p>
          </a>
          <a href="/master/programs" style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16, padding: '22px 24px', textDecoration: 'none', color: 'var(--text)', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <p style={{ fontWeight: 700, fontSize: 16, margin: 0 }}>Manage Programs →</p>
            <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: 0 }}>View and edit your featured plan templates.</p>
          </a>
        </div>
      </main>
    </div>
  );
}
