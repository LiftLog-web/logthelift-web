'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState, useMemo } from 'react';
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

interface EmployerRating {
  plan_name:         string;
  plan_template_id:  string;
  avg_effectiveness: number | null;
  avg_enjoyment:     number | null;
  rating_count:      number;
  completed_count:   number;
  total_count:       number;
}

interface EmployerGroup {
  id:       string;
  name:     string;
  company:  string;
  programs: Client[];
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function isActive(c: Client): boolean {
  return c.program_ends_at >= new Date().toISOString().slice(0, 10);
}

function daysLeft(endsAt: string): number {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return Math.ceil((new Date(endsAt).getTime() - today.getTime()) / 86400000);
}

function RatingBar({ label, value, color }: { label: string; value: number; color: string }) {
  const pct = Math.round((value / 5) * 100);
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</span>
        <span style={{ fontSize: 13, fontWeight: 800, color }}>{value.toFixed(1)}<span style={{ fontSize: 10, fontWeight: 500, color: 'var(--text-dim)', marginLeft: 2 }}>/5</span></span>
      </div>
      <div style={{ height: 5, background: 'var(--border-strong)', borderRadius: 999, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 999, transition: 'width 0.5s ease' }} />
      </div>
    </div>
  );
}

export default function MasterClientsPage() {
  const router = useRouter();
  const [clients,        setClients]        = useState<Client[]>([]);
  const [selected,       setSelected]       = useState<string | null>(null);
  // employer_id → plan_name → EmployerRating
  const [employerRatings, setEmployerRatings] = useState<Record<string, Record<string, EmployerRating>>>({});
  const [loadingRatings,  setLoadingRatings]  = useState<Set<string>>(new Set());
  const [loading,        setLoading]        = useState(true);

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

  // Lazy-load per-employer ratings when a card is expanded
  useEffect(() => {
    if (!selected || employerRatings[selected] !== undefined) return;

    const sb = getSupabase();
    setLoadingRatings(prev => new Set(prev).add(selected));

    sb.rpc('get_master_employer_ratings', {
      p_practitioner_id: MASTER_ID,
      p_employer_id:     selected,
    }).then(({ data }) => {
      const map: Record<string, EmployerRating> = {};
      for (const r of (data as EmployerRating[]) ?? []) map[r.plan_name] = r;
      setEmployerRatings(prev => ({ ...prev, [selected]: map }));
      setLoadingRatings(prev => { const s = new Set(prev); s.delete(selected); return s; });
    });
  }, [selected, employerRatings]);

  const employers = useMemo<EmployerGroup[]>(() => {
    const map = new Map<string, EmployerGroup>();
    for (const c of clients) {
      if (!map.has(c.employer_id)) {
        map.set(c.employer_id, {
          id:       c.employer_id,
          name:     c.employer_name,
          company:  c.company_name ?? c.employer_name,
          programs: [],
        });
      }
      map.get(c.employer_id)!.programs.push(c);
    }
    return [...map.values()].sort((a, b) => {
      const aActive = a.programs.some(isActive) ? 0 : 1;
      const bActive = b.programs.some(isActive) ? 0 : 1;
      return aActive - bActive || a.company.localeCompare(b.company);
    });
  }, [clients]);

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

        <div style={{ marginBottom: 32 }}>
          <h1 style={{ fontSize: 28, fontWeight: 800, margin: '0 0 6px' }}>Clients</h1>
          <p style={{ color: 'var(--text-muted)', margin: 0, fontSize: 14 }}>
            {employers.length} client{employers.length !== 1 ? 's' : ''} · {clients.length} program{clients.length !== 1 ? 's' : ''} total
          </p>
        </div>

        {employers.length === 0 ? (
          <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 20, padding: '60px', textAlign: 'center' }}>
            <p style={{ fontSize: 32, marginBottom: 12 }}>🏢</p>
            <p style={{ color: 'var(--text-muted)', fontSize: 15 }}>
              No clients yet. Once an employer launches one of your featured programs, they'll appear here.
            </p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {employers.map(employer => {
              const isSelected     = selected === employer.id;
              const activePrograms = employer.programs.filter(isActive);
              const pastPrograms   = employer.programs.filter(p => !isActive(p));
              const totalEmployees = employer.programs.reduce((max, p) => Math.max(max, p.employee_count), 0);
              const ratingsMap     = employerRatings[employer.id];
              const isLoadingRatings = loadingRatings.has(employer.id);

              // Aggregate scores for the card preview (only if ratings already loaded)
              const ratedPrograms = ratingsMap
                ? Object.values(ratingsMap).filter(r => Number(r.rating_count) > 0)
                : [];
              const aggEff = ratedPrograms.length > 0
                ? ratedPrograms.reduce((s, r) => s + (Number(r.avg_effectiveness) || 0), 0) / ratedPrograms.length
                : null;
              const aggEnj = ratedPrograms.length > 0
                ? ratedPrograms.reduce((s, r) => s + (Number(r.avg_enjoyment) || 0), 0) / ratedPrograms.length
                : null;

              return (
                <div key={employer.id}>
                  {/* Employer card */}
                  <button
                    onClick={() => setSelected(isSelected ? null : employer.id)}
                    style={{
                      width: '100%', textAlign: 'left', border: 'none', cursor: 'pointer',
                      background: isSelected ? `${TEAL}10` : 'var(--card)',
                      borderRadius: isSelected ? '16px 16px 0 0' : 16,
                      borderTop:    `1px solid ${isSelected ? TEAL + '40' : 'var(--border)'}`,
                      borderLeft:   `1px solid ${isSelected ? TEAL + '40' : 'var(--border)'}`,
                      borderRight:  `1px solid ${isSelected ? TEAL + '40' : 'var(--border)'}`,
                      borderBottom: isSelected ? 'none' : `1px solid ${isSelected ? TEAL + '40' : 'var(--border)'}`,
                      padding: '18px 22px',
                      display: 'flex', alignItems: 'center', gap: 16,
                      transition: 'background 0.15s, border-color 0.15s',
                    }}
                  >
                    {/* Company initial avatar */}
                    <div style={{
                      width: 44, height: 44, borderRadius: 12, flexShrink: 0,
                      background: isSelected ? `${TEAL}20` : 'var(--input-bg)',
                      border: `1px solid ${isSelected ? TEAL + '40' : 'var(--border-strong)'}`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 17, fontWeight: 800,
                      color: isSelected ? TEAL : 'var(--text-dim)',
                    }}>
                      {employer.company.charAt(0).toUpperCase()}
                    </div>

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontSize: 15, fontWeight: 700, margin: '0 0 3px', color: 'var(--text)' }}>
                        {employer.company}
                      </p>
                      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                        {activePrograms.length > 0 && (
                          <span style={{ fontSize: 12, color: TEAL, fontWeight: 600 }}>
                            {activePrograms.length} active program{activePrograms.length !== 1 ? 's' : ''}
                          </span>
                        )}
                        {pastPrograms.length > 0 && (
                          <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>
                            {pastPrograms.length} past
                          </span>
                        )}
                        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                          · {totalEmployees} employee{totalEmployees !== 1 ? 's' : ''}
                        </span>
                      </div>
                    </div>

                    {/* Score preview (shows after ratings load) */}
                    {aggEff != null && (
                      <div style={{ display: 'flex', gap: 14, flexShrink: 0 }}>
                        <div style={{ textAlign: 'center' }}>
                          <p style={{ fontSize: 16, fontWeight: 800, color: PURPLE, margin: 0 }}>{aggEff.toFixed(1)}</p>
                          <p style={{ fontSize: 10, color: 'var(--text-dim)', margin: 0, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Effect.</p>
                        </div>
                        {aggEnj != null && (
                          <div style={{ textAlign: 'center' }}>
                            <p style={{ fontSize: 16, fontWeight: 800, color: TEAL, margin: 0 }}>{aggEnj.toFixed(1)}</p>
                            <p style={{ fontSize: 10, color: 'var(--text-dim)', margin: 0, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Enjoy.</p>
                          </div>
                        )}
                      </div>
                    )}

                    <span style={{ fontSize: 18, color: 'var(--text-dim)', transform: isSelected ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s', flexShrink: 0 }}>
                      ⌄
                    </span>
                  </button>

                  {/* Expanded detail panel */}
                  {isSelected && (
                    <div style={{
                      background: `${TEAL}06`,
                      border: `1px solid ${TEAL}40`,
                      borderTop: `1px solid ${TEAL}18`,
                      borderRadius: '0 0 16px 16px',
                      padding: '20px 22px 24px',
                    }}>

                      {isLoadingRatings ? (
                        <p style={{ color: 'var(--text-muted)', fontSize: 13, textAlign: 'center', padding: '16px 0' }}>
                          Loading scores…
                        </p>
                      ) : (
                        <>
                          {/* Aggregate ratings bar */}
                          {(aggEff != null || aggEnj != null) && (
                            <div style={{
                              background: 'var(--card)',
                              border: '1px solid var(--border)',
                              borderRadius: 12,
                              padding: '16px 18px',
                              marginBottom: 18,
                              display: 'grid',
                              gridTemplateColumns: aggEnj != null ? '1fr 1fr' : '1fr',
                              gap: 14,
                            }}>
                              {aggEff != null && <RatingBar label="Avg Effectiveness" value={aggEff} color={PURPLE} />}
                              {aggEnj != null && <RatingBar label="Avg Enjoyment"     value={aggEnj} color={TEAL} />}
                            </div>
                          )}

                          {/* Per-program rows */}
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                            {employer.programs
                              .slice()
                              .sort((a, b) =>
                                (isActive(a) ? 0 : 1) - (isActive(b) ? 0 : 1) ||
                                a.program_started_at.localeCompare(b.program_started_at)
                              )
                              .map((prog, i) => {
                                const active    = isActive(prog);
                                const days      = daysLeft(prog.program_ends_at);
                                const r         = ratingsMap?.[prog.program_name] ?? null;
                                const hasRating = r != null && Number(r.rating_count) > 0;
                                const eff       = hasRating ? r!.avg_effectiveness : null;
                                const enj       = hasRating ? r!.avg_enjoyment     : null;

                                return (
                                  <div
                                    key={`${prog.employer_id}-${i}`}
                                    style={{
                                      background: 'var(--card)',
                                      border: `1px solid ${active ? TEAL + '30' : 'var(--border)'}`,
                                      borderRadius: 12,
                                      padding: '14px 16px',
                                      opacity: active ? 1 : 0.7,
                                    }}
                                  >
                                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                                      <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3, flexWrap: 'wrap' }}>
                                          <p style={{ fontSize: 14, fontWeight: 700, margin: 0, color: 'var(--text)' }}>
                                            {prog.program_name}
                                          </p>
                                          {active ? (
                                            <span style={{ fontSize: 11, fontWeight: 700, color: TEAL, background: `${TEAL}18`, border: `1px solid ${TEAL}40`, borderRadius: 999, padding: '2px 8px' }}>
                                              {days > 0 ? `${days}d left` : 'Last day'}
                                            </span>
                                          ) : (
                                            <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-dim)', background: 'var(--input-bg)', border: '1px solid var(--border-strong)', borderRadius: 999, padding: '2px 8px' }}>
                                              Ended
                                            </span>
                                          )}
                                        </div>
                                        <p style={{ fontSize: 12, color: 'var(--text-dim)', margin: 0 }}>
                                          {formatDate(prog.program_started_at)} → {formatDate(prog.program_ends_at)}
                                        </p>
                                      </div>

                                      {/* Per-program scores */}
                                      {hasRating ? (
                                        <div style={{ display: 'flex', gap: 12, flexShrink: 0, alignItems: 'center' }}>
                                          {eff != null && (
                                            <div style={{ textAlign: 'center' }}>
                                              <p style={{ fontSize: 15, fontWeight: 800, color: PURPLE, margin: 0 }}>{Number(eff).toFixed(1)}</p>
                                              <p style={{ fontSize: 10, color: 'var(--text-dim)', margin: 0, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Effect.</p>
                                            </div>
                                          )}
                                          {enj != null && (
                                            <div style={{ textAlign: 'center' }}>
                                              <p style={{ fontSize: 15, fontWeight: 800, color: TEAL, margin: 0 }}>{Number(enj).toFixed(1)}</p>
                                              <p style={{ fontSize: 10, color: 'var(--text-dim)', margin: 0, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Enjoy.</p>
                                            </div>
                                          )}
                                          <div style={{ textAlign: 'center' }}>
                                            <p style={{ fontSize: 15, fontWeight: 800, color: 'var(--text-muted)', margin: 0 }}>{r!.rating_count}</p>
                                            <p style={{ fontSize: 10, color: 'var(--text-dim)', margin: 0, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Ratings</p>
                                          </div>
                                        </div>
                                      ) : (
                                        <span style={{ fontSize: 12, color: 'var(--text-dim)', alignSelf: 'center', flexShrink: 0 }}>No ratings yet</span>
                                      )}
                                    </div>

                                    {/* Completion bar */}
                                    {r != null && r.total_count > 0 && (
                                      <div style={{ marginTop: 10 }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                                          <span style={{ fontSize: 11, color: 'var(--text-dim)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Completion</span>
                                          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)' }}>
                                            {r.completed_count}/{r.total_count} employees
                                          </span>
                                        </div>
                                        <div style={{ height: 4, background: 'var(--border-strong)', borderRadius: 999, overflow: 'hidden' }}>
                                          <div style={{
                                            width: `${Math.round((r.completed_count / r.total_count) * 100)}%`,
                                            height: '100%', background: PURPLE, borderRadius: 999,
                                          }} />
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                          </div>

                          <p style={{ fontSize: 12, color: 'var(--text-dim)', margin: '14px 0 0', textAlign: 'right' }}>
                            {totalEmployees} employee{totalEmployees !== 1 ? 's' : ''} enrolled
                          </p>
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
