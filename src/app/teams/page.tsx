'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getSupabase } from '@/lib/supabase';

const TEAL        = '#1EDBA8';
const TEAM_COLORS = ['#5fcfbf', '#C471ED', '#F59E0B', '#60A5FA', '#34D399', '#F87171', '#A78BFA', '#FB923C'];

function avatarInitial(name: string) {
  return name.trim().charAt(0).toUpperCase();
}

interface Team {
  id: string;
  name: string;
}

interface Employee {
  patientId: string;
  displayName: string;
  teamId: string | null;
}

export default function TeamsPage() {
  const router = useRouter();
  const [authed,       setAuthed]       = useState(false);
  const [userId,       setUserId]       = useState('');
  const [teams,        setTeams]        = useState<Team[]>([]);
  const [employees,    setEmployees]    = useState<Employee[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [newTeamName,  setNewTeamName]  = useState('');
  const [creating,     setCreating]     = useState(false);
  const [editingTeam,  setEditingTeam]  = useState<Team | null>(null);
  const [editingName,  setEditingName]  = useState('');
  const [savingEdit,   setSavingEdit]   = useState(false);
  const [deletingId,   setDeletingId]   = useState<string | null>(null);
  const [savingMove,   setSavingMove]   = useState<string | null>(null);
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);

  useEffect(() => {
    function handleMouseDown(e: MouseEvent) {
      if (!(e.target as Element).closest('[data-dropdown]')) setOpenDropdown(null);
    }
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, []);

  useEffect(() => {
    const sb = getSupabase();
    sb.auth.getSession().then(async ({ data }) => {
      if (!data.session) { router.push('/login'); return; }

      const { data: prof } = await sb
        .from('profiles')
        .select('role, is_employer')
        .eq('id', data.session.user.id)
        .single();

      if (!prof || !(prof as any).is_employer) { router.push('/plans'); return; }

      const uid = data.session.user.id;
      setUserId(uid);
      setAuthed(true);

      await loadData(sb, uid);
      setLoading(false);
    });
  }, []);

  async function loadData(sb: ReturnType<typeof getSupabase>, uid: string) {
    const [teamsRes, linksRes] = await Promise.all([
      sb.from('employer_teams').select('id, name').eq('employer_id', uid).order('name'),
      sb.from('patient_links').select('patient_id, team_id, profiles!patient_links_patient_id_fkey(display_name)').eq('practitioner_id', uid),
    ]);

    setTeams((teamsRes.data as Team[]) ?? []);
    setEmployees(
      ((linksRes.data ?? []) as any[]).map(l => ({
        patientId:   l.patient_id,
        displayName: (Array.isArray(l.profiles) ? l.profiles[0] : l.profiles)?.display_name ?? 'Unknown',
        teamId:      l.team_id ?? null,
      }))
    );
  }

  async function handleCreateTeam(e: React.FormEvent) {
    e.preventDefault();
    if (!newTeamName.trim()) return;
    setCreating(true);
    const sb = getSupabase();
    const { data, error } = await sb
      .from('employer_teams')
      .insert({ employer_id: userId, name: newTeamName.trim() })
      .select('id, name')
      .single();
    if (!error && data) {
      setTeams(prev => [...prev, data as Team].sort((a, b) => a.name.localeCompare(b.name)));
      setNewTeamName('');
    }
    setCreating(false);
  }

  async function handleRenameTeam() {
    if (!editingTeam || !editingName.trim()) return;
    setSavingEdit(true);
    const sb = getSupabase();
    const { error } = await sb.from('employer_teams').update({ name: editingName.trim() }).eq('id', editingTeam.id);
    if (!error) {
      setTeams(prev => prev.map(t => t.id === editingTeam.id ? { ...t, name: editingName.trim() } : t).sort((a, b) => a.name.localeCompare(b.name)));
      setEditingTeam(null);
    }
    setSavingEdit(false);
  }

  async function handleDeleteTeam(team: Team) {
    if (!confirm(`Delete team "${team.name}"? Members will become unassigned.`)) return;
    setDeletingId(team.id);
    const sb = getSupabase();
    await sb.from('employer_teams').delete().eq('id', team.id);
    setTeams(prev => prev.filter(t => t.id !== team.id));
    setEmployees(prev => prev.map(e => e.teamId === team.id ? { ...e, teamId: null } : e));
    setDeletingId(null);
  }

  async function handleMoveEmployee(patientId: string, newTeamId: string | null) {
    setSavingMove(patientId);
    const sb = getSupabase();
    const { error } = await sb
      .from('patient_links')
      .update({ team_id: newTeamId })
      .eq('practitioner_id', userId)
      .eq('patient_id', patientId);
    if (error) {
      alert('Could not update team: ' + error.message);
      setSavingMove(null);
      return;
    }
    setEmployees(prev => prev.map(e => e.patientId === patientId ? { ...e, teamId: newTeamId } : e));
    setSavingMove(null);
  }

  const inputStyle: React.CSSProperties = {
    background:   'var(--input-bg)',
    border:       '1px solid var(--border-strong)',
    borderRadius: 10,
    padding:      '10px 14px',
    color:        'var(--text)',
    fontSize:     14,
    outline:      'none',
    flex:         1,
  };

  if (loading || !authed) {
    return <div style={{ minHeight: '100vh', background: 'var(--bg)' }} />;
  }

  const unassigned = employees.filter(e => !e.teamId);

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', color: 'var(--text)', fontFamily: 'sans-serif' }}>
      <main style={{ maxWidth: 1100, margin: '0 auto', padding: '40px 32px' }}>

        {/* Header */}
        <div style={{ marginBottom: 32 }}>
          <h1 style={{ fontSize: 28, fontWeight: 800, margin: '0 0 6px' }}>Teams</h1>
          <p style={{ color: 'var(--text-muted)', margin: 0, fontSize: 15 }}>
            Organize employees into teams to compete on the Programs leaderboard.
          </p>
        </div>

        {/* Create Team */}
        <form onSubmit={handleCreateTeam} style={{ display: 'flex', gap: 10, marginBottom: 36, maxWidth: 480 }}>
          <input
            value={newTeamName}
            onChange={e => setNewTeamName(e.target.value)}
            placeholder="New team name…"
            style={inputStyle}
          />
          <button
            type="submit"
            disabled={creating || !newTeamName.trim()}
            style={{ background: TEAL, color: '#0f1117', borderRadius: 10, padding: '10px 20px', fontWeight: 700, fontSize: 14, border: 'none', cursor: creating ? 'not-allowed' : 'pointer', opacity: creating ? 0.7 : 1, whiteSpace: 'nowrap' }}
          >
            {creating ? 'Creating…' : '+ Create Team'}
          </button>
        </form>

        {/* No employees state */}
        {employees.length === 0 && (
          <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16, padding: '32px 24px', textAlign: 'center' }}>
            <p style={{ color: 'var(--text-muted)', margin: '0 0 14px', fontSize: 14 }}>
              No employees linked yet. Invite employees via your Profile page.
            </p>
            <button
              onClick={() => router.push('/profile')}
              style={{ background: TEAL, color: '#0f1117', borderRadius: 10, padding: '10px 22px', fontWeight: 700, fontSize: 14, border: 'none', cursor: 'pointer' }}
            >
              Go to Profile
            </button>
          </div>
        )}

        {/* Kanban grid — team columns + unassigned */}
        {(teams.length > 0 || unassigned.length > 0) && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 16, alignItems: 'start' }}>

            {teams.map((team, teamIdx) => {
              const teamColor = TEAM_COLORS[teamIdx % TEAM_COLORS.length];
              const members   = employees.filter(e => e.teamId === team.id);
              const isDeleting = deletingId === team.id;
              const isEditing  = editingTeam?.id === team.id;
              const menuId     = `menu-${team.id}`;

              return (
                <div key={team.id} style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 18, overflow: 'hidden' }}>

                  {/* Card header */}
                  <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ width: 10, height: 10, borderRadius: '50%', background: teamColor, flexShrink: 0 }} />

                    {isEditing ? (
                      <div style={{ display: 'flex', gap: 6, flex: 1 }}>
                        <input
                          value={editingName}
                          onChange={e => setEditingName(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') handleRenameTeam(); if (e.key === 'Escape') setEditingTeam(null); }}
                          autoFocus
                          style={{ ...inputStyle, flex: 1, padding: '5px 8px', fontSize: 13, borderRadius: 7 }}
                        />
                        <button
                          onClick={handleRenameTeam}
                          disabled={savingEdit}
                          style={{ background: TEAL, color: '#0f1117', borderRadius: 7, padding: '5px 11px', fontSize: 12, fontWeight: 700, border: 'none', cursor: 'pointer', whiteSpace: 'nowrap' }}
                        >
                          {savingEdit ? '…' : 'Save'}
                        </button>
                        <button
                          onClick={() => setEditingTeam(null)}
                          style={{ background: 'none', color: 'var(--text-muted)', border: 'none', cursor: 'pointer', fontSize: 16, padding: '0 2px', lineHeight: 1 }}
                        >
                          ✕
                        </button>
                      </div>
                    ) : (
                      <>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 700, fontSize: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{team.name}</div>
                          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>{members.length} member{members.length !== 1 ? 's' : ''}</div>
                        </div>

                        {/* ⋯ menu */}
                        <div data-dropdown style={{ position: 'relative', flexShrink: 0 }}>
                          <button
                            onClick={() => setOpenDropdown(openDropdown === menuId ? null : menuId)}
                            style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 20, cursor: 'pointer', padding: '2px 5px', borderRadius: 6, lineHeight: 1, display: 'flex', alignItems: 'center' }}
                          >
                            ⋯
                          </button>
                          {openDropdown === menuId && (
                            <div style={{ position: 'absolute', right: 0, top: 'calc(100% + 4px)', background: 'var(--modal-bg)', border: '1px solid var(--border)', borderRadius: 10, zIndex: 50, minWidth: 150, boxShadow: '0 8px 24px rgba(0,0,0,0.25)', overflow: 'hidden' }}>
                              <button
                                onClick={() => { setEditingTeam(team); setEditingName(team.name); setOpenDropdown(null); }}
                                style={{ display: 'block', width: '100%', textAlign: 'left', padding: '10px 14px', background: 'none', border: 'none', borderBottom: '1px solid var(--border-subtle)', color: 'var(--text)', fontSize: 13, cursor: 'pointer' }}
                                onMouseEnter={e => (e.currentTarget.style.background = 'var(--card-alt)')}
                                onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                              >
                                Rename
                              </button>
                              <button
                                onClick={() => { handleDeleteTeam(team); setOpenDropdown(null); }}
                                disabled={isDeleting}
                                style={{ display: 'block', width: '100%', textAlign: 'left', padding: '10px 14px', background: 'none', border: 'none', color: '#EF4444', fontSize: 13, cursor: 'pointer', opacity: isDeleting ? 0.5 : 1 }}
                                onMouseEnter={e => (e.currentTarget.style.background = 'var(--card-alt)')}
                                onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                              >
                                {isDeleting ? 'Deleting…' : 'Delete team'}
                              </button>
                            </div>
                          )}
                        </div>
                      </>
                    )}
                  </div>

                  {/* Member chips */}
                  <div style={{ padding: '12px 14px', minHeight: 56, maxHeight: 220, overflowY: 'auto', display: 'flex', flexWrap: 'wrap', gap: 8, alignContent: 'flex-start' }}>
                    {members.length === 0 ? (
                      <p style={{ color: 'var(--text-dim)', fontSize: 12, margin: 0 }}>No members yet.</p>
                    ) : members.map(emp => {
                      const dropId = `member-${emp.patientId}`;
                      return (
                        <div key={emp.patientId} data-dropdown style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 5, background: `${teamColor}18`, border: `1px solid ${teamColor}35`, borderRadius: 999, padding: '3px 9px 3px 4px' }}>
                          <div style={{ width: 20, height: 20, borderRadius: '50%', background: teamColor, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 800, color: '#0f1117', flexShrink: 0 }}>
                            {avatarInitial(emp.displayName)}
                          </div>
                          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap', maxWidth: 110, overflow: 'hidden', textOverflow: 'ellipsis' }}>{emp.displayName}</span>
                          <button
                            onClick={() => setOpenDropdown(openDropdown === dropId ? null : dropId)}
                            disabled={savingMove === emp.patientId}
                            style={{ background: 'none', border: 'none', color: 'var(--text-dim)', fontSize: 9, cursor: 'pointer', padding: '0 1px', lineHeight: 1 }}
                          >
                            {savingMove === emp.patientId ? '…' : '▾'}
                          </button>
                          {openDropdown === dropId && (
                            <div style={{ position: 'absolute', left: 0, top: 'calc(100% + 6px)', background: 'var(--modal-bg)', border: '1px solid var(--border)', borderRadius: 10, zIndex: 50, minWidth: 180, boxShadow: '0 8px 24px rgba(0,0,0,0.25)', overflow: 'hidden' }}>
                              <button
                                onClick={() => { handleMoveEmployee(emp.patientId, null); setOpenDropdown(null); }}
                                style={{ display: 'block', width: '100%', textAlign: 'left', padding: '10px 14px', background: 'none', border: 'none', borderBottom: '1px solid var(--border-subtle)', color: '#EF4444', fontSize: 13, cursor: 'pointer' }}
                                onMouseEnter={e => (e.currentTarget.style.background = 'var(--card-alt)')}
                                onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                              >
                                Remove from team
                              </button>
                              {teams.filter(t => t.id !== emp.teamId).map(t => (
                                <button
                                  key={t.id}
                                  onClick={() => { handleMoveEmployee(emp.patientId, t.id); setOpenDropdown(null); }}
                                  style={{ display: 'block', width: '100%', textAlign: 'left', padding: '10px 14px', background: 'none', border: 'none', borderBottom: '1px solid var(--border-subtle)', color: 'var(--text)', fontSize: 13, cursor: 'pointer' }}
                                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--card-alt)')}
                                  onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                                >
                                  Move to {t.name}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}

            {/* Unassigned column */}
            {unassigned.length > 0 && (
              <div style={{ border: '2px dashed rgba(245,158,11,0.40)', background: 'rgba(245,158,11,0.03)', borderRadius: 18, overflow: 'hidden' }}>
                <div style={{ padding: '14px 16px', borderBottom: '1px solid rgba(245,158,11,0.15)', display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ width: 10, height: 10, borderRadius: '50%', border: '2px dashed #F59E0B', flexShrink: 0 }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: 14 }}>Unassigned</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>{unassigned.length} employee{unassigned.length !== 1 ? 's' : ''}</div>
                  </div>
                </div>
                <div style={{ padding: '12px 14px', minHeight: 56, maxHeight: 220, overflowY: 'auto', display: 'flex', flexWrap: 'wrap', gap: 8, alignContent: 'flex-start' }}>
                  {unassigned.map(emp => {
                    const dropId = emp.patientId;
                    return (
                      <div key={emp.patientId} data-dropdown style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 5, background: 'var(--card-alt)', border: '1px solid var(--border-strong)', borderRadius: 999, padding: '3px 9px 3px 4px' }}>
                        <div style={{ width: 20, height: 20, borderRadius: '50%', background: 'var(--text-dim)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 800, color: 'var(--bg)', flexShrink: 0 }}>
                          {avatarInitial(emp.displayName)}
                        </div>
                        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap', maxWidth: 110, overflow: 'hidden', textOverflow: 'ellipsis' }}>{emp.displayName}</span>
                        {teams.length > 0 && (
                          <>
                            <button
                              onClick={() => setOpenDropdown(openDropdown === dropId ? null : dropId)}
                              disabled={savingMove === emp.patientId}
                              style={{ background: 'none', border: 'none', color: 'var(--text-dim)', fontSize: 9, cursor: 'pointer', padding: '0 1px', lineHeight: 1 }}
                            >
                              {savingMove === emp.patientId ? '…' : '▾'}
                            </button>
                            {openDropdown === dropId && (
                              <div style={{ position: 'absolute', right: 0, top: 'calc(100% + 6px)', background: 'var(--modal-bg)', border: '1px solid var(--border)', borderRadius: 10, zIndex: 50, minWidth: 160, boxShadow: '0 8px 24px rgba(0,0,0,0.25)', overflow: 'hidden' }}>
                                {teams.map((t, ti) => (
                                  <button
                                    key={t.id}
                                    onClick={() => { handleMoveEmployee(emp.patientId, t.id); setOpenDropdown(null); }}
                                    style={{ display: 'block', width: '100%', textAlign: 'left', padding: '10px 14px', background: 'none', border: 'none', borderBottom: ti < teams.length - 1 ? '1px solid var(--border-subtle)' : 'none', color: 'var(--text)', fontSize: 13, cursor: 'pointer' }}
                                    onMouseEnter={e => (e.currentTarget.style.background = 'var(--card-alt)')}
                                    onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                                  >
                                    {t.name}
                                  </button>
                                ))}
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

          </div>
        )}
      </main>
    </div>
  );
}
