'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getSupabase } from '@/lib/supabase';

const TEAL   = '#1EDBA8';
const PURPLE = '#C471ED';

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
    await sb.from('patient_links').update({ team_id: newTeamId }).eq('practitioner_id', userId).eq('patient_id', patientId);
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
      <main style={{ maxWidth: 800, margin: '0 auto', padding: '40px 32px' }}>

        {/* Header */}
        <div style={{ marginBottom: 32 }}>
          <h1 style={{ fontSize: 28, fontWeight: 800, margin: '0 0 6px' }}>Teams</h1>
          <p style={{ color: 'var(--text-muted)', margin: 0, fontSize: 15 }}>
            Organize employees into teams to compete on the Programs leaderboard.
          </p>
        </div>

        {/* Create Team */}
        <form onSubmit={handleCreateTeam} style={{ display: 'flex', gap: 10, marginBottom: 36 }}>
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

        {/* Team cards */}
        {teams.length === 0 && (
          <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16, padding: '40px 24px', textAlign: 'center', marginBottom: 24 }}>
            <p style={{ color: 'var(--text-muted)', margin: 0, fontSize: 14 }}>No teams yet. Create one above to start organizing employees.</p>
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginBottom: 32 }}>
          {teams.map(team => {
            const members = employees.filter(e => e.teamId === team.id);
            const isDeleting = deletingId === team.id;
            const isEditing  = editingTeam?.id === team.id;

            return (
              <div key={team.id} style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 18, overflow: 'hidden' }}>
                {/* Team header */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 24px', borderBottom: members.length > 0 ? '1px solid var(--border-subtle)' : 'none' }}>
                  {isEditing ? (
                    <div style={{ display: 'flex', gap: 10, flex: 1, marginRight: 12 }}>
                      <input
                        value={editingName}
                        onChange={e => setEditingName(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') handleRenameTeam(); if (e.key === 'Escape') setEditingTeam(null); }}
                        autoFocus
                        style={{ ...inputStyle, flex: 1 }}
                      />
                      <button onClick={handleRenameTeam} disabled={savingEdit} style={{ background: TEAL, color: '#0f1117', borderRadius: 8, padding: '8px 16px', fontSize: 13, fontWeight: 700, border: 'none', cursor: 'pointer' }}>
                        {savingEdit ? '…' : 'Save'}
                      </button>
                      <button onClick={() => setEditingTeam(null)} style={{ background: 'var(--card-alt)', color: 'var(--text-muted)', borderRadius: 8, padding: '8px 12px', fontSize: 13, fontWeight: 700, border: '1px solid var(--border-strong)', cursor: 'pointer' }}>
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <div>
                      <h3 style={{ fontWeight: 800, fontSize: 17, margin: 0 }}>{team.name}</h3>
                      <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '2px 0 0' }}>{members.length} member{members.length !== 1 ? 's' : ''}</p>
                    </div>
                  )}

                  {!isEditing && (
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button
                        onClick={() => { setEditingTeam(team); setEditingName(team.name); }}
                        style={{ background: 'var(--card-alt)', color: 'var(--text-muted)', border: '1px solid var(--border-strong)', borderRadius: 8, padding: '7px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
                      >
                        Rename
                      </button>
                      <button
                        onClick={() => handleDeleteTeam(team)}
                        disabled={isDeleting}
                        style={{ background: 'transparent', color: '#EF4444', border: '1px solid #EF444430', borderRadius: 8, padding: '7px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer', opacity: isDeleting ? 0.5 : 1 }}
                      >
                        {isDeleting ? 'Deleting…' : 'Delete'}
                      </button>
                    </div>
                  )}
                </div>

                {/* Members */}
                {members.length > 0 && (
                  <div style={{ padding: '16px 24px', display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                    {members.map(emp => (
                      <div key={emp.patientId} style={{ display: 'flex', alignItems: 'center', gap: 8, background: `${PURPLE}15`, border: `1px solid ${PURPLE}30`, borderRadius: 999, padding: '6px 14px' }}>
                        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{emp.displayName}</span>
                        <select
                          value={emp.teamId ?? ''}
                          onChange={e => handleMoveEmployee(emp.patientId, e.target.value || null)}
                          disabled={savingMove === emp.patientId}
                          style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', fontSize: 12, cursor: 'pointer', outline: 'none' }}
                        >
                          <option value="">— Remove from team</option>
                          {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                        </select>
                      </div>
                    ))}
                  </div>
                )}

                {members.length === 0 && (
                  <div style={{ padding: '14px 24px' }}>
                    <p style={{ color: 'var(--text-dim)', fontSize: 13, margin: 0 }}>No members yet — assign employees from the Unassigned list below.</p>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Unassigned Employees */}
        {unassigned.length > 0 && (
          <div>
            <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>
              Unassigned Employees ({unassigned.length})
            </p>
            <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 18, overflow: 'hidden' }}>
              {unassigned.map((emp, idx) => (
                <div
                  key={emp.patientId}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 24px', borderTop: idx > 0 ? '1px solid var(--border-subtle)' : 'none' }}
                >
                  <span style={{ fontWeight: 600, fontSize: 14 }}>{emp.displayName}</span>
                  {teams.length > 0 ? (
                    <select
                      value=""
                      onChange={e => { if (e.target.value) handleMoveEmployee(emp.patientId, e.target.value); }}
                      disabled={savingMove === emp.patientId}
                      style={{ background: 'var(--card-alt)', border: '1px solid var(--border-strong)', borderRadius: 8, padding: '7px 12px', color: 'var(--text)', fontSize: 13, cursor: 'pointer', outline: 'none' }}
                    >
                      <option value="">Add to team…</option>
                      {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                  ) : (
                    <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>Create a team above first</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

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
      </main>
    </div>
  );
}
