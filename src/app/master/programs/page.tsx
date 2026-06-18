'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getSupabase } from '@/lib/supabase';

const TEAL   = '#5fcfbf';
const PURPLE = '#C471ED';
const MASTER_ID = process.env.NEXT_PUBLIC_FEATURED_PRACTITIONER_ID ?? '';

interface Program {
  template_id:            string;
  template_name:          string;
  template_description:   string | null;
  featured_duration_days: number | null;
  employer_count:         number;
}

export default function MasterProgramsPage() {
  const router = useRouter();
  const [programs, setPrograms] = useState<Program[]>([]);
  const [loading, setLoading]   = useState(true);

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

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p style={{ color: 'var(--text-muted)' }}>Loading…</p>
      </div>
    );
  }

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
        </div>

        {programs.length === 0 ? (
          <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 20, padding: '60px', textAlign: 'center' }}>
            <p style={{ fontSize: 32, marginBottom: 12 }}>📋</p>
            <p style={{ color: 'var(--text-muted)', fontSize: 15, marginBottom: 24 }}>
              No featured templates yet. Mark plan templates as featured in Supabase Studio to list them here.
            </p>
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

        <div style={{ marginTop: 28, background: 'var(--card)', border: '1px solid var(--border-subtle)', borderRadius: 14, padding: '16px 20px', fontSize: 13, color: 'var(--text-muted)' }}>
          To add a new featured program, create a plan template in Supabase Studio and set{' '}
          <code style={{ background: 'var(--card-alt)', padding: '1px 6px', borderRadius: 4, fontSize: 12 }}>is_featured = true</code>{' '}
          and <code style={{ background: 'var(--card-alt)', padding: '1px 6px', borderRadius: 4, fontSize: 12 }}>featured_duration_days</code>.
        </div>
      </main>
    </div>
  );
}
