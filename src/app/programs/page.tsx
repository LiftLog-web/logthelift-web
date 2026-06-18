'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getSupabase } from '@/lib/supabase';

const TEAL   = '#1EDBA8';
const PURPLE = '#C471ED';
const GOLD   = '#FFD700';
const SILVER = '#94A3B8';
const BRONZE = '#CD7F32';

interface FeaturedTemplate {
  id: string;
  name: string;
  description: string | null;
  featured_duration_days: number | null;
  exercises: any;
}

interface EmployerProgram {
  id: string;
  plan_template_id: string;
  name: string;
  started_at: string;
  ends_at: string;
}

interface Team {
  id: string;
  name: string;
}

interface LeaderboardRow {
  teamId: string;
  teamName: string;
  totalWorkouts: number;
  memberCount: number;
}

function daysRemaining(endsAt: string): number {
  const end = new Date(endsAt);
  end.setHours(23, 59, 59, 999);
  return Math.max(0, Math.ceil((end.getTime() - Date.now()) / 86400000));
}

function formatDate(d: string) {
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function ProgramsPage() {
  const router = useRouter();
  const [authed,            setAuthed]            = useState(false);
  const [userId,            setUserId]            = useState('');
  const [companyName,       setCompanyName]       = useState('');
  const [featuredTemplates, setFeaturedTemplates] = useState<FeaturedTemplate[]>([]);
  const [activeProgram,     setActiveProgram]     = useState<EmployerProgram | null>(null);
  const [teams,             setTeams]             = useState<Team[]>([]);
  const [leaderboard,       setLeaderboard]       = useState<LeaderboardRow[]>([]);
  const [loading,           setLoading]           = useState(true);
  const [launchModal,       setLaunchModal]       = useState<FeaturedTemplate | null>(null);
  const [launchStart,       setLaunchStart]       = useState('');
  const [launchEnd,         setLaunchEnd]         = useState('');
  const [launching,         setLaunching]         = useState(false);
  const [launchError,       setLaunchError]       = useState('');
  const [launchDone,        setLaunchDone]        = useState(false);
  const [employeeCount,     setEmployeeCount]     = useState(0);

  useEffect(() => {
    const sb = getSupabase();
    sb.auth.getSession().then(async ({ data }) => {
      if (!data.session) { router.push('/login'); return; }

      const { data: prof } = await sb
        .from('profiles')
        .select('role, is_employer, company_name')
        .eq('id', data.session.user.id)
        .single();

      if (!prof || !(prof as any).is_employer) { router.push('/plans'); return; }

      const uid = data.session.user.id;
      setUserId(uid);
      setCompanyName((prof as any).company_name ?? '');
      setAuthed(true);

      const today = new Date().toISOString().slice(0, 10);

      const [templatesRes, programRes, teamsRes, linkCountRes] = await Promise.all([
        sb.from('plan_templates').select('id, name, description, featured_duration_days, exercises').eq('practitioner_id', process.env.NEXT_PUBLIC_FEATURED_PRACTITIONER_ID || '969ea6c6-ba6d-4ee4-8bb8-a7cee267f40c').eq('is_featured', true).order('name'),
        sb.from('employer_programs').select('id, plan_template_id, name, started_at, ends_at').eq('employer_id', uid).gte('ends_at', today).order('started_at', { ascending: false }).limit(1),
        sb.from('employer_teams').select('id, name').eq('employer_id', uid).order('name'),
        sb.from('patient_links').select('patient_id', { count: 'exact', head: true }).eq('practitioner_id', uid),
      ]);

      setFeaturedTemplates((templatesRes.data as FeaturedTemplate[]) ?? []);
      setTeams((teamsRes.data as Team[]) ?? []);
      setEmployeeCount(linkCountRes.count ?? 0);

      const prog = (programRes.data ?? [])[0] as EmployerProgram | undefined;
      setActiveProgram(prog ?? null);

      if (prog && teamsRes.data && teamsRes.data.length > 0) {
        await loadLeaderboard(sb, uid, prog, teamsRes.data as Team[]);
      }

      setLoading(false);
    });
  }, []);

  async function loadLeaderboard(sb: ReturnType<typeof getSupabase>, uid: string, prog: EmployerProgram, teamList: Team[]) {
    const [linksRes, workoutsRes] = await Promise.all([
      sb.from('patient_links').select('patient_id, team_id').eq('practitioner_id', uid).not('team_id', 'is', null),
      sb.from('synced_workouts').select('user_id, date').in('user_id',
        (await sb.from('patient_links').select('patient_id').eq('practitioner_id', uid)).data?.map((l: any) => l.patient_id) ?? []
      ).gte('date', prog.started_at).lte('date', prog.ends_at),
    ]);

    const links  = (linksRes.data ?? []) as { patient_id: string; team_id: string }[];
    const wkouts = (workoutsRes.data ?? []) as { user_id: string; date: string }[];

    const teamTotals: Record<string, number>      = {};
    const teamMemberSets: Record<string, Set<string>> = {};

    for (const link of links) {
      if (!teamMemberSets[link.team_id]) teamMemberSets[link.team_id] = new Set();
      teamMemberSets[link.team_id].add(link.patient_id);
    }

    for (const w of wkouts) {
      const link = links.find(l => l.patient_id === w.user_id);
      if (!link) continue;
      teamTotals[link.team_id] = (teamTotals[link.team_id] ?? 0) + 1;
    }

    const rows: LeaderboardRow[] = teamList.map(t => ({
      teamId:        t.id,
      teamName:      t.name,
      totalWorkouts: teamTotals[t.id] ?? 0,
      memberCount:   teamMemberSets[t.id]?.size ?? 0,
    })).sort((a, b) => b.totalWorkouts - a.totalWorkouts);

    setLeaderboard(rows);
  }

  function openLaunchModal(tpl: FeaturedTemplate) {
    const today = new Date().toISOString().slice(0, 10);
    let end = '';
    if (tpl.featured_duration_days) {
      const d = new Date();
      d.setDate(d.getDate() + tpl.featured_duration_days - 1);
      end = d.toISOString().slice(0, 10);
    }
    setLaunchStart(today);
    setLaunchEnd(end);
    setLaunchError('');
    setLaunchDone(false);
    setLaunchModal(tpl);
  }

  function handleStartChange(val: string) {
    setLaunchStart(val);
    if (launchModal?.featured_duration_days) {
      const d = new Date(val + 'T00:00:00');
      d.setDate(d.getDate() + launchModal.featured_duration_days - 1);
      setLaunchEnd(d.toISOString().slice(0, 10));
    }
  }

  async function handleLaunch() {
    if (!launchModal) return;
    if (!launchStart || !launchEnd) { setLaunchError('Please set a start and end date.'); return; }
    if (launchStart >= launchEnd)   { setLaunchError('End date must be after start date.'); return; }

    setLaunching(true);
    setLaunchError('');

    const sb  = getSupabase();
    const now = new Date().toISOString();

    const { data: links, error: linksErr } = await sb
      .from('patient_links')
      .select('patient_id')
      .eq('practitioner_id', userId);

    if (linksErr) { setLaunchError('Could not load employees: ' + linksErr.message); setLaunching(false); return; }

    const employees = (links ?? []).map((l: any) => l.patient_id as string);

    if (employees.length > 0) {
      const { error: plansErr } = await sb.from('workout_plans').insert(
        employees.map(patientId => ({
          practitioner_id: userId,
          patient_id:      patientId,
          name:            launchModal.name,
          description:     launchModal.description ?? null,
          exercises:       launchModal.exercises,
          created_at:      now,
          updated_at:      now,
        }))
      );
      if (plansErr) { setLaunchError('Could not assign plans: ' + plansErr.message); setLaunching(false); return; }
    }

    const { data: progData, error: progErr } = await sb.from('employer_programs').insert({
      employer_id:      userId,
      plan_template_id: launchModal.id,
      name:             launchModal.name,
      started_at:       launchStart,
      ends_at:          launchEnd,
    }).select('id, plan_template_id, name, started_at, ends_at').single();

    if (progErr) { setLaunchError('Could not save program: ' + progErr.message); setLaunching(false); return; }

    setActiveProgram(progData as EmployerProgram);
    setLaunchDone(true);
    setLaunching(false);
    setTimeout(() => setLaunchModal(null), 1200);
  }

  const inputStyle: React.CSSProperties = {
    background:   'var(--input-bg)',
    border:       '1px solid var(--border-strong)',
    borderRadius: 10,
    padding:      '10px 14px',
    color:        'var(--text)',
    fontSize:     14,
    outline:      'none',
    width:        '100%',
    boxSizing:    'border-box',
  };

  if (loading || !authed) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--bg)' }} />
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', color: 'var(--text)', fontFamily: 'sans-serif' }}>
      <main style={{ maxWidth: 1000, margin: '0 auto', padding: '40px 32px' }}>

        {/* Header */}
        <div style={{ marginBottom: 32 }}>
          <h1 style={{ fontSize: 28, fontWeight: 800, margin: '0 0 6px' }}>
            {companyName ? `${companyName} Programs` : 'Programs'}
          </h1>
          <p style={{ color: 'var(--text-muted)', margin: 0, fontSize: 15 }}>
            Launch company-wide fitness programs for your employees.
          </p>
        </div>

        {/* Active Program Banner */}
        {activeProgram && (
          <div style={{ background: 'var(--card)', border: `2px solid ${TEAL}`, borderRadius: 20, padding: '24px 28px', marginBottom: 40 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
              <div>
                <p style={{ fontSize: 11, fontWeight: 700, color: TEAL, textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 6px' }}>
                  Active Program
                </p>
                <h2 style={{ fontSize: 22, fontWeight: 800, margin: '0 0 4px' }}>{activeProgram.name}</h2>
                <p style={{ color: 'var(--text-muted)', margin: 0, fontSize: 14 }}>
                  {formatDate(activeProgram.started_at)} — {formatDate(activeProgram.ends_at)}
                </p>
              </div>
              <div style={{ background: `${TEAL}18`, border: `1px solid ${TEAL}40`, borderRadius: 14, padding: '12px 20px', textAlign: 'center', flexShrink: 0 }}>
                <p style={{ fontSize: 28, fontWeight: 800, color: TEAL, margin: 0, lineHeight: 1 }}>
                  {daysRemaining(activeProgram.ends_at)}
                </p>
                <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '4px 0 0', fontWeight: 600 }}>days left</p>
              </div>
            </div>
          </div>
        )}

        {/* Featured Programs */}
        <div style={{ marginBottom: 40 }}>
          <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 16 }}>
            Featured Programs
          </p>

          {featuredTemplates.length === 0 ? (
            <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16, padding: '40px 24px', textAlign: 'center' }}>
              <p style={{ color: 'var(--text-muted)', margin: 0 }}>No featured programs available yet. Check back soon!</p>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
              {featuredTemplates.map(tpl => {
                const exCount = Array.isArray(tpl.exercises)
                  ? tpl.exercises.length
                  : (tpl.exercises?.days ? (tpl.exercises.days as any[]).reduce((s: number, d: any) => s + (d.exercises?.length ?? 0), 0) : 0);
                const isActive = activeProgram?.plan_template_id === tpl.id;

                return (
                  <div
                    key={tpl.id}
                    style={{
                      background:   'var(--card)',
                      border:       `1px solid ${isActive ? TEAL + '60' : 'var(--border)'}`,
                      borderRadius: 18,
                      padding:      24,
                      display:      'flex',
                      flexDirection:'column',
                      gap:          14,
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
                      <h3 style={{ fontWeight: 800, fontSize: 17, margin: 0, lineHeight: 1.3 }}>{tpl.name}</h3>
                      <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                        {exCount > 0 && (
                          <span style={{ background: 'var(--badge-teal-bg)', color: 'var(--badge-teal-text)', fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 999, whiteSpace: 'nowrap' }}>
                            {exCount} ex
                          </span>
                        )}
                        {tpl.featured_duration_days && (
                          <span style={{ background: `${PURPLE}20`, color: PURPLE, fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 999, whiteSpace: 'nowrap' }}>
                            {tpl.featured_duration_days}d
                          </span>
                        )}
                      </div>
                    </div>

                    {tpl.description && (
                      <p style={{ color: 'var(--text-muted)', fontSize: 14, margin: 0, lineHeight: 1.5 }}>{tpl.description}</p>
                    )}

                    {isActive ? (
                      <div style={{ background: `${TEAL}15`, borderRadius: 10, padding: '10px 14px', textAlign: 'center', fontSize: 13, fontWeight: 700, color: TEAL }}>
                        Currently Running ✓
                      </div>
                    ) : (
                      <button
                        onClick={() => openLaunchModal(tpl)}
                        style={{ background: TEAL, color: '#0f1117', borderRadius: 10, padding: '11px 0', fontWeight: 700, fontSize: 14, border: 'none', cursor: 'pointer', marginTop: 'auto' }}
                      >
                        Launch This Program
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Team Leaderboard */}
        {activeProgram && teams.length > 0 && (
          <div>
            <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>
              Team Leaderboard
            </p>
            <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 20 }}>
              {activeProgram.name} · {formatDate(activeProgram.started_at)} — {formatDate(activeProgram.ends_at)}
            </p>

            {leaderboard.every(r => r.totalWorkouts === 0) ? (
              <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16, padding: '32px 24px', textAlign: 'center' }}>
                <p style={{ color: 'var(--text-muted)', margin: 0, fontSize: 14 }}>
                  No workouts logged yet. Leaderboard fills in as employees log sessions.
                </p>
              </div>
            ) : (
              <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 20, overflow: 'hidden' }}>
                {/* Podium top 3 */}
                {leaderboard.length >= 3 && (
                  <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'center', gap: 16, padding: '32px 24px 0', background: 'var(--card-alt)' }}>
                    {[leaderboard[1], leaderboard[0], leaderboard[2]].map((row, i) => {
                      const rank    = i === 1 ? 1 : i === 0 ? 2 : 3;
                      const color   = rank === 1 ? GOLD : rank === 2 ? SILVER : BRONZE;
                      const medal   = rank === 1 ? '🥇' : rank === 2 ? '🥈' : '🥉';
                      const barH    = rank === 1 ? 80 : rank === 2 ? 56 : 44;
                      return (
                        <div key={row.teamId} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                          {rank === 1 && <div style={{ fontSize: 22 }}>👑</div>}
                          <div style={{ fontWeight: 800, fontSize: rank === 1 ? 15 : 13, textAlign: 'center', maxWidth: 110 }}>{row.teamName}</div>
                          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{row.totalWorkouts} workout{row.totalWorkouts !== 1 ? 's' : ''}</div>
                          <div style={{ width: rank === 1 ? 110 : 88, height: barH, background: `linear-gradient(180deg,${color}33 0%,${color}11 100%)`, border: `1px solid ${color}44`, borderBottom: 'none', borderRadius: '8px 8px 0 0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22 }}>
                            {medal}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Full ranked table */}
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: 'var(--card-alt)', borderTop: '1px solid var(--border)' }}>
                      {['Rank', 'Team', 'Workouts', 'Members'].map(h => (
                        <th key={h} style={{ padding: '10px 20px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {leaderboard.map((row, idx) => (
                      <tr key={row.teamId} style={{ borderTop: '1px solid var(--border-subtle)' }}>
                        <td style={{ padding: '14px 20px', fontSize: 14, fontWeight: 700, color: idx === 0 ? GOLD : idx === 1 ? SILVER : idx === 2 ? BRONZE : 'var(--text-dim)' }}>#{idx + 1}</td>
                        <td style={{ padding: '14px 20px', fontSize: 15, fontWeight: 700 }}>{row.teamName}</td>
                        <td style={{ padding: '14px 20px', fontSize: 14, color: TEAL, fontWeight: 700 }}>{row.totalWorkouts}</td>
                        <td style={{ padding: '14px 20px', fontSize: 14, color: 'var(--text-muted)' }}>{row.memberCount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Teams CTA when no teams exist but program is active */}
        {activeProgram && teams.length === 0 && (
          <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16, padding: '28px 24px', textAlign: 'center' }}>
            <p style={{ color: 'var(--text-muted)', margin: '0 0 14px', fontSize: 14 }}>
              Create teams to unlock the leaderboard and track competition between groups.
            </p>
            <button
              onClick={() => router.push('/teams')}
              style={{ background: PURPLE, color: 'var(--text)', borderRadius: 10, padding: '10px 24px', fontWeight: 700, fontSize: 14, border: 'none', cursor: 'pointer' }}
            >
              Set Up Teams →
            </button>
          </div>
        )}
      </main>

      {/* Launch Modal */}
      {launchModal && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, zIndex: 200 }}
          onClick={e => { if (e.target === e.currentTarget) setLaunchModal(null); }}
        >
          <div style={{ width: '100%', maxWidth: 480, background: 'var(--modal-bg)', border: '1px solid var(--border)', borderRadius: 24, padding: 36 }}>
            <h2 style={{ fontSize: 20, fontWeight: 800, margin: '0 0 6px' }}>Launch Program</h2>
            <p style={{ color: 'var(--text-muted)', fontSize: 14, margin: '0 0 24px' }}>{launchModal.name}</p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 6 }}>Start Date</label>
                <input type="date" value={launchStart} onChange={e => handleStartChange(e.target.value)} style={inputStyle} />
                {(() => {
                  const first = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1);
                  const ymd   = first.toISOString().slice(0, 10);
                  const label = first.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
                  return (
                    <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '6px 0 0', lineHeight: 1.5 }}>
                      Recommended: start on <strong style={{ color: 'var(--text)' }}>{label}</strong> for a clean monthly cycle.{' '}
                      <button
                        type="button"
                        onClick={() => handleStartChange(ymd)}
                        style={{ background: 'none', border: 'none', color: TEAL, fontSize: 12, fontWeight: 700, cursor: 'pointer', padding: 0 }}
                      >
                        Use this date →
                      </button>
                    </p>
                  );
                })()}
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 6 }}>End Date</label>
                <input type="date" value={launchEnd} onChange={e => setLaunchEnd(e.target.value)} style={inputStyle} />
              </div>

              {employeeCount === 0 && (
                <div style={{ background: '#F59E0B18', border: '1px solid #F59E0B40', borderRadius: 10, padding: '12px 16px', fontSize: 13, color: '#F59E0B' }}>
                  No linked employees found. Invite employees via your Profile page before launching.
                </div>
              )}

              {employeeCount > 0 && (
                <div style={{ background: `${TEAL}12`, border: `1px solid ${TEAL}30`, borderRadius: 10, padding: '12px 16px', fontSize: 13, color: 'var(--text-muted)' }}>
                  This plan will be assigned to all <strong style={{ color: 'var(--text)' }}>{employeeCount} linked employee{employeeCount !== 1 ? 's' : ''}</strong>.
                </div>
              )}

              {launchError && (
                <p style={{ color: '#EF4444', fontSize: 13, margin: 0 }}>{launchError}</p>
              )}

              <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
                <button
                  onClick={() => setLaunchModal(null)}
                  disabled={launching}
                  style={{ flex: 1, background: 'var(--card-alt)', color: 'var(--text-muted)', border: '1px solid var(--border-strong)', borderRadius: 10, padding: '12px 0', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}
                >
                  Cancel
                </button>
                <button
                  onClick={handleLaunch}
                  disabled={launching || launchDone || employeeCount === 0}
                  style={{ flex: 2, background: launchDone ? TEAL : PURPLE, color: launchDone ? '#0f1117' : 'var(--text)', border: 'none', borderRadius: 10, padding: '12px 0', fontSize: 14, fontWeight: 700, cursor: (launching || launchDone || employeeCount === 0) ? 'not-allowed' : 'pointer', opacity: (launching || employeeCount === 0) ? 0.6 : 1, transition: 'background 0.2s' }}
                >
                  {launchDone ? '✓ Launched!' : launching ? 'Launching…' : 'Launch Program'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
