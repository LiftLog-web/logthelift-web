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

interface Team { id: string; name: string; }

interface LeaderboardRow {
  teamId: string; teamName: string; totalWorkouts: number; memberCount: number;
}

function daysRemaining(endsAt: string) {
  const end = new Date(endsAt); end.setHours(23, 59, 59, 999);
  return Math.max(0, Math.ceil((end.getTime() - Date.now()) / 86400000));
}
function fmt(d: string) {
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
function exCount(tpl: FeaturedTemplate) {
  if (Array.isArray(tpl.exercises)) return tpl.exercises.length;
  if (tpl.exercises?.days) return (tpl.exercises.days as any[]).reduce((s: number, d: any) => s + (d.exercises?.length ?? 0), 0);
  return 0;
}
function setLabel(s: any): string {
  if (s.isSplit)        return `${s.leftReps ?? s.leftDuration ?? '?'} per side`;
  if (s.duration)       return `${s.duration}s hold`;
  if (s.cardioduration) return `${s.cardioduration}s cardio`;
  const w = s.weight && s.weight > 0 ? ` @ ${s.weight}${s.unit ?? 'kg'}` : '';
  return `${s.reps ?? '?'} reps${w}`;
}

export default function ProgramsPage() {
  const router = useRouter();
  const [authed,            setAuthed]            = useState(false);
  const [userId,            setUserId]            = useState('');
  const [companyName,       setCompanyName]       = useState('');
  const [featuredTemplates, setFeaturedTemplates] = useState<FeaturedTemplate[]>([]);
  const [activePrograms,    setActivePrograms]    = useState<EmployerProgram[]>([]);
  const [teams,             setTeams]             = useState<Team[]>([]);
  const [leaderboard,       setLeaderboard]       = useState<LeaderboardRow[]>([]);
  const [lbProgramId,       setLbProgramId]       = useState<string | null>(null);
  const [loading,           setLoading]           = useState(true);
  const [launchModal,       setLaunchModal]       = useState<FeaturedTemplate | null>(null);
  const [launchStart,       setLaunchStart]       = useState('');
  const [launchEnd,         setLaunchEnd]         = useState('');
  const [launching,         setLaunching]         = useState(false);
  const [launchError,       setLaunchError]       = useState('');
  const [launchDone,        setLaunchDone]        = useState(false);
  const [employeeCount,     setEmployeeCount]     = useState(0);
  const [previewTpl,        setPreviewTpl]        = useState<FeaturedTemplate | null>(null);
  const [removingProgId,    setRemovingProgId]    = useState<string | null>(null);
  const [selectedTplIds,    setSelectedTplIds]    = useState<string[]>([]);
  const [multiLaunch,       setMultiLaunch]       = useState(false);

  useEffect(() => {
    const sb = getSupabase();
    sb.auth.getSession().then(async ({ data }) => {
      if (!data.session) { router.push('/login'); return; }
      const { data: prof } = await sb.from('profiles').select('role, is_employer, company_name').eq('id', data.session.user.id).single();
      if (!prof || !(prof as any).is_employer) { router.push('/plans'); return; }
      const uid = data.session.user.id;
      setUserId(uid);
      setCompanyName((prof as any).company_name ?? '');
      setAuthed(true);
      const today = new Date().toISOString().slice(0, 10);
      const [templatesRes, programsRes, teamsRes, linkCountRes] = await Promise.all([
        sb.from('plan_templates').select('id, name, description, featured_duration_days, exercises').eq('practitioner_id', process.env.NEXT_PUBLIC_FEATURED_PRACTITIONER_ID || '969ea6c6-ba6d-4ee4-8bb8-a7cee267f40c').eq('is_featured', true).order('name'),
        sb.from('employer_programs').select('id, plan_template_id, name, started_at, ends_at').eq('employer_id', uid).gte('ends_at', today).order('started_at', { ascending: false }),
        sb.from('employer_teams').select('id, name').eq('employer_id', uid).order('name'),
        sb.from('patient_links').select('patient_id', { count: 'exact', head: true }).eq('practitioner_id', uid),
      ]);
      setFeaturedTemplates((templatesRes.data as FeaturedTemplate[]) ?? []);
      const progs = (programsRes.data ?? []) as EmployerProgram[];
      setActivePrograms(progs);
      setTeams((teamsRes.data as Team[]) ?? []);
      setEmployeeCount(linkCountRes.count ?? 0);
      if (progs.length > 0 && teamsRes.data && teamsRes.data.length > 0) {
        const first = progs[0];
        setLbProgramId(first.id);
        await loadLeaderboard(sb, uid, first, teamsRes.data as Team[]);
      }
      setLoading(false);
    });
  }, []);

  // Escape key for all modals
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { setLaunchModal(null); setPreviewTpl(null); setMultiLaunch(false); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  async function loadLeaderboard(sb: ReturnType<typeof getSupabase>, uid: string, prog: EmployerProgram, teamList: Team[]) {
    const allLinks = (await sb.from('patient_links').select('patient_id').eq('practitioner_id', uid)).data ?? [];
    const [linksRes, workoutsRes] = await Promise.all([
      sb.from('patient_links').select('patient_id, team_id').eq('practitioner_id', uid).not('team_id', 'is', null),
      sb.from('synced_workouts').select('user_id, date').in('user_id', allLinks.map((l: any) => l.patient_id)).gte('date', prog.started_at).lte('date', prog.ends_at),
    ]);
    const links  = (linksRes.data ?? []) as { patient_id: string; team_id: string }[];
    const wkouts = (workoutsRes.data ?? []) as { user_id: string }[];
    const teamTotals: Record<string, number> = {};
    const teamMembers: Record<string, Set<string>> = {};
    for (const l of links) {
      if (!teamMembers[l.team_id]) teamMembers[l.team_id] = new Set();
      teamMembers[l.team_id].add(l.patient_id);
    }
    for (const w of wkouts) {
      const link = links.find(l => l.patient_id === w.user_id);
      if (!link) continue;
      teamTotals[link.team_id] = (teamTotals[link.team_id] ?? 0) + 1;
    }
    setLeaderboard(teamList.map(t => ({
      teamId: t.id, teamName: t.name,
      totalWorkouts: teamTotals[t.id] ?? 0,
      memberCount: teamMembers[t.id]?.size ?? 0,
    })).sort((a, b) => b.totalWorkouts - a.totalWorkouts));
  }

  async function handleRemoveProgram(prog: EmployerProgram) {
    if (!confirm(`End "${prog.name}" early? This will remove it from your active programs.`)) return;
    setRemovingProgId(prog.id);
    const sb = getSupabase();
    const { error } = await sb.from('employer_programs').delete().eq('id', prog.id);
    if (error) { alert('Could not remove program: ' + error.message); setRemovingProgId(null); return; }
    setActivePrograms(prev => {
      const next = prev.filter(p => p.id !== prog.id);
      if (lbProgramId === prog.id && next.length > 0) {
        setLbProgramId(next[0].id);
        if (teams.length > 0) loadLeaderboard(sb, userId, next[0], teams);
      } else if (next.length === 0) {
        setLbProgramId(null);
        setLeaderboard([]);
      }
      return next;
    });
    setRemovingProgId(null);
  }

  async function switchLbProgram(progId: string) {
    setLbProgramId(progId);
    const prog = activePrograms.find(p => p.id === progId);
    if (prog && teams.length > 0) {
      const sb = getSupabase();
      await loadLeaderboard(sb, userId, prog, teams);
    }
  }

  function toggleSelect(id: string) {
    setSelectedTplIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  }

  function openMultiLaunch() {
    const today = new Date().toISOString().slice(0, 10);
    const d = new Date(); d.setDate(d.getDate() + 29);
    setLaunchStart(today); setLaunchEnd(d.toISOString().slice(0, 10));
    setLaunchError(''); setLaunchDone(false);
    setMultiLaunch(true);
  }

  async function handleMultiLaunch() {
    if (!launchStart || !launchEnd) { setLaunchError('Please set a start and end date.'); return; }
    if (launchStart >= launchEnd)   { setLaunchError('End date must be after start date.'); return; }
    setLaunching(true); setLaunchError('');
    const sb  = getSupabase();
    const now = new Date().toISOString();
    const { data: links, error: linksErr } = await sb.from('patient_links').select('patient_id').eq('practitioner_id', userId);
    if (linksErr) { setLaunchError('Could not load employees: ' + linksErr.message); setLaunching(false); return; }
    const employees = (links ?? []).map((l: any) => l.patient_id as string);
    const tolaunch  = featuredTemplates.filter(t => selectedTplIds.includes(t.id) && !activePrograms.some(p => p.plan_template_id === t.id));
    const newProgs: EmployerProgram[] = [];
    for (const tpl of tolaunch) {
      if (employees.length > 0) {
        const { error: plansErr } = await sb.from('workout_plans').insert(
          employees.map(patientId => ({ practitioner_id: userId, patient_id: patientId, name: tpl.name, description: tpl.description ?? null, exercises: tpl.exercises, created_at: now, updated_at: now }))
        );
        if (plansErr) { setLaunchError(`Could not assign "${tpl.name}": ` + plansErr.message); setLaunching(false); return; }
      }
      const { data: progData, error: progErr } = await sb.from('employer_programs').insert({ employer_id: userId, plan_template_id: tpl.id, name: tpl.name, started_at: launchStart, ends_at: launchEnd }).select('id, plan_template_id, name, started_at, ends_at').single();
      if (progErr) { setLaunchError(`Could not save "${tpl.name}": ` + progErr.message); setLaunching(false); return; }
      newProgs.push(progData as EmployerProgram);
    }
    if (newProgs.length > 0) {
      setActivePrograms(prev => [...newProgs, ...prev]);
      if (teams.length > 0) { setLbProgramId(newProgs[0].id); await loadLeaderboard(sb, userId, newProgs[0], teams); }
    }
    setLaunchDone(true); setLaunching(false);
    setTimeout(() => { setMultiLaunch(false); setSelectedTplIds([]); }, 1400);
  }

  function openLaunchModal(tpl: FeaturedTemplate) {
    const today = new Date().toISOString().slice(0, 10);
    let end = '';
    if (tpl.featured_duration_days) {
      const d = new Date(); d.setDate(d.getDate() + tpl.featured_duration_days - 1);
      end = d.toISOString().slice(0, 10);
    }
    setLaunchStart(today); setLaunchEnd(end);
    setLaunchError(''); setLaunchDone(false);
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
    setLaunching(true); setLaunchError('');
    const sb  = getSupabase();
    const now = new Date().toISOString();
    const { data: links, error: linksErr } = await sb.from('patient_links').select('patient_id').eq('practitioner_id', userId);
    if (linksErr) { setLaunchError('Could not load employees: ' + linksErr.message); setLaunching(false); return; }
    const employees = (links ?? []).map((l: any) => l.patient_id as string);
    if (employees.length > 0) {
      const { error: plansErr } = await sb.from('workout_plans').insert(
        employees.map(patientId => ({ practitioner_id: userId, patient_id: patientId, name: launchModal.name, description: launchModal.description ?? null, exercises: launchModal.exercises, created_at: now, updated_at: now }))
      );
      if (plansErr) { setLaunchError('Could not assign plans: ' + plansErr.message); setLaunching(false); return; }
    }
    const { data: progData, error: progErr } = await sb.from('employer_programs').insert({ employer_id: userId, plan_template_id: launchModal.id, name: launchModal.name, started_at: launchStart, ends_at: launchEnd }).select('id, plan_template_id, name, started_at, ends_at').single();
    if (progErr) { setLaunchError('Could not save program: ' + progErr.message); setLaunching(false); return; }
    const newProg = progData as EmployerProgram;
    setActivePrograms(prev => [newProg, ...prev]);
    if (teams.length > 0) { setLbProgramId(newProg.id); await loadLeaderboard(sb, userId, newProg, teams); }
    setLaunchDone(true); setLaunching(false);
    setTimeout(() => setLaunchModal(null), 1200);
  }

  const inputStyle: React.CSSProperties = {
    background: 'var(--input-bg)', border: '1px solid var(--border-strong)',
    borderRadius: 10, padding: '10px 14px', color: 'var(--text)',
    fontSize: 14, outline: 'none', width: '100%', boxSizing: 'border-box',
  };

  if (loading || !authed) return <div style={{ minHeight: '100vh', background: 'var(--bg)' }} />;

  const lbProgram = activePrograms.find(p => p.id === lbProgramId) ?? activePrograms[0] ?? null;

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', color: 'var(--text)', fontFamily: 'sans-serif' }}>
      <main style={{ maxWidth: 1000, margin: '0 auto', padding: '40px 32px' }}>

        {/* Header */}
        <div style={{ marginBottom: 32 }}>
          <h1 style={{ fontSize: 28, fontWeight: 800, margin: '0 0 6px' }}>{companyName ? `${companyName} Programs` : 'Programs'}</h1>
          <p style={{ color: 'var(--text-muted)', margin: 0, fontSize: 15 }}>Launch company-wide fitness programs for your employees.</p>
        </div>

        {/* Active Programs Banner */}
        {activePrograms.length > 0 && (
          <div style={{ marginBottom: 40 }}>
            <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>
              Active Program{activePrograms.length > 1 ? 's' : ''}
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {activePrograms.map(prog => (
                <div key={prog.id} style={{ background: 'var(--card)', border: `2px solid ${TEAL}`, borderRadius: 18, padding: '20px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
                  <div>
                    <h2 style={{ fontSize: 18, fontWeight: 800, margin: '0 0 3px' }}>{prog.name}</h2>
                    <p style={{ color: 'var(--text-muted)', margin: 0, fontSize: 13 }}>{fmt(prog.started_at)} — {fmt(prog.ends_at)}</p>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
                    <div style={{ background: `${TEAL}18`, border: `1px solid ${TEAL}40`, borderRadius: 12, padding: '10px 18px', textAlign: 'center' }}>
                      <p style={{ fontSize: 24, fontWeight: 800, color: TEAL, margin: 0, lineHeight: 1 }}>{daysRemaining(prog.ends_at)}</p>
                      <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '3px 0 0', fontWeight: 600 }}>days left</p>
                    </div>
                    <button
                      onClick={() => handleRemoveProgram(prog)}
                      disabled={removingProgId === prog.id}
                      style={{ background: 'none', border: '1.5px solid #EF444450', color: '#EF4444', borderRadius: 10, padding: '8px 14px', fontSize: 13, fontWeight: 700, cursor: removingProgId === prog.id ? 'not-allowed' : 'pointer', opacity: removingProgId === prog.id ? 0.5 : 1, whiteSpace: 'nowrap' }}
                    >
                      {removingProgId === prog.id ? 'Ending…' : 'End Program'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Featured Programs Grid */}
        <div style={{ marginBottom: 40 }}>
          <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 16 }}>
            Featured Programs
          </p>
          {featuredTemplates.length === 0 ? (
            <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16, padding: '40px 24px', textAlign: 'center' }}>
              <p style={{ color: 'var(--text-muted)', margin: 0 }}>No featured programs available yet.</p>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
              {featuredTemplates.map(tpl => {
                const isActive   = activePrograms.some(p => p.plan_template_id === tpl.id);
                const isSelected = selectedTplIds.includes(tpl.id);
                const count      = exCount(tpl);
                return (
                  <div
                    key={tpl.id}
                    onClick={() => setPreviewTpl(tpl)}
                    style={{
                      position: 'relative',
                      background: 'var(--card)',
                      border: `1.5px solid ${isSelected ? TEAL : isActive ? TEAL + '60' : 'var(--border)'}`,
                      borderRadius: 18, padding: 24, display: 'flex', flexDirection: 'column', gap: 14,
                      cursor: 'pointer', transition: 'border-color 0.15s, box-shadow 0.15s',
                    }}
                    onMouseEnter={e => (e.currentTarget.style.boxShadow = `0 0 0 2px ${TEAL}40`)}
                    onMouseLeave={e => (e.currentTarget.style.boxShadow = 'none')}
                  >
                    {/* Checkbox — top-right corner, only for non-active templates */}
                    {!isActive && (
                      <button
                        onClick={e => { e.stopPropagation(); toggleSelect(tpl.id); }}
                        title={isSelected ? 'Deselect' : 'Select for bulk launch'}
                        style={{
                          position: 'absolute', top: 14, right: 14,
                          width: 22, height: 22, borderRadius: '50%',
                          border: isSelected ? 'none' : '2px solid var(--border-strong)',
                          background: isSelected ? TEAL : 'var(--card-alt)',
                          cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                          flexShrink: 0, zIndex: 1, padding: 0,
                        }}
                      >
                        {isSelected && <span style={{ color: '#0f1117', fontSize: 12, fontWeight: 900, lineHeight: 1 }}>✓</span>}
                      </button>
                    )}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, paddingRight: !isActive ? 28 : 0 }}>
                      <h3 style={{ fontWeight: 800, fontSize: 17, margin: 0, lineHeight: 1.3 }}>{tpl.name}</h3>
                      <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                        {count > 0 && <span style={{ background: 'var(--badge-teal-bg)', color: 'var(--badge-teal-text)', fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 999 }}>{count} ex</span>}
                        {tpl.featured_duration_days && <span style={{ background: `${PURPLE}20`, color: PURPLE, fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 999 }}>{tpl.featured_duration_days}d</span>}
                      </div>
                    </div>
                    {tpl.description && <p style={{ color: 'var(--text-muted)', fontSize: 14, margin: 0, lineHeight: 1.5 }}>{tpl.description}</p>}
                    {isActive ? (
                      <div style={{ background: `${TEAL}15`, borderRadius: 10, padding: '10px 14px', textAlign: 'center', fontSize: 13, fontWeight: 700, color: TEAL }}>
                        Currently Running ✓
                      </div>
                    ) : isSelected ? (
                      <div
                        onClick={e => { e.stopPropagation(); toggleSelect(tpl.id); }}
                        style={{ background: `${TEAL}18`, border: `1px solid ${TEAL}50`, borderRadius: 10, padding: '10px 14px', textAlign: 'center', fontSize: 13, fontWeight: 700, color: TEAL, cursor: 'pointer' }}
                      >
                        ✓ Selected — click to remove
                      </div>
                    ) : (
                      <button
                        onClick={e => { e.stopPropagation(); openLaunchModal(tpl); }}
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

        {/* Bulk-launch hint when nothing selected yet */}
        {selectedTplIds.length === 0 && featuredTemplates.some(t => !activePrograms.some(p => p.plan_template_id === t.id)) && (
          <p style={{ fontSize: 13, color: 'var(--text-dim)', margin: '-24px 0 32px', textAlign: 'center' }}>
            Tip: check the circle on multiple cards to launch them all at once
          </p>
        )}

        {/* Team Leaderboard */}
        {activePrograms.length > 0 && teams.length > 0 && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 4 }}>
              <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.08em', margin: 0 }}>
                Team Leaderboard
              </p>
              {activePrograms.length > 1 && (
                <select
                  value={lbProgramId ?? ''}
                  onChange={e => switchLbProgram(e.target.value)}
                  style={{ background: 'var(--card)', border: '1px solid var(--border-strong)', borderRadius: 8, padding: '5px 10px', color: 'var(--text)', fontSize: 13, outline: 'none', cursor: 'pointer' }}
                >
                  {activePrograms.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              )}
            </div>
            {lbProgram && (
              <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 20 }}>
                {lbProgram.name} · {fmt(lbProgram.started_at)} — {fmt(lbProgram.ends_at)}
              </p>
            )}
            {leaderboard.every(r => r.totalWorkouts === 0) ? (
              <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16, padding: '32px 24px', textAlign: 'center' }}>
                <p style={{ color: 'var(--text-muted)', margin: 0, fontSize: 14 }}>No workouts logged yet. Leaderboard fills in as employees log sessions.</p>
              </div>
            ) : (
              <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 20, overflow: 'hidden' }}>
                {leaderboard.length >= 3 && (
                  <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'center', gap: 16, padding: '32px 24px 0', background: 'var(--card-alt)' }}>
                    {[leaderboard[1], leaderboard[0], leaderboard[2]].map((row, i) => {
                      const rank = i === 1 ? 1 : i === 0 ? 2 : 3;
                      const color = rank === 1 ? GOLD : rank === 2 ? SILVER : BRONZE;
                      const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : '🥉';
                      const barH  = rank === 1 ? 80 : rank === 2 ? 56 : 44;
                      return (
                        <div key={row.teamId} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                          {rank === 1 && <div style={{ fontSize: 22 }}>👑</div>}
                          <div style={{ fontWeight: 800, fontSize: rank === 1 ? 15 : 13, textAlign: 'center', maxWidth: 110 }}>{row.teamName}</div>
                          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{row.totalWorkouts} workout{row.totalWorkouts !== 1 ? 's' : ''}</div>
                          <div style={{ width: rank === 1 ? 110 : 88, height: barH, background: `linear-gradient(180deg,${color}33 0%,${color}11 100%)`, border: `1px solid ${color}44`, borderBottom: 'none', borderRadius: '8px 8px 0 0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22 }}>{medal}</div>
                        </div>
                      );
                    })}
                  </div>
                )}
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

        {activePrograms.length > 0 && teams.length === 0 && (
          <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16, padding: '28px 24px', textAlign: 'center' }}>
            <p style={{ color: 'var(--text-muted)', margin: '0 0 14px', fontSize: 14 }}>Create teams to unlock the leaderboard.</p>
            <button onClick={() => router.push('/teams')} style={{ background: PURPLE, color: 'var(--text)', borderRadius: 10, padding: '10px 24px', fontWeight: 700, fontSize: 14, border: 'none', cursor: 'pointer' }}>Set Up Teams →</button>
          </div>
        )}
      </main>

      {/* Sticky bulk-launch bar */}
      {selectedTplIds.length > 0 && (
        <div style={{ position: 'fixed', bottom: 32, left: '50%', transform: 'translateX(-50%)', zIndex: 150, pointerEvents: 'none' }}>
          <div style={{ background: 'var(--modal-bg)', border: `2px solid ${TEAL}`, borderRadius: 20, padding: '14px 20px', display: 'flex', alignItems: 'center', gap: 14, boxShadow: '0 8px 40px rgba(0,0,0,0.5)', pointerEvents: 'all', whiteSpace: 'nowrap' }}>
            <span style={{ fontWeight: 700, fontSize: 14 }}>
              {selectedTplIds.length} program{selectedTplIds.length > 1 ? 's' : ''} selected
            </span>
            <button
              onClick={() => setSelectedTplIds([])}
              style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 13, cursor: 'pointer', padding: '2px 6px', borderRadius: 6 }}
            >
              Clear
            </button>
            <button
              onClick={openMultiLaunch}
              style={{ background: TEAL, color: '#0f1117', border: 'none', borderRadius: 12, padding: '10px 22px', fontWeight: 800, fontSize: 14, cursor: 'pointer' }}
            >
              Launch {selectedTplIds.length} Program{selectedTplIds.length > 1 ? 's' : ''} →
            </button>
          </div>
        </div>
      )}

      {/* Multi-launch Modal */}
      {multiLaunch && (
        <div
          onClick={e => { if (e.target === e.currentTarget) setMultiLaunch(false); }}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, zIndex: 300 }}
        >
          <div style={{ width: '100%', maxWidth: 500, background: 'var(--modal-bg)', border: '1px solid var(--border)', borderRadius: 24, padding: 36 }}>
            <h2 style={{ fontSize: 20, fontWeight: 800, margin: '0 0 4px' }}>Launch Programs</h2>
            <p style={{ color: 'var(--text-muted)', fontSize: 14, margin: '0 0 20px' }}>All selected programs will share the same dates.</p>

            {/* Selected program list */}
            <div style={{ background: 'var(--card-alt)', border: '1px solid var(--border)', borderRadius: 12, marginBottom: 20, overflow: 'hidden' }}>
              {featuredTemplates.filter(t => selectedTplIds.includes(t.id)).map((tpl, i, arr) => (
                <div key={tpl.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '11px 16px', borderTop: i > 0 ? '1px solid var(--border-subtle)' : 'none' }}>
                  <span style={{ fontWeight: 700, fontSize: 14 }}>{tpl.name}</span>
                  {activePrograms.some(p => p.plan_template_id === tpl.id) && (
                    <span style={{ fontSize: 11, fontWeight: 700, color: TEAL, background: `${TEAL}15`, borderRadius: 999, padding: '2px 9px' }}>Already running</span>
                  )}
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 6 }}>Start Date</label>
                <input type="date" value={launchStart} onChange={e => setLaunchStart(e.target.value)} style={inputStyle} />
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 6 }}>End Date</label>
                <input type="date" value={launchEnd} onChange={e => setLaunchEnd(e.target.value)} style={inputStyle} />
              </div>
              {employeeCount > 0 && (
                <div style={{ background: `${TEAL}12`, border: `1px solid ${TEAL}30`, borderRadius: 10, padding: '12px 16px', fontSize: 13, color: 'var(--text-muted)' }}>
                  Each program will be assigned to all <strong style={{ color: 'var(--text)' }}>{employeeCount} linked employee{employeeCount !== 1 ? 's' : ''}</strong>.
                </div>
              )}
              {employeeCount === 0 && (
                <div style={{ background: '#F59E0B18', border: '1px solid #F59E0B40', borderRadius: 10, padding: '12px 16px', fontSize: 13, color: '#F59E0B' }}>
                  No linked employees found. Invite employees via your Profile page before launching.
                </div>
              )}
              {launchError && <p style={{ color: '#EF4444', fontSize: 13, margin: 0 }}>{launchError}</p>}
              <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
                <button onClick={() => setMultiLaunch(false)} disabled={launching} style={{ flex: 1, background: 'var(--card-alt)', color: 'var(--text-muted)', border: '1px solid var(--border-strong)', borderRadius: 10, padding: '12px 0', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>Cancel</button>
                <button
                  onClick={handleMultiLaunch}
                  disabled={launching || launchDone || employeeCount === 0}
                  style={{ flex: 2, background: launchDone ? TEAL : PURPLE, color: launchDone ? '#0f1117' : 'var(--text)', border: 'none', borderRadius: 10, padding: '12px 0', fontSize: 14, fontWeight: 700, cursor: (launching || launchDone || employeeCount === 0) ? 'not-allowed' : 'pointer', opacity: (launching || employeeCount === 0) ? 0.6 : 1, transition: 'background 0.2s' }}
                >
                  {launchDone ? `✓ ${selectedTplIds.length} Program${selectedTplIds.length > 1 ? 's' : ''} Launched!` : launching ? 'Launching…' : `Launch ${selectedTplIds.filter(id => !activePrograms.some(p => p.plan_template_id === id)).length} Program${selectedTplIds.filter(id => !activePrograms.some(p => p.plan_template_id === id)).length !== 1 ? 's' : ''}`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Preview Modal */}
      {previewTpl && (
        <div
          onClick={e => { if (e.target === e.currentTarget) setPreviewTpl(null); }}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 200, padding: '40px 24px', overflowY: 'auto' }}
        >
          <div style={{ width: '100%', maxWidth: 520, background: 'var(--modal-bg)', border: '1px solid var(--border)', borderRadius: 24, overflow: 'hidden', marginBottom: 40 }}>
            {/* Header */}
            <div style={{ padding: '28px 28px 20px', borderBottom: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 8 }}>
                <h2 style={{ fontSize: 21, fontWeight: 800, margin: 0, lineHeight: 1.3 }}>{previewTpl.name}</h2>
                <button onClick={() => setPreviewTpl(null)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 20, cursor: 'pointer', lineHeight: 1, padding: '2px 6px', borderRadius: 6, flexShrink: 0 }}>✕</button>
              </div>
              <div style={{ display: 'flex', gap: 8, marginBottom: previewTpl.description ? 12 : 0 }}>
                {exCount(previewTpl) > 0 && <span style={{ background: 'var(--badge-teal-bg)', color: 'var(--badge-teal-text)', fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 999 }}>{exCount(previewTpl)} exercises</span>}
                {previewTpl.featured_duration_days && <span style={{ background: `${PURPLE}20`, color: PURPLE, fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 999 }}>{previewTpl.featured_duration_days}-day program</span>}
              </div>
              {previewTpl.description && <p style={{ color: 'var(--text-muted)', fontSize: 14, margin: 0, lineHeight: 1.6 }}>{previewTpl.description}</p>}
            </div>

            {/* Exercise list */}
            <div style={{ maxHeight: '50vh', overflowY: 'auto', padding: '6px 0' }}>
              {(() => {
                const flat: any[] = Array.isArray(previewTpl.exercises)
                  ? previewTpl.exercises
                  : (previewTpl.exercises?.days ?? []).flatMap((d: any) => d.exercises ?? []);
                const days: { label: string; exercises: any[] }[] | null =
                  !Array.isArray(previewTpl.exercises) && previewTpl.exercises?.days
                    ? previewTpl.exercises.days
                    : null;
                if (days) {
                  return days.map((day: any, di: number) => (
                    <div key={day.id ?? di}>
                      <div style={{ padding: '10px 28px 6px', background: 'var(--card-alt)', borderTop: di > 0 ? '1px solid var(--border)' : 'none', borderBottom: '1px solid var(--border-subtle)' }}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>{day.label ?? `Day ${di + 1}`}</span>
                      </div>
                      {(day.exercises ?? []).map((ex: any, i: number) => (
                        <div key={ex.id ?? i} style={{ padding: '12px 28px', borderBottom: i < (day.exercises?.length ?? 0) - 1 ? '1px solid var(--border-subtle)' : 'none' }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 3 }}>
                            <span style={{ fontWeight: 700, fontSize: 14 }}>{ex.exercise?.name ?? 'Exercise'}</span>
                            {ex.exercise?.muscleGroup && (
                              <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-dim)', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 999, padding: '2px 9px', whiteSpace: 'nowrap' }}>{ex.exercise.muscleGroup}</span>
                            )}
                          </div>
                          {Array.isArray(ex.sets) && ex.sets.length > 0 && (
                            <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: 0 }}>{ex.sets.length} set{ex.sets.length !== 1 ? 's' : ''} · {setLabel(ex.sets[0])}</p>
                          )}
                          {ex.practitionerNotes && (
                            <p style={{ color: 'var(--text-dim)', fontSize: 12, margin: '3px 0 0', fontStyle: 'italic', lineHeight: 1.4 }}>{ex.practitionerNotes}</p>
                          )}
                        </div>
                      ))}
                    </div>
                  ));
                }
                return flat.map((ex: any, i: number) => (
                  <div key={ex.id ?? i} style={{ padding: '14px 28px', borderBottom: i < flat.length - 1 ? '1px solid var(--border-subtle)' : 'none' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 4 }}>
                      <span style={{ fontWeight: 700, fontSize: 14 }}>{ex.exercise?.name ?? 'Exercise'}</span>
                      {ex.exercise?.muscleGroup && (
                        <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-dim)', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 999, padding: '2px 9px', whiteSpace: 'nowrap' }}>{ex.exercise.muscleGroup}</span>
                      )}
                    </div>
                    {Array.isArray(ex.sets) && ex.sets.length > 0 && (
                      <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: 0 }}>{ex.sets.length} set{ex.sets.length !== 1 ? 's' : ''} · {setLabel(ex.sets[0])}</p>
                    )}
                    {ex.practitionerNotes && (
                      <p style={{ color: 'var(--text-dim)', fontSize: 12, margin: '4px 0 0', fontStyle: 'italic', lineHeight: 1.4 }}>{ex.practitionerNotes}</p>
                    )}
                  </div>
                ));
              })()}
            </div>

            {/* Footer */}
            <div style={{ padding: '20px 28px', borderTop: '1px solid var(--border)', display: 'flex', gap: 10 }}>
              <button onClick={() => setPreviewTpl(null)} style={{ flex: 1, background: 'none', border: '1px solid var(--border-strong)', borderRadius: 10, padding: '11px 0', fontWeight: 700, fontSize: 14, color: 'var(--text-muted)', cursor: 'pointer' }}>
                Close
              </button>
              {!activePrograms.some(p => p.plan_template_id === previewTpl.id) && (
                <button
                  onClick={() => { setPreviewTpl(null); openLaunchModal(previewTpl); }}
                  style={{ flex: 2, background: TEAL, color: '#0f1117', border: 'none', borderRadius: 10, padding: '11px 0', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}
                >
                  Launch This Program
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Launch Modal */}
      {launchModal && (
        <div
          onClick={e => { if (e.target === e.currentTarget) setLaunchModal(null); }}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, zIndex: 300 }}
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
                    <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '6px 0 0' }}>
                      Recommended: <strong style={{ color: 'var(--text)' }}>{label}</strong>{' '}
                      <button type="button" onClick={() => handleStartChange(ymd)} style={{ background: 'none', border: 'none', color: TEAL, fontSize: 12, fontWeight: 700, cursor: 'pointer', padding: 0 }}>Use →</button>
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
              {launchError && <p style={{ color: '#EF4444', fontSize: 13, margin: 0 }}>{launchError}</p>}
              <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
                <button onClick={() => setLaunchModal(null)} disabled={launching} style={{ flex: 1, background: 'var(--card-alt)', color: 'var(--text-muted)', border: '1px solid var(--border-strong)', borderRadius: 10, padding: '12px 0', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>Cancel</button>
                <button onClick={handleLaunch} disabled={launching || launchDone || employeeCount === 0} style={{ flex: 2, background: launchDone ? TEAL : PURPLE, color: launchDone ? '#0f1117' : 'var(--text)', border: 'none', borderRadius: 10, padding: '12px 0', fontSize: 14, fontWeight: 700, cursor: (launching || launchDone || employeeCount === 0) ? 'not-allowed' : 'pointer', opacity: (launching || employeeCount === 0) ? 0.6 : 1, transition: 'background 0.2s' }}>
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
