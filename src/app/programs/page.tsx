'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getSupabase } from '@/lib/supabase';
import { DayPicker } from 'react-day-picker';
import type { DateRange } from 'react-day-picker';
import 'react-day-picker/style.css';
import { addMonths, startOfMonth, endOfMonth, format } from 'date-fns';

const TEAL   = '#1EDBA8';
const PURPLE = '#C471ED';
const AMBER  = '#F59E0B';
const GOLD   = '#FFD700';
const SILVER = '#94A3B8';
const BRONZE = '#CD7F32';

const MASTER_ID = process.env.NEXT_PUBLIC_FEATURED_PRACTITIONER_ID || '969ea6c6-ba6d-4ee4-8bb8-a7cee267f40c';

interface FeaturedTemplate {
  id: string;
  name: string;
  description: string | null;
  featured_duration_days: number | null;
  exercises: any;
  catalog_available_from:  string | null;
  catalog_available_until: string | null;
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

interface IndividualRow {
  userId: string; name: string; totalWorkouts: number; teamName: string | null;
}

interface ProgramRating {
  avg_effectiveness: number | null;
  avg_enjoyment:     number | null;
  rating_count:      number;
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
  if (s.seconds)        return `${s.seconds}s hold`;
  if (s.cardioduration != null || s.cardioSeconds != null) {
    const m = s.cardioduration ?? 0; const sec = s.cardioSeconds ?? 0;
    return sec > 0 ? `${m}:${String(sec).padStart(2, '0')} min cardio` : `${m} min cardio`;
  }
  const w = s.weight && s.weight > 0 ? ` @ ${s.weight}${s.unit ?? 'kg'}` : '';
  return `${s.reps ?? '?'} reps${w}`;
}

function serializeExercisesForMobile(exercises: any): any {
  if (!exercises) return exercises;
  function cvtSet(s: any, exType: string): any {
    if (exType !== 'duration') return s;
    const { seconds, ...rest } = s;
    return seconds != null ? { ...rest, duration: rest.duration ?? seconds } : s;
  }
  function cvtEx(ex: any): any {
    const type = ex.exercise?.type;
    return {
      ...ex,
      sets: (ex.sets ?? []).map((s: any) => cvtSet(s, type)),
      weeks: (ex.weeks ?? []).map((w: any) => ({ ...w, sets: (w.sets ?? []).map((s: any) => cvtSet(s, type)) })),
    };
  }
  if (Array.isArray(exercises)) return exercises.map(cvtEx);
  if (exercises.days) {
    return { ...exercises, days: exercises.days.map((d: any) => ({ ...d, exercises: (d.exercises ?? []).map(cvtEx) })) };
  }
  return exercises;
}

function getMonthOptions(): Date[] {
  const months: Date[] = [];
  const base = new Date();
  for (let i = 0; i <= 12; i++) months.push(startOfMonth(addMonths(base, i)));
  return months;
}

export default function ProgramsPage() {
  const router = useRouter();
  const [authed,                 setAuthed]                 = useState(false);
  const [userId,                 setUserId]                 = useState('');
  const [companyName,            setCompanyName]            = useState('');
  const [availableNowTemplates,  setAvailableNowTemplates]  = useState<FeaturedTemplate[]>([]);
  const [comingSoonTemplates,    setComingSoonTemplates]    = useState<FeaturedTemplate[]>([]);
  const [activePrograms,         setActivePrograms]         = useState<EmployerProgram[]>([]);
  const [pastPrograms,           setPastPrograms]           = useState<EmployerProgram[]>([]);
  const [teams,                  setTeams]                  = useState<Team[]>([]);
  const [leaderboard,            setLeaderboard]            = useState<LeaderboardRow[]>([]);
  const [lbProgramId,            setLbProgramId]            = useState<string | null>(null);
  const [lbDropdownOpen,         setLbDropdownOpen]         = useState(false);
  const lbDropdownRef = useRef<HTMLDivElement>(null);
  const [loading,                setLoading]                = useState(true);
  const [launchModal,            setLaunchModal]            = useState<FeaturedTemplate | null>(null);
  const [launching,              setLaunching]              = useState(false);
  const [launchError,            setLaunchError]            = useState('');
  const [launchDone,             setLaunchDone]             = useState(false);
  const [employeeCount,          setEmployeeCount]          = useState(0);
  const [previewTpl,             setPreviewTpl]             = useState<FeaturedTemplate | null>(null);
  const [removingProgId,         setRemovingProgId]         = useState<string | null>(null);
  const [selectedTplIds,         setSelectedTplIds]         = useState<string[]>([]);
  const [multiLaunch,            setMultiLaunch]            = useState(false);
  const [programRatings,         setProgramRatings]         = useState<Record<string, ProgramRating>>({});
  const [programEngagement,      setProgramEngagement]      = useState<Record<string, number>>({});
  const [lbView,                 setLbView]                 = useState<'team' | 'individual'>('team');
  const [individualLeaderboard,  setIndividualLeaderboard]  = useState<IndividualRow[]>([]);
  const [relaunchLoading,        setRelaunchLoading]        = useState<string | null>(null);

  // Date picker state (shared between single and multi-launch modals)
  const [dateTab,        setDateTab]        = useState<'month' | 'custom'>('month');
  const [selectedMonths, setSelectedMonths] = useState<Set<string>>(new Set());
  const [range,          setRange]          = useState<DateRange | undefined>(undefined);

  const monthOptions = getMonthOptions();

  function toggleMonth(key: string) {
    setSelectedMonths(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  function getMonthRange(): { from: string; until: string } | null {
    if (selectedMonths.size === 0) return null;
    const sorted = [...selectedMonths].sort();
    return {
      from:  format(startOfMonth(new Date(sorted[0] + '-01T12:00:00')), 'yyyy-MM-dd'),
      until: format(endOfMonth(new Date(sorted[sorted.length - 1] + '-01T12:00:00')), 'yyyy-MM-dd'),
    };
  }

  function getPickerDates(): { start: string; end: string } | null {
    if (dateTab === 'month') {
      const r = getMonthRange();
      return r ? { start: r.from, end: r.until } : null;
    }
    if (!range?.from || !range?.to) return null;
    return {
      start: format(range.from, 'yyyy-MM-dd'),
      end:   format(range.to,   'yyyy-MM-dd'),
    };
  }

  function resetPicker() {
    setDateTab('month');
    setSelectedMonths(new Set());
    setRange(undefined);
  }

  useEffect(() => {
    const sb = getSupabase();
    sb.auth.getSession().then(async ({ data }) => {
      if (!data.session) { router.push('/login'); return; }
      const { data: prof } = await sb.from('profiles').select('role, is_employer, company_name').eq('id', data.session.user.id).single();
      if (!prof || !(prof as any).is_employer) { router.push('/plans'); return; }
      const uid   = data.session.user.id;
      const today = new Date().toISOString().slice(0, 10);
      const d45   = new Date(); d45.setDate(d45.getDate() + 45);
      const future45 = d45.toISOString().slice(0, 10);

      setUserId(uid);
      setCompanyName((prof as any).company_name ?? '');
      setAuthed(true);

      const [templatesRes, programsRes, teamsRes, linkCountRes] = await Promise.all([
        sb.from('plan_templates')
          .select('id, name, description, featured_duration_days, exercises, catalog_available_from, catalog_available_until')
          .eq('practitioner_id', MASTER_ID)
          .eq('is_featured', true)
          .not('catalog_available_from', 'is', null)
          .lte('catalog_available_from', future45)
          .order('catalog_available_from'),
        sb.from('employer_programs')
          .select('id, plan_template_id, name, started_at, ends_at')
          .eq('employer_id', uid)
          .order('started_at', { ascending: false }),
        sb.from('employer_teams').select('id, name').eq('employer_id', uid).order('name'),
        sb.from('patient_links').select('patient_id', { count: 'exact', head: true }).eq('practitioner_id', uid),
      ]);

      // Exclude expired templates (until < today) — keep nulls (no expiry set)
      const allTemplates = ((templatesRes.data ?? []) as FeaturedTemplate[]).filter(
        t => !t.catalog_available_until || t.catalog_available_until >= today
      );
      setAvailableNowTemplates(allTemplates.filter(t => t.catalog_available_from! <= today));
      setComingSoonTemplates(allTemplates.filter(t => t.catalog_available_from! > today));

      const progs = (programsRes.data ?? []) as EmployerProgram[];
      const active = progs.filter(p => p.ends_at >= today);
      const past   = progs.filter(p => p.ends_at < today);
      setActivePrograms(active);
      setPastPrograms(past);
      setTeams((teamsRes.data as Team[]) ?? []);
      setEmployeeCount(linkCountRes.count ?? 0);

      if (active.length > 0) {
        const first = active[0];
        setLbProgramId(first.id);
        if (teamsRes.data && teamsRes.data.length > 0) {
          await loadLeaderboard(sb, uid, first, teamsRes.data as Team[]);
        } else if ((linkCountRes.count ?? 0) > 0) {
          setLbView('individual');
          await loadIndividualLeaderboard(sb, uid, first, []);
        }
      }
      setLoading(false);

      // Fetch aggregate ratings for this employer's employees (non-blocking)
      sb.rpc('get_employer_program_ratings', { p_employer_id: uid }).then(({ data: ratingsData }) => {
        if (!ratingsData) return;
        const map: Record<string, ProgramRating> = {};
        for (const r of ratingsData as any[]) {
          map[r.plan_template_id] = {
            avg_effectiveness: r.avg_effectiveness ? Number(r.avg_effectiveness) : null,
            avg_enjoyment:     r.avg_enjoyment     ? Number(r.avg_enjoyment)     : null,
            rating_count:      Number(r.rating_count),
          };
        }
        setProgramRatings(map);
      });

      // Non-blocking: unique employee count per active program
      if (active.length > 0) {
        Promise.all([
          sb.from('patient_links').select('patient_id').eq('practitioner_id', uid),
          sb.from('workout_plans').select('id').eq('practitioner_id', uid),
        ]).then(async ([linksRes2, planIdsRes]) => {
          const patientIds = (linksRes2.data ?? []).map((l: any) => l.patient_id as string);
          const planIds    = (planIdsRes.data ?? []).map((p: any) => p.id as string);
          if (!patientIds.length || !planIds.length) return;
          const engagement: Record<string, number> = {};
          for (const prog of active) {
            const { data: wkData } = await sb.from('synced_workouts')
              .select('user_id')
              .in('user_id', patientIds)
              .gte('date', prog.started_at)
              .lte('date', prog.ends_at)
              .filter('data->>planId', 'in', `(${planIds.join(',')})`);
            engagement[prog.id] = new Set((wkData ?? []).map((w: any) => w.user_id as string)).size;
          }
          setProgramEngagement(engagement);
        });
      }
    });
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { setLaunchModal(null); setPreviewTpl(null); setMultiLaunch(false); setLbDropdownOpen(false); }
    }
    function onMouseDown(e: MouseEvent) {
      if (lbDropdownRef.current && !lbDropdownRef.current.contains(e.target as Node)) setLbDropdownOpen(false);
    }
    window.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onMouseDown);
    return () => { window.removeEventListener('keydown', onKey); document.removeEventListener('mousedown', onMouseDown); };
  }, []);

  async function loadLeaderboard(sb: ReturnType<typeof getSupabase>, uid: string, prog: EmployerProgram, teamList: Team[]) {
    const [allLinksRes, planIdsRes] = await Promise.all([
      sb.from('patient_links').select('patient_id').eq('practitioner_id', uid),
      sb.from('workout_plans').select('id').eq('practitioner_id', uid),
    ]);
    const allLinks = (allLinksRes.data ?? []) as { patient_id: string }[];
    const planIds  = (planIdsRes.data ?? []).map((p: any) => p.id as string);

    if (allLinks.length === 0 || planIds.length === 0) {
      setLeaderboard(teamList.map(t => ({ teamId: t.id, teamName: t.name, totalWorkouts: 0, memberCount: 0 })));
      return;
    }

    const [linksRes, workoutsRes] = await Promise.all([
      sb.from('patient_links').select('patient_id, team_id').eq('practitioner_id', uid).not('team_id', 'is', null),
      sb.from('synced_workouts')
        .select('user_id, date')
        .in('user_id', allLinks.map((l: any) => l.patient_id))
        .gte('date', prog.started_at)
        .lte('date', prog.ends_at)
        .filter('data->>planId', 'in', `(${planIds.join(',')})`),
    ]);
    const links  = (linksRes.data ?? []) as { patient_id: string; team_id: string }[];
    const wkouts = (workoutsRes.data ?? []) as { user_id: string }[];
    const teamTotals: Record<string, number>     = {};
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

  async function loadAllLeaderboard(sb: ReturnType<typeof getSupabase>, uid: string, progs: EmployerProgram[], teamList: Team[]) {
    if (!progs.length) return;
    const startedAt = progs.reduce((min, p) => p.started_at < min ? p.started_at : min, progs[0].started_at);
    const endsAt    = progs.reduce((max, p) => p.ends_at   > max ? p.ends_at   : max, progs[0].ends_at);
    await loadLeaderboard(sb, uid, { id: '__all__', plan_template_id: '', name: 'All Programs', started_at: startedAt, ends_at: endsAt }, teamList);
  }

  async function loadIndividualLeaderboard(sb: ReturnType<typeof getSupabase>, uid: string, prog: EmployerProgram, teamList: Team[]) {
    const [linksRes, planIdsRes] = await Promise.all([
      sb.from('patient_links').select('patient_id, team_id').eq('practitioner_id', uid),
      sb.from('workout_plans').select('id').eq('practitioner_id', uid),
    ]);
    const links    = (linksRes.data ?? []) as { patient_id: string; team_id: string | null }[];
    const planIds  = (planIdsRes.data ?? []).map((p: any) => p.id as string);
    const patientIds = links.map(l => l.patient_id);
    if (!patientIds.length) { setIndividualLeaderboard([]); return; }
    const [wkRes, profilesRes] = await Promise.all([
      planIds.length > 0
        ? sb.from('synced_workouts').select('user_id').in('user_id', patientIds).gte('date', prog.started_at).lte('date', prog.ends_at).filter('data->>planId', 'in', `(${planIds.join(',')})`)
        : Promise.resolve({ data: [] as any[], error: null }),
      sb.from('profiles').select('id, display_name').in('id', patientIds),
    ]);
    const counts: Record<string, number> = {};
    for (const w of (wkRes.data ?? []) as { user_id: string }[]) counts[w.user_id] = (counts[w.user_id] ?? 0) + 1;
    const nameMap: Record<string, string> = {};
    for (const p of (profilesRes.data ?? []) as { id: string; display_name: string | null }[]) nameMap[p.id] = p.display_name ?? 'Employee';
    const teamNameMap: Record<string, string> = {};
    for (const t of teamList) teamNameMap[t.id] = t.name;
    setIndividualLeaderboard(
      links.map(l => ({
        userId: l.patient_id,
        name: nameMap[l.patient_id] ?? 'Employee',
        totalWorkouts: counts[l.patient_id] ?? 0,
        teamName: l.team_id ? (teamNameMap[l.team_id] ?? null) : null,
      })).sort((a, b) => b.totalWorkouts - a.totalWorkouts)
    );
  }

  async function loadAllIndividualLeaderboard(sb: ReturnType<typeof getSupabase>, uid: string, progs: EmployerProgram[], teamList: Team[]) {
    if (!progs.length) return;
    const startedAt = progs.reduce((min, p) => p.started_at < min ? p.started_at : min, progs[0].started_at);
    const endsAt    = progs.reduce((max, p) => p.ends_at   > max ? p.ends_at   : max, progs[0].ends_at);
    await loadIndividualLeaderboard(sb, uid, { id: '__all__', plan_template_id: '', name: 'All Programs', started_at: startedAt, ends_at: endsAt }, teamList);
  }

  async function handleRemoveProgram(prog: EmployerProgram) {
    if (!confirm(`End "${prog.name}" early? This will remove it from your active programs.`)) return;
    setRemovingProgId(prog.id);
    const sb = getSupabase();
    const { error } = await sb.from('employer_programs').delete().eq('id', prog.id);
    if (error) { alert('Could not remove program: ' + error.message); setRemovingProgId(null); return; }
    await sb.from('workout_plans').delete().eq('practitioner_id', userId).eq('name', prog.name);
    setActivePrograms(prev => {
      const next = prev.filter(p => p.id !== prog.id);
      if ((lbProgramId === prog.id || lbProgramId === '__all__') && next.length > 0) {
        setLbProgramId(next[0].id);
        if (lbView === 'individual') {
          loadIndividualLeaderboard(sb, userId, next[0], teams);
        } else if (teams.length > 0) {
          loadLeaderboard(sb, userId, next[0], teams);
        }
      } else if (next.length === 0) {
        setLbProgramId(null);
        setLeaderboard([]);
        setIndividualLeaderboard([]);
      }
      return next;
    });
    setRemovingProgId(null);
  }

  async function switchLbProgram(progId: string) {
    setLbProgramId(progId);
    const sb = getSupabase();
    if (lbView === 'individual') {
      if (progId === '__all__') {
        await loadAllIndividualLeaderboard(sb, userId, activePrograms, teams);
      } else {
        const prog = activePrograms.find(p => p.id === progId);
        if (prog) await loadIndividualLeaderboard(sb, userId, prog, teams);
      }
    } else {
      if (progId === '__all__') {
        if (teams.length > 0) await loadAllLeaderboard(sb, userId, activePrograms, teams);
      } else {
        const prog = activePrograms.find(p => p.id === progId);
        if (prog && teams.length > 0) await loadLeaderboard(sb, userId, prog, teams);
      }
    }
  }

  async function switchLbView(view: 'team' | 'individual') {
    setLbView(view);
    const sb = getSupabase();
    if (view === 'individual') {
      if (lbProgramId === '__all__') {
        await loadAllIndividualLeaderboard(sb, userId, activePrograms, teams);
      } else {
        const prog = activePrograms.find(p => p.id === lbProgramId);
        if (prog) await loadIndividualLeaderboard(sb, userId, prog, teams);
      }
    } else {
      if (lbProgramId === '__all__') {
        if (teams.length > 0) await loadAllLeaderboard(sb, userId, activePrograms, teams);
      } else {
        const prog = activePrograms.find(p => p.id === lbProgramId);
        if (prog && teams.length > 0) await loadLeaderboard(sb, userId, prog, teams);
      }
    }
  }

  async function handleRelaunch(prog: EmployerProgram) {
    setRelaunchLoading(prog.id);
    const sb = getSupabase();
    const { data: tplData } = await sb.from('plan_templates')
      .select('id, name, description, featured_duration_days, exercises, catalog_available_from, catalog_available_until')
      .eq('id', prog.plan_template_id)
      .single();
    setRelaunchLoading(null);
    if (!tplData) { alert('Could not load program details.'); return; }
    openLaunchModal(tplData as FeaturedTemplate);
  }

  function toggleSelect(id: string) {
    setSelectedTplIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  }

  function openMultiLaunch() {
    resetPicker();
    setLaunchError(''); setLaunchDone(false);
    setMultiLaunch(true);
  }

  async function handleMultiLaunch() {
    const dates = getPickerDates();
    if (!dates) { setLaunchError('Please select a date range.'); return; }
    const { start, end } = dates;
    if (start >= end) { setLaunchError('End date must be after start date.'); return; }
    setLaunching(true); setLaunchError('');
    const sb  = getSupabase();
    const now = new Date().toISOString();
    const { data: links, error: linksErr } = await sb.from('patient_links').select('patient_id').eq('practitioner_id', userId);
    if (linksErr) { setLaunchError('Could not load employees: ' + linksErr.message); setLaunching(false); return; }
    const employees = (links ?? []).map((l: any) => l.patient_id as string);
    const tolaunch  = availableNowTemplates.filter(t => selectedTplIds.includes(t.id) && !activePrograms.some(p => p.plan_template_id === t.id));
    const newProgs: EmployerProgram[] = [];
    for (const tpl of tolaunch) {
      if (employees.length > 0) {
        await sb.from('workout_plans').delete().eq('practitioner_id', userId).in('patient_id', employees).eq('name', tpl.name);
        const { error: plansErr } = await sb.from('workout_plans').insert(
          employees.map(patientId => ({ practitioner_id: userId, patient_id: patientId, name: tpl.name, description: tpl.description ?? null, exercises: serializeExercisesForMobile(tpl.exercises), created_at: now, updated_at: now }))

        );
        if (plansErr) { setLaunchError(`Could not assign "${tpl.name}": ` + plansErr.message); setLaunching(false); return; }
      }
      const { data: progData, error: progErr } = await sb.from('employer_programs').insert({ employer_id: userId, plan_template_id: tpl.id, name: tpl.name, started_at: start, ends_at: end }).select('id, plan_template_id, name, started_at, ends_at').single();
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
    resetPicker();
    setLaunchError(''); setLaunchDone(false);
    setLaunchModal(tpl);
  }

  async function handleLaunch() {
    if (!launchModal) return;
    const dates = getPickerDates();
    if (!dates) { setLaunchError('Please select a date range.'); return; }
    const { start, end } = dates;
    if (start >= end) { setLaunchError('End date must be after start date.'); return; }
    setLaunching(true); setLaunchError('');
    const sb  = getSupabase();
    const now = new Date().toISOString();
    const { data: links, error: linksErr } = await sb.from('patient_links').select('patient_id').eq('practitioner_id', userId);
    if (linksErr) { setLaunchError('Could not load employees: ' + linksErr.message); setLaunching(false); return; }
    const employees = (links ?? []).map((l: any) => l.patient_id as string);
    if (employees.length > 0) {
      await sb.from('workout_plans').delete().eq('practitioner_id', userId).in('patient_id', employees).eq('name', launchModal.name);
      const { error: plansErr } = await sb.from('workout_plans').insert(
        employees.map(patientId => ({ practitioner_id: userId, patient_id: patientId, name: launchModal.name, description: launchModal.description ?? null, exercises: serializeExercisesForMobile(launchModal.exercises), created_at: now, updated_at: now }))
      );
      if (plansErr) { setLaunchError('Could not assign plans: ' + plansErr.message); setLaunching(false); return; }
    }
    const { data: progData, error: progErr } = await sb.from('employer_programs').insert({ employer_id: userId, plan_template_id: launchModal.id, name: launchModal.name, started_at: start, ends_at: end }).select('id, plan_template_id, name, started_at, ends_at').single();
    if (progErr) { setLaunchError('Could not save program: ' + progErr.message); setLaunching(false); return; }
    const newProg = progData as EmployerProgram;
    setActivePrograms(prev => [newProg, ...prev]);
    if (teams.length > 0) { setLbProgramId(newProg.id); await loadLeaderboard(sb, userId, newProg, teams); }
    setLaunchDone(true); setLaunching(false);
    setTimeout(() => setLaunchModal(null), 1200);
  }

  if (loading || !authed) return <div style={{ minHeight: '100vh', background: 'var(--bg)' }} />;

  const today      = new Date().toISOString().slice(0, 10);
  const lbProgram  = activePrograms.find(p => p.id === lbProgramId) ?? activePrograms[0] ?? null;
  const pickerDates = getPickerDates();

  const DatePickerUI = (
    <>
      <div style={{ display: 'flex', background: 'var(--input-bg)', borderRadius: 10, padding: 4, marginBottom: 16, gap: 4 }}>
        {(['month', 'custom'] as const).map(t => (
          <button
            key={t}
            onClick={() => setDateTab(t)}
            style={{
              flex: 1, border: 'none', borderRadius: 8, padding: '8px 0',
              fontSize: 13, fontWeight: 700, cursor: 'pointer',
              background: dateTab === t ? 'var(--card)' : 'transparent',
              color: dateTab === t ? 'var(--text)' : 'var(--text-dim)',
              transition: 'background 0.15s',
            }}
          >
            {t === 'month' ? 'By Month' : 'Custom Range'}
          </button>
        ))}
      </div>

      {dateTab === 'month' && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 12 }}>
            {monthOptions.map(m => {
              const key = format(m, 'yyyy-MM');
              const sel = selectedMonths.has(key);
              return (
                <button
                  key={key}
                  onClick={() => toggleMonth(key)}
                  style={{
                    border: `1.5px solid ${sel ? TEAL : 'var(--border-strong)'}`,
                    borderRadius: 10, padding: '10px 6px',
                    background: sel ? `${TEAL}18` : 'transparent',
                    color: sel ? TEAL : 'var(--text-dim)',
                    fontSize: 13, fontWeight: 700, cursor: 'pointer',
                    transition: 'all 0.15s',
                  }}
                >
                  {format(m, 'MMM yyyy')}
                </button>
              );
            })}
          </div>
          {(() => {
            const r = getMonthRange();
            return r ? (
              <div style={{ background: `${TEAL}12`, border: `1px solid ${TEAL}30`, borderRadius: 10, padding: '10px 14px', fontSize: 13, color: TEAL, fontWeight: 600, marginBottom: 12 }}>
                {format(new Date(r.from + 'T12:00:00'), 'MMM d')} → {format(new Date(r.until + 'T12:00:00'), 'MMM d, yyyy')}
                {selectedMonths.size > 1 && (
                  <span style={{ color: 'var(--text-muted)', fontWeight: 400, marginLeft: 8 }}>
                    · {selectedMonths.size} month{selectedMonths.size !== 1 ? 's' : ''} selected
                  </span>
                )}
              </div>
            ) : (
              <div style={{ borderRadius: 10, padding: '10px 14px', fontSize: 13, color: 'var(--text-dim)', border: '1px dashed var(--border-strong)', marginBottom: 12 }}>
                Select one or more months above
              </div>
            );
          })()}
        </>
      )}

      {dateTab === 'custom' && (
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
          <DayPicker className="liftlog-rdp" mode="range" selected={range} onSelect={setRange} />
        </div>
      )}
    </>
  );

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', color: 'var(--text)', fontFamily: 'sans-serif' }}>
      <style>{`
        .liftlog-rdp {
          --rdp-accent-color: ${TEAL};
          --rdp-accent-background-color: ${TEAL}22;
          color: var(--text);
        }
        .liftlog-rdp .rdp-month_caption_label { color: var(--text); font-weight: 700; }
        .liftlog-rdp .rdp-nav button { color: var(--text-dim); }
        .liftlog-rdp .rdp-weekday { color: var(--text-dim); font-size: 11px; }
        .liftlog-rdp .rdp-day_button { color: var(--text); border-radius: 8px; }
        .liftlog-rdp .rdp-day_button:hover:not([disabled]) { background: var(--border-strong) !important; }
        .liftlog-rdp .rdp-range_middle { background: ${TEAL}18; }
        .liftlog-rdp .rdp-selected .rdp-day_button { color: ${TEAL}; }
        .liftlog-rdp .rdp-range_start .rdp-day_button,
        .liftlog-rdp .rdp-range_end .rdp-day_button { background: ${TEAL} !important; color: #0f1117 !important; font-weight: 700; }
        .liftlog-rdp .rdp-today .rdp-day_button { border: 1.5px solid ${TEAL}60; }
        .liftlog-rdp .rdp-outside { opacity: 0.3; }
      `}</style>

      <main style={{ maxWidth: 1000, margin: '0 auto', padding: '40px 32px' }}>

        {/* Header */}
        <div style={{ marginBottom: 32 }}>
          <h1 style={{ fontSize: 28, fontWeight: 800, margin: '0 0 6px' }}>{companyName ? `${companyName} Programs` : 'Programs'}</h1>
          <p style={{ color: 'var(--text-muted)', margin: 0, fontSize: 15 }}>Launch company-wide fitness programs for your employees.</p>
        </div>

        {/* Active Programs */}
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
                    {employeeCount > 0 && programEngagement[prog.id] != null && (
                      <p style={{ margin: '5px 0 0', fontSize: 13, color: TEAL, fontWeight: 600 }}>
                        {programEngagement[prog.id]} / {employeeCount} employee{employeeCount !== 1 ? 's' : ''} started
                      </p>
                    )}
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

        {/* Auto-expiry reminder */}
        {(() => {
          const expiring = activePrograms.find(p => { const d = daysRemaining(p.ends_at); return d > 0 && d <= 3; });
          const hasUnlaunched = availableNowTemplates.some(t => !activePrograms.some(p => p.plan_template_id === t.id));
          if (!expiring) return null;
          const days = daysRemaining(expiring.ends_at);
          return (
            <div style={{ background: `${AMBER}12`, border: `1.5px solid ${AMBER}50`, borderRadius: 16, padding: '16px 20px', marginBottom: 24, display: 'flex', alignItems: 'center', gap: 14 }}>
              <span style={{ fontSize: 22, flexShrink: 0 }}>⏰</span>
              <div style={{ flex: 1 }}>
                <p style={{ fontWeight: 700, fontSize: 14, margin: '0 0 2px', color: AMBER }}>
                  {expiring.name} ends in {days} day{days !== 1 ? 's' : ''}
                </p>
                <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>
                  {hasUnlaunched
                    ? 'New programs are available — scroll down to pick your next one.'
                    : comingSoonTemplates.length > 0
                      ? `Next month's programs are coming soon — scroll down to preview them.`
                      : 'Contact your administrator for next month\'s programs.'}
                </p>
              </div>
              {hasUnlaunched && (
                <button
                  onClick={() => { const el = document.getElementById('available-now'); el?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}
                  style={{ background: AMBER, color: '#0f1117', border: 'none', borderRadius: 10, padding: '8px 16px', fontWeight: 700, fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}
                >
                  Browse →
                </button>
              )}
            </div>
          );
        })()}

        {/* Leaderboard */}
        {activePrograms.length > 0 && (teams.length > 0 || employeeCount > 0) && (
          <div style={{ marginBottom: 48 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 4 }}>
              <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.08em', margin: 0 }}>
                Leaderboard
              </p>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {teams.length > 0 && (
                  <div style={{ display: 'flex', background: 'var(--card)', border: '1px solid var(--border-strong)', borderRadius: 8, padding: 3 }}>
                    {(['team', 'individual'] as const).map(v => (
                      <button
                        key={v}
                        onClick={() => switchLbView(v)}
                        style={{
                          border: 'none', borderRadius: 6, padding: '4px 10px',
                          fontSize: 12, fontWeight: 700, cursor: 'pointer',
                          background: lbView === v ? TEAL : 'transparent',
                          color: lbView === v ? '#0f1117' : 'var(--text-dim)',
                          transition: 'background 0.15s',
                        }}
                      >
                        {v === 'team' ? 'Teams' : 'Individual'}
                      </button>
                    ))}
                  </div>
                )}
                {activePrograms.length > 1 && (
                  <div ref={lbDropdownRef} style={{ position: 'relative' }}>
                    <button
                      onClick={() => setLbDropdownOpen(o => !o)}
                      style={{
                        background: 'var(--card)', border: '1px solid var(--border-strong)', borderRadius: 8,
                        padding: '6px 12px', color: 'var(--text)', fontSize: 13, fontWeight: 600,
                        cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, outline: 'none',
                      }}
                    >
                      {lbProgramId === '__all__' ? 'All Programs' : (activePrograms.find(p => p.id === lbProgramId)?.name ?? 'Select…')}
                      <span style={{ fontSize: 9, color: 'var(--text-dim)', lineHeight: 1 }}>▼</span>
                    </button>
                    {lbDropdownOpen && (
                      <div style={{
                        position: 'absolute', top: 'calc(100% + 4px)', right: 0,
                        background: 'var(--modal-bg)', border: '1px solid var(--border-strong)',
                        borderRadius: 10, overflow: 'hidden', zIndex: 50, minWidth: 220,
                        boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
                      }}>
                        <button
                          onClick={() => { switchLbProgram('__all__'); setLbDropdownOpen(false); }}
                          style={{
                            display: 'block', width: '100%', padding: '10px 14px', textAlign: 'left',
                            background: lbProgramId === '__all__' ? `${TEAL}18` : 'transparent',
                            color: lbProgramId === '__all__' ? TEAL : 'var(--text)',
                            border: 'none', fontSize: 13, fontWeight: lbProgramId === '__all__' ? 700 : 500, cursor: 'pointer',
                          }}
                        >
                          All Programs
                        </button>
                        {activePrograms.map(p => (
                          <button
                            key={p.id}
                            onClick={() => { switchLbProgram(p.id); setLbDropdownOpen(false); }}
                            style={{
                              display: 'block', width: '100%', padding: '10px 14px', textAlign: 'left',
                              background: lbProgramId === p.id ? `${TEAL}18` : 'transparent',
                              color: lbProgramId === p.id ? TEAL : 'var(--text)',
                              border: 'none', borderTop: '1px solid var(--border-subtle)',
                              fontSize: 13, fontWeight: lbProgramId === p.id ? 700 : 500, cursor: 'pointer',
                            }}
                          >
                            {p.name}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
            {lbProgramId === '__all__' ? (
              <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 20 }}>All active programs combined</p>
            ) : lbProgram ? (
              <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 20 }}>
                {lbProgram.name} · {fmt(lbProgram.started_at)} — {fmt(lbProgram.ends_at)}
              </p>
            ) : null}
            {lbView === 'team' ? (
              leaderboard.every(r => r.totalWorkouts === 0) ? (
                <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16, padding: '32px 24px', textAlign: 'center' }}>
                  <p style={{ color: 'var(--text-muted)', margin: 0, fontSize: 14 }}>No workouts logged yet. Leaderboard fills in as employees log sessions.</p>
                </div>
              ) : (
                <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 20, overflow: 'hidden' }}>
                  {leaderboard.length >= 3 && (
                    <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'center', gap: 16, padding: '32px 24px 0', background: 'var(--card-alt)' }}>
                      {[leaderboard[1], leaderboard[0], leaderboard[2]].map((row, i) => {
                        const rank  = i === 1 ? 1 : i === 0 ? 2 : 3;
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
              )
            ) : (
              individualLeaderboard.length === 0 ? (
                <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16, padding: '32px 24px', textAlign: 'center' }}>
                  <p style={{ color: 'var(--text-muted)', margin: 0, fontSize: 14 }}>No employees found. Invite employees via your Profile page.</p>
                </div>
              ) : (
                <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 20, overflow: 'hidden' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ background: 'var(--card-alt)', borderBottom: '1px solid var(--border)' }}>
                        {['Rank', 'Employee', ...(teams.length > 0 ? ['Team'] : []), 'Workouts'].map(h => (
                          <th key={h} style={{ padding: '10px 20px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {individualLeaderboard.map((row, idx) => (
                        <tr key={row.userId} style={{ borderTop: '1px solid var(--border-subtle)' }}>
                          <td style={{ padding: '14px 20px', fontSize: 14, fontWeight: 700, color: idx === 0 ? GOLD : idx === 1 ? SILVER : idx === 2 ? BRONZE : 'var(--text-dim)' }}>
                            {idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `#${idx + 1}`}
                          </td>
                          <td style={{ padding: '14px 20px', fontSize: 15, fontWeight: 700 }}>{row.name}</td>
                          {teams.length > 0 && (
                            <td style={{ padding: '14px 20px', fontSize: 13, color: 'var(--text-muted)' }}>{row.teamName ?? '—'}</td>
                          )}
                          <td style={{ padding: '14px 20px', fontSize: 14, color: TEAL, fontWeight: 700 }}>{row.totalWorkouts}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            )}
            {teams.length === 0 && (
              <div style={{ marginTop: 14, background: `${PURPLE}10`, border: `1px solid ${PURPLE}30`, borderRadius: 12, padding: '12px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
                <p style={{ color: 'var(--text-dim)', margin: 0, fontSize: 13 }}>Create teams to unlock the Team Leaderboard.</p>
                <button onClick={() => router.push('/teams')} style={{ background: PURPLE, color: 'var(--text)', borderRadius: 8, padding: '7px 16px', fontWeight: 700, fontSize: 13, border: 'none', cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}>Set Up Teams →</button>
              </div>
            )}
          </div>
        )}

        {/* Available Now */}
        {availableNowTemplates.length > 0 && (
          <div id="available-now" style={{ marginBottom: 40 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: TEAL, display: 'inline-block', flexShrink: 0 }} />
              <p style={{ fontSize: 11, fontWeight: 700, color: TEAL, textTransform: 'uppercase', letterSpacing: '0.08em', margin: 0 }}>
                Available Now
              </p>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
              {availableNowTemplates.map(tpl => {
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
                    {tpl.catalog_available_until && (
                      <p style={{ fontSize: 12, color: 'var(--text-dim)', margin: '-6px 0 0' }}>Available until {fmt(tpl.catalog_available_until)}</p>
                    )}
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
            {selectedTplIds.length === 0 && availableNowTemplates.some(t => !activePrograms.some(p => p.plan_template_id === t.id)) && (
              <p style={{ fontSize: 13, color: 'var(--text-dim)', margin: '16px 0 0', textAlign: 'center' }}>
                Tip: check the circle on multiple cards to launch them all at once
              </p>
            )}
          </div>
        )}

        {/* Coming Soon */}
        {comingSoonTemplates.length > 0 && (
          <div style={{ marginBottom: 40 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: PURPLE, display: 'inline-block', flexShrink: 0 }} />
              <p style={{ fontSize: 11, fontWeight: 700, color: PURPLE, textTransform: 'uppercase', letterSpacing: '0.08em', margin: 0 }}>
                Coming Soon
              </p>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
              {comingSoonTemplates.map(tpl => {
                const count = exCount(tpl);
                const daysAway = Math.max(0, Math.ceil((new Date(tpl.catalog_available_from! + 'T12:00:00').getTime() - Date.now()) / 86400000));
                return (
                  <div
                    key={tpl.id}
                    onClick={() => setPreviewTpl(tpl)}
                    style={{
                      position: 'relative',
                      background: 'var(--card)',
                      border: `1.5px solid ${PURPLE}30`,
                      borderRadius: 18, padding: 24, display: 'flex', flexDirection: 'column', gap: 14,
                      cursor: 'pointer', opacity: 0.85,
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
                      <h3 style={{ fontWeight: 800, fontSize: 17, margin: 0, lineHeight: 1.3 }}>{tpl.name}</h3>
                      <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                        {count > 0 && <span style={{ background: 'var(--badge-teal-bg)', color: 'var(--badge-teal-text)', fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 999 }}>{count} ex</span>}
                        {tpl.featured_duration_days && <span style={{ background: `${PURPLE}20`, color: PURPLE, fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 999 }}>{tpl.featured_duration_days}d</span>}
                      </div>
                    </div>
                    {tpl.description && <p style={{ color: 'var(--text-muted)', fontSize: 14, margin: 0, lineHeight: 1.5 }}>{tpl.description}</p>}
                    <div style={{ background: `${PURPLE}12`, border: `1px solid ${PURPLE}30`, borderRadius: 10, padding: '10px 14px', textAlign: 'center' }}>
                      <p style={{ fontSize: 13, fontWeight: 700, color: PURPLE, margin: 0 }}>Available {fmt(tpl.catalog_available_from!)}</p>
                      <p style={{ fontSize: 12, color: 'var(--text-dim)', margin: '2px 0 0' }}>{daysAway} day{daysAway !== 1 ? 's' : ''} away</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* No programs at all */}
        {availableNowTemplates.length === 0 && comingSoonTemplates.length === 0 && (
          <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16, padding: '40px 24px', textAlign: 'center', marginBottom: 40 }}>
            <p style={{ color: 'var(--text-muted)', margin: 0 }}>No programs are available right now. Check back soon.</p>
          </div>
        )}

        {/* Past Programs */}
        {pastPrograms.length > 0 && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
              <p style={{ fontSize: 11, fontWeight: 700, color: AMBER, textTransform: 'uppercase', letterSpacing: '0.08em', margin: 0 }}>
                Past Programs
              </p>
              <div style={{ flex: 1, height: 1, background: AMBER + '30' }} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {pastPrograms.map(prog => {
                const rating = programRatings[prog.plan_template_id] ?? null;
                return (
                  <div key={prog.id} style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, padding: '16px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', opacity: 0.82 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontWeight: 700, fontSize: 15, margin: '0 0 2px' }}>{prog.name}</p>
                      <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: 0 }}>{fmt(prog.started_at)} — {fmt(prog.ends_at)}</p>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                      {rating && rating.rating_count > 0 ? (
                        <>
                          {rating.avg_effectiveness !== null && (
                            <div style={{ textAlign: 'center' }}>
                              <p style={{ fontSize: 15, fontWeight: 800, color: TEAL, margin: 0, lineHeight: 1 }}>{rating.avg_effectiveness.toFixed(1)}</p>
                              <p style={{ fontSize: 10, color: 'var(--text-dim)', margin: '2px 0 0', fontWeight: 600 }}>effectiveness</p>
                            </div>
                          )}
                          {rating.avg_enjoyment !== null && (
                            <div style={{ textAlign: 'center' }}>
                              <p style={{ fontSize: 15, fontWeight: 800, color: PURPLE, margin: 0, lineHeight: 1 }}>{rating.avg_enjoyment.toFixed(1)}</p>
                              <p style={{ fontSize: 10, color: 'var(--text-dim)', margin: '2px 0 0', fontWeight: 600 }}>enjoyment</p>
                            </div>
                          )}
                          <div style={{ textAlign: 'center' }}>
                            <p style={{ fontSize: 15, fontWeight: 800, color: 'var(--text-muted)', margin: 0, lineHeight: 1 }}>{rating.rating_count}</p>
                            <p style={{ fontSize: 10, color: 'var(--text-dim)', margin: '2px 0 0', fontWeight: 600 }}>{rating.rating_count === 1 ? 'rating' : 'ratings'}</p>
                          </div>
                        </>
                      ) : (
                        <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>No ratings yet</span>
                      )}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: AMBER, background: `${AMBER}18`, borderRadius: 999, padding: '3px 10px', whiteSpace: 'nowrap' }}>Completed</span>
                        <button
                          onClick={() => handleRelaunch(prog)}
                          disabled={relaunchLoading === prog.id}
                          style={{
                            background: TEAL, color: '#0f1117', border: 'none', borderRadius: 8,
                            padding: '5px 12px', fontSize: 12, fontWeight: 700, cursor: relaunchLoading === prog.id ? 'wait' : 'pointer',
                            opacity: relaunchLoading === prog.id ? 0.6 : 1, whiteSpace: 'nowrap',
                          }}
                        >
                          {relaunchLoading === prog.id ? 'Loading…' : 'Re-launch'}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
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
          <div style={{ width: '100%', maxWidth: 500, background: 'var(--modal-bg)', border: '1px solid var(--border)', borderRadius: 24, padding: 36, maxHeight: '90vh', overflowY: 'auto' }}>
            <h2 style={{ fontSize: 20, fontWeight: 800, margin: '0 0 4px' }}>Launch Programs</h2>
            <p style={{ color: 'var(--text-muted)', fontSize: 14, margin: '0 0 20px' }}>All selected programs will share the same dates.</p>

            <div style={{ background: 'var(--card-alt)', border: '1px solid var(--border)', borderRadius: 12, marginBottom: 20, overflow: 'hidden' }}>
              {availableNowTemplates.filter(t => selectedTplIds.includes(t.id)).map((tpl, i) => (
                <div key={tpl.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '11px 16px', borderTop: i > 0 ? '1px solid var(--border-subtle)' : 'none' }}>
                  <span style={{ fontWeight: 700, fontSize: 14 }}>{tpl.name}</span>
                  {activePrograms.some(p => p.plan_template_id === tpl.id) && (
                    <span style={{ fontSize: 11, fontWeight: 700, color: TEAL, background: `${TEAL}15`, borderRadius: 999, padding: '2px 9px' }}>Already running</span>
                  )}
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {DatePickerUI}
              {employeeCount > 0 && (
                <div style={{ background: `${TEAL}12`, border: `1px solid ${TEAL}30`, borderRadius: 10, padding: '12px 16px', fontSize: 13, color: 'var(--text-muted)', marginBottom: 4 }}>
                  Each program will be assigned to all <strong style={{ color: 'var(--text)' }}>{employeeCount} linked employee{employeeCount !== 1 ? 's' : ''}</strong>.
                </div>
              )}
              {employeeCount === 0 && (
                <div style={{ background: '#F59E0B18', border: '1px solid #F59E0B40', borderRadius: 10, padding: '12px 16px', fontSize: 13, color: '#F59E0B', marginBottom: 4 }}>
                  No linked employees found. Invite employees via your Profile page before launching.
                </div>
              )}
              {launchError && <p style={{ color: '#EF4444', fontSize: 13, margin: 0 }}>{launchError}</p>}
              <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
                <button onClick={() => setMultiLaunch(false)} disabled={launching} style={{ flex: 1, background: 'var(--card-alt)', color: 'var(--text-muted)', border: '1px solid var(--border-strong)', borderRadius: 10, padding: '12px 0', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>Cancel</button>
                <button
                  onClick={handleMultiLaunch}
                  disabled={launching || launchDone || employeeCount === 0 || !pickerDates}
                  style={{ flex: 2, background: launchDone ? TEAL : PURPLE, color: launchDone ? '#0f1117' : 'var(--text)', border: 'none', borderRadius: 10, padding: '12px 0', fontSize: 14, fontWeight: 700, cursor: (launching || launchDone || employeeCount === 0 || !pickerDates) ? 'not-allowed' : 'pointer', opacity: (launching || employeeCount === 0 || !pickerDates) ? 0.6 : 1, transition: 'background 0.2s' }}
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
              {previewTpl.catalog_available_from && previewTpl.catalog_available_from <= today && !activePrograms.some(p => p.plan_template_id === previewTpl.id) && (
                <button
                  onClick={() => { setPreviewTpl(null); openLaunchModal(previewTpl); }}
                  style={{ flex: 2, background: TEAL, color: '#0f1117', border: 'none', borderRadius: 10, padding: '11px 0', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}
                >
                  Launch This Program
                </button>
              )}
              {previewTpl.catalog_available_from && previewTpl.catalog_available_from > today && (
                <div style={{ flex: 2, background: `${PURPLE}15`, border: `1px solid ${PURPLE}30`, borderRadius: 10, padding: '11px 0', textAlign: 'center', fontSize: 13, fontWeight: 700, color: PURPLE }}>
                  Available {fmt(previewTpl.catalog_available_from)}
                </div>
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
          <div style={{ width: '100%', maxWidth: 480, background: 'var(--modal-bg)', border: '1px solid var(--border)', borderRadius: 24, padding: 36, maxHeight: '90vh', overflowY: 'auto' }}>
            <h2 style={{ fontSize: 20, fontWeight: 800, margin: '0 0 6px' }}>Launch Program</h2>
            <p style={{ color: 'var(--text-muted)', fontSize: 14, margin: '0 0 20px' }}>{launchModal.name}</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {DatePickerUI}
              {employeeCount === 0 && (
                <div style={{ background: '#F59E0B18', border: '1px solid #F59E0B40', borderRadius: 10, padding: '12px 16px', fontSize: 13, color: '#F59E0B', marginBottom: 4 }}>
                  No linked employees found. Invite employees via your Profile page before launching.
                </div>
              )}
              {employeeCount > 0 && (
                <div style={{ background: `${TEAL}12`, border: `1px solid ${TEAL}30`, borderRadius: 10, padding: '12px 16px', fontSize: 13, color: 'var(--text-muted)', marginBottom: 4 }}>
                  This plan will be assigned to all <strong style={{ color: 'var(--text)' }}>{employeeCount} linked employee{employeeCount !== 1 ? 's' : ''}</strong>.
                </div>
              )}
              {launchError && <p style={{ color: '#EF4444', fontSize: 13, margin: 0 }}>{launchError}</p>}
              <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
                <button onClick={() => setLaunchModal(null)} disabled={launching} style={{ flex: 1, background: 'var(--card-alt)', color: 'var(--text-muted)', border: '1px solid var(--border-strong)', borderRadius: 10, padding: '12px 0', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>Cancel</button>
                <button
                  onClick={handleLaunch}
                  disabled={launching || launchDone || employeeCount === 0 || !pickerDates}
                  style={{ flex: 2, background: launchDone ? TEAL : PURPLE, color: launchDone ? '#0f1117' : 'var(--text)', border: 'none', borderRadius: 10, padding: '12px 0', fontSize: 14, fontWeight: 700, cursor: (launching || launchDone || employeeCount === 0 || !pickerDates) ? 'not-allowed' : 'pointer', opacity: (launching || employeeCount === 0 || !pickerDates) ? 0.6 : 1, transition: 'background 0.2s' }}
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
