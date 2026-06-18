'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getSupabase } from '@/lib/supabase';

const TEAL   = '#5fcfbf';
const PURPLE = '#C471ED';
const MASTER_ID = process.env.NEXT_PUBLIC_FEATURED_PRACTITIONER_ID || '969ea6c6-ba6d-4ee4-8bb8-a7cee267f40c';

interface Client {
  employer_id:        string;
  employer_name:      string;
  company_name:       string | null;
  employee_count:     number;
  program_name:       string;
  program_started_at: string;
  program_ends_at:    string;
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function programStatus(endsAt: string): { label: string; color: string } {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const end = new Date(endsAt);
  if (end < today) return { label: 'Ended', color: 'var(--text-dim)' };
  const daysLeft = Math.ceil((end.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  return { label: `${daysLeft}d left`, color: TEAL };
}

export default function MasterClientsPage() {
  const router  = useRouter();
  const [clients, setClients]   = useState<Client[]>([]);
  const [loading, setLoading]   = useState(true);

  useEffect(() => {
    const sb = getSupabase();
    sb.auth.getSession().then(async ({ data }) => {
      if (!data.session || data.session.user.id !== MASTER_ID) {
        router.push('/login');
        return;
      }

      const { data: rows } = await sb.rpc('get_master_clients', { p_practitioner_id: MASTER_ID });
      setClients((rows as Client[]) ?? []);
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

  const activeClients  = clients.filter(c => new Date(c.program_ends_at) >= new Date(new Date().toDateString()));
  const pastClients    = clients.filter(c => new Date(c.program_ends_at) <  new Date(new Date().toDateString()));
  const uniqueEmployers = new Set(clients.map(c => c.employer_id)).size;

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', color: 'var(--text)', fontFamily: 'sans-serif' }}>
      <main style={{ maxWidth: 900, margin: '0 auto', padding: '40px 32px' }}>

        <div style={{ marginBottom: 32 }}>
          <h1 style={{ fontSize: 28, fontWeight: 800, margin: '0 0 6px' }}>Clients</h1>
          <p style={{ color: 'var(--text-muted)', margin: 0, fontSize: 14 }}>
            {uniqueEmployers} client{uniqueEmployers !== 1 ? 's' : ''} · {clients.length} program{clients.length !== 1 ? 's' : ''} total
          </p>
        </div>

        {clients.length === 0 ? (
          <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 20, padding: '60px', textAlign: 'center' }}>
            <p style={{ fontSize: 32, marginBottom: 12 }}>🏢</p>
            <p style={{ color: 'var(--text-muted)', fontSize: 15 }}>
              No clients yet. Once an employer launches one of your featured programs, they'll appear here.
            </p>
          </div>
        ) : (
          <>
            {/* Active programs */}
            {activeClients.length > 0 && (
              <section style={{ marginBottom: 32 }}>
                <h2 style={{ fontSize: 12, fontWeight: 700, margin: '0 0 14px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  Active Programs ({activeClients.length})
                </h2>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {activeClients.map((c, i) => {
                    const status = programStatus(c.program_ends_at);
                    return (
                      <div key={`${c.employer_id}-${i}`} style={{ background: 'var(--card)', border: `1px solid ${TEAL}30`, borderRadius: 16, padding: '20px 22px', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
                        <div style={{ flex: 1, minWidth: 180 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4, flexWrap: 'wrap' }}>
                            <p style={{ fontWeight: 700, fontSize: 16, margin: 0 }}>
                              {c.company_name || c.employer_name}
                            </p>
                            <span style={{ background: `${TEAL}20`, color: TEAL, fontSize: 11, fontWeight: 700, padding: '2px 9px', borderRadius: 999 }}>
                              {status.label}
                            </span>
                          </div>
                          <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: '0 0 6px' }}>
                            {c.program_name}
                          </p>
                          <p style={{ fontSize: 12, color: 'var(--text-dim)', margin: 0 }}>
                            {formatDate(c.program_started_at)} → {formatDate(c.program_ends_at)}
                          </p>
                        </div>
                        <div style={{ textAlign: 'right', flexShrink: 0 }}>
                          <p style={{ fontSize: 24, fontWeight: 800, color: PURPLE, margin: '0 0 2px' }}>
                            {c.employee_count}
                          </p>
                          <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>
                            employee{c.employee_count !== 1 ? 's' : ''}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            {/* Past programs */}
            {pastClients.length > 0 && (
              <section>
                <h2 style={{ fontSize: 12, fontWeight: 700, margin: '0 0 14px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  Past Programs ({pastClients.length})
                </h2>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {pastClients.map((c, i) => (
                    <div key={`${c.employer_id}-past-${i}`} style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, padding: '16px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', opacity: 0.75 }}>
                      <div>
                        <p style={{ fontWeight: 600, fontSize: 15, margin: '0 0 2px' }}>
                          {c.company_name || c.employer_name}
                        </p>
                        <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: 0 }}>
                          {c.program_name} · {formatDate(c.program_started_at)} – {formatDate(c.program_ends_at)}
                        </p>
                      </div>
                      <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0, whiteSpace: 'nowrap' }}>
                        {c.employee_count} employee{c.employee_count !== 1 ? 's' : ''}
                      </p>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </main>
    </div>
  );
}
