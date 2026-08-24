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
  captainId: string | null;
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
  const [showCreate,   setShowCreate]   = useState(false);
  const [editingTeam,  setEditingTeam]  = useState<Team | null>(null);
  const [editingName,  setEditingName]  = useState('');
  const [savingEdit,   setSavingEdit]   = useState(false);
  const [deletingId,   setDeletingId]   = useState<string | null>(null);
  const [savingMove,   setSavingMove]   = useState<string | null>(null);
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const [draggingId,   setDraggingId]   = useState<string | null>(null);
  const [dragOver,     setDragOver]     = useState<string | null>(null);
  const [selectedIds,  setSelectedIds]  = useState<Set<string>>(new Set());
  const [bulkAssigning, setBulkAssigning] = useState(false);

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
      sb.from('employer_teams').select('id, name, captain_id').eq('employer_id', uid).order('name'),
      sb.from('patient_links').select('patient_id, team_id, profiles!patient_links_patient_id_fkey(display_name)').eq('practitioner_id', uid),
    ]);

    setTeams(((teamsRes.data ?? []) as any[]).map(t => ({ id: t.id, name: t.name, captainId: (t.captain_id ?? null) as string | null })));
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
      setTeams(prev => [...prev, { id: (data as any).id, name: (data as any).name, captainId: null }].sort((a, b) => a.name.localeCompare(b.name)));
      setNewTeamName('');
      setShowCreate(false);
    } else if (error) {
      alert('Could not create team: ' + error.message);
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
    setSelectedIds(prev => { const n = new Set(prev); n.delete(patientId); return n; });
    setSavingMove(null);
  }

  async function handleBulkAssign(teamId: string) {
    setBulkAssigning(true);
    const ids = Array.from(selectedIds);
    const sb = getSupabase();
    const { error } = await sb
      .from('patient_links')
      .update({ team_id: teamId })
      .eq('practitioner_id', userId)
      .in('patient_id', ids);
    if (!error) {
      setEmployees(prev => prev.map(e => selectedIds.has(e.patientId) ? { ...e, teamId } : e));
      setSelectedIds(new Set());
    } else {
      alert('Could not assign employees: ' + error.message);
    }
    setBulkAssigning(false);
    setOpenDropdown(null);
  }

  async function handleSetCaptain(teamId: string, patientId: string | null) {
    const sb = getSupabase();
    const { error } = await sb.from('employer_teams').update({ captain_id: patientId }).eq('id', teamId);
    if (!error) {
      setTeams(prev => prev.map(t => t.id === teamId ? { ...t, captainId: patientId } : t));
    }
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
        <div style={{ marginBottom: 36 }}>
          {!showCreate ? (
            <button
              onClick={() => setShowCreate(true)}
              style={{ background: TEAL, color: '#0f1117', borderRadius: 10, padding: '10px 20px', fontWeight: 700, fontSize: 14, border: 'none', cursor: 'pointer' }}
            >
              + Create Team
            </button>
          ) : (
            <form onSubmit={handleCreateTeam} style={{ display: 'flex', gap: 10, maxWidth: 480 }}>
              <input
                value={newTeamName}
                onChange={e => setNewTeamName(e.target.value)}
                placeholder="Team name…"
                autoFocus
                onKeyDown={e => { if (e.key === 'Escape') { setShowCreate(false); setNewTeamName(''); } }}
                style={inputStyle}
              />
              <button
                type="submit"
                disabled={creating || !newTeamName.trim()}
                style={{ background: TEAL, color: '#0f1117', borderRadius: 10, padding: '10px 20px', fontWeight: 700, fontSize: 14, border: 'none', cursor: creating ? 'not-allowed' : 'pointer', opacity: creating ? 0.7 : 1, whiteSpace: 'nowrap' }}
              >
                {creating ? 'Creating…' : 'Create'}
              </button>
              <button
                type="button"
                onClick={() => { setShowCreate(false); setNewTeamName(''); }}
                style={{ background: 'none', border: '1px solid var(--border-strong)', color: 'var(--text-muted)', borderRadius: 10, padding: '10px 16px', fontSize: 14, cursor: 'pointer' }}
              >
                Cancel
              </button>
            </form>
          )}
        </div>

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

              const isDragTarget = dragOver === team.id;

              return (
                <div
                  key={team.id}
                  onDragOver={e => { e.preventDefault(); setDragOver(team.id); }}
                  onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(null); }}
                  onDrop={() => { if (draggingId) { handleMoveEmployee(draggingId, team.id); setDraggingId(null); } setDragOver(null); }}
                  style={{ background: 'var(--card)', border: isDragTarget ? `2px solid ${teamColor}` : '1px solid var(--border)', borderRadius: 18, boxShadow: isDragTarget ? `0 0 0 3px ${teamColor}22` : 'none', transition: 'border 0.15s, box-shadow 0.15s' }}
                >

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
                  <div style={{ padding: '12px 14px', minHeight: 56, display: 'flex', flexWrap: 'wrap', gap: 8, alignContent: 'flex-start' }}>
                    {members.length === 0 ? (
                      <p style={{ color: 'var(--text-dim)', fontSize: 12, margin: 0 }}>No members yet.</p>
                    ) : members.map(emp => {
                      const dropId = `member-${emp.patientId}`;
                      const isCaptain = team.captainId === emp.patientId;
                      return (
                        <div
                          key={emp.patientId}
                          data-dropdown
                          draggable
                          onDragStart={() => setDraggingId(emp.patientId)}
                          onDragEnd={() => { setDraggingId(null); setDragOver(null); }}
                          style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 5, background: isCaptain ? `${teamColor}28` : `${teamColor}18`, border: isCaptain ? '1.5px solid #F59E0B' : `1px solid ${teamColor}35`, borderRadius: 999, padding: '3px 9px 3px 4px', cursor: 'grab', opacity: draggingId === emp.patientId ? 0.4 : 1 }}
                        >
                          <div style={{ width: 20, height: 20, borderRadius: '50%', background: teamColor, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 800, color: '#0f1117', flexShrink: 0 }}>
                            {avatarInitial(emp.displayName)}
                          </div>
                          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap', maxWidth: 110, overflow: 'hidden', textOverflow: 'ellipsis' }}>{emp.displayName}</span>
                          <button
                            onClick={e => { e.stopPropagation(); handleSetCaptain(team.id, isCaptain ? null : emp.patientId); }}
                            title={isCaptain ? 'Remove as captain' : 'Make captain'}
                            style={{ background: 'none', border: 'none', padding: '0 1px', cursor: 'pointer', display: 'flex', alignItems: 'center', flexShrink: 0, lineHeight: 1 }}
                            onMouseEnter={e => { if (!isCaptain) (e.currentTarget.querySelector('svg') as SVGElement | null)?.setAttribute('stroke', '#F59E0B'); }}
                            onMouseLeave={e => { if (!isCaptain) (e.currentTarget.querySelector('svg') as SVGElement | null)?.setAttribute('stroke', 'var(--text-faint)'); }}
                          >
                            <svg width="12" height="12" viewBox="0 0 24 24" fill={isCaptain ? '#F59E0B' : 'none'} stroke={isCaptain ? '#F59E0B' : 'var(--text-faint)'} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26" />
                            </svg>
                          </button>
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
            {unassigned.length > 0 && (() => {
              const allSelected = unassigned.length > 0 && unassigned.every(e => selectedIds.has(e.patientId));
              const anySelected = unassigned.some(e => selectedIds.has(e.patientId));
              const isUnassignedDrop = dragOver === 'unassigned';
              return (
                <div
                  onDragOver={e => { e.preventDefault(); setDragOver('unassigned'); }}
                  onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(null); }}
                  onDrop={() => { if (draggingId) { handleMoveEmployee(draggingId, null); setDraggingId(null); } setDragOver(null); }}
                  style={{ border: isUnassignedDrop ? '2px dashed #F59E0B' : '2px dashed rgba(245,158,11,0.40)', background: isUnassignedDrop ? 'rgba(245,158,11,0.08)' : 'rgba(245,158,11,0.03)', borderRadius: 18, transition: 'background 0.15s, border 0.15s' }}
                >
                  {/* Header */}
                  <div style={{ padding: '14px 16px', borderBottom: '1px solid rgba(245,158,11,0.15)', display: 'flex', alignItems: 'center', gap: 10 }}>
                    <input
                      type="checkbox"
                      checked={allSelected}
                      ref={el => { if (el) el.indeterminate = anySelected && !allSelected; }}
                      onChange={() => {
                        if (allSelected) setSelectedIds(new Set());
                        else setSelectedIds(new Set(unassigned.map(e => e.patientId)));
                      }}
                      style={{ width: 15, height: 15, accentColor: '#F59E0B', flexShrink: 0, cursor: 'pointer' }}
                    />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 700, fontSize: 14 }}>Unassigned</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>{unassigned.length} employee{unassigned.length !== 1 ? 's' : ''}</div>
                    </div>
                    {anySelected && teams.length > 0 && (
                      <div data-dropdown style={{ position: 'relative', flexShrink: 0 }}>
                        <button
                          onClick={() => setOpenDropdown(openDropdown === 'bulk-assign' ? null : 'bulk-assign')}
                          disabled={bulkAssigning}
                          style={{ background: '#F59E0B', color: '#0f1117', border: 'none', borderRadius: 8, padding: '6px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}
                        >
                          {bulkAssigning ? 'Assigning…' : `Assign ${selectedIds.size} ▾`}
                        </button>
                        {openDropdown === 'bulk-assign' && (
                          <div style={{ position: 'absolute', right: 0, top: 'calc(100% + 4px)', background: 'var(--modal-bg)', border: '1px solid var(--border)', borderRadius: 10, zIndex: 50, minWidth: 160, boxShadow: '0 8px 24px rgba(0,0,0,0.25)', overflow: 'hidden' }}>
                            {teams.map((t, ti) => (
                              <button
                                key={t.id}
                                onClick={() => handleBulkAssign(t.id)}
                                style={{ display: 'block', width: '100%', textAlign: 'left', padding: '10px 14px', background: 'none', border: 'none', borderBottom: ti < teams.length - 1 ? '1px solid var(--border-subtle)' : 'none', color: 'var(--text)', fontSize: 13, cursor: 'pointer' }}
                                onMouseEnter={e => (e.currentTarget.style.background = 'var(--card-alt)')}
                                onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                              >
                                {t.name}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Rows */}
                  <div style={{ paddingBottom: 4 }}>
                    {unassigned.map((emp, idx) => {
                      const dropId = emp.patientId;
                      const isChecked = selectedIds.has(emp.patientId);
                      return (
                        <div
                          key={emp.patientId}
                          draggable
                          onDragStart={() => setDraggingId(emp.patientId)}
                          onDragEnd={() => { setDraggingId(null); setDragOver(null); }}
                          style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', borderTop: idx > 0 ? '1px solid rgba(245,158,11,0.12)' : 'none', cursor: 'grab', opacity: draggingId === emp.patientId ? 0.4 : 1, background: isChecked ? 'rgba(245,158,11,0.07)' : 'none' }}
                        >
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => {
                              setSelectedIds(prev => {
                                const n = new Set(prev);
                                isChecked ? n.delete(emp.patientId) : n.add(emp.patientId);
                                return n;
                              });
                            }}
                            onClick={e => e.stopPropagation()}
                            style={{ width: 15, height: 15, accentColor: '#F59E0B', flexShrink: 0, cursor: 'pointer' }}
                          />
                          <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--text-dim)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800, color: 'var(--bg)', flexShrink: 0 }}>
                            {avatarInitial(emp.displayName)}
                          </div>
                          <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{emp.displayName}</span>
                          {teams.length > 0 && (
                            <div data-dropdown style={{ position: 'relative', flexShrink: 0 }}>
                              <button
                                onClick={() => setOpenDropdown(openDropdown === dropId ? null : dropId)}
                                disabled={savingMove === emp.patientId}
                                style={{ background: 'var(--card-alt)', border: '1px solid var(--border-strong)', borderRadius: 8, padding: '5px 10px', color: 'var(--text-muted)', fontSize: 12, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap' }}
                              >
                                {savingMove === emp.patientId ? 'Moving…' : 'Assign ▾'}
                              </button>
                              {openDropdown === dropId && (
                                <div style={{ position: 'absolute', right: 0, top: 'calc(100% + 4px)', background: 'var(--modal-bg)', border: '1px solid var(--border)', borderRadius: 10, zIndex: 50, minWidth: 160, boxShadow: '0 8px 24px rgba(0,0,0,0.25)', overflow: 'hidden' }}>
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
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}

          </div>
        )}
      </main>
    </div>
  );
}
