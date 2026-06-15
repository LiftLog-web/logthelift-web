'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getSupabase } from '@/lib/supabase';
import { Sk, SkPage, SkNav } from '@/components/Skeleton';

const TEAL    = '#5fcfbf';
const PURPLE  = '#C471ED';
const AMBER   = '#F59E0B';
const BLUE    = '#3B82F6';

type AttentionItem =
  | { type: 'inactive';        patient_id: string; patientName: string; days: number | null }
  | { type: 'no_plan';         patient_id: string; patientName: string }
  | { type: 'multiple_plans';  patient_id: string; patientName: string; planCount: number };

interface Plan {
  id: string;
  name: string;
  description: string | null;
  patient_id: string;
  patientName: string;
  created_at: string;
  exerciseCount: number;
  weeks: number[];
  exercisesRaw: any;
}

interface PatientGroup {
  patient_id: string;
  patientName: string;
  plans: Plan[];
}

function flatExList(raw: any): any[] {
  if (Array.isArray(raw)) return raw;
  if (raw?.days) return (raw.days as any[]).flatMap((d: any) => d.exercises ?? []);
  return [];
}

function deriveWeeks(raw: any): number[] {
  const list = flatExList(raw);
  if (list.length === 0) return [];
  const s = new Set<number>();
  for (const ex of list) {
    if (ex.weeks?.length > 0) {
      for (const w of ex.weeks) { if (typeof w.week === 'number') s.add(w.week); }
      if (ex.sets?.length > 0) s.add(1);
    } else {
      s.add(1);
    }
  }
  return Array.from(s).sort((a, b) => a - b);
}

function filterByWeeks(raw: any, sel: number[]): any {
  const ws = new Set(sel);
  const keep = (ex: any) => {
    if (!ex.weeks?.length) return ws.has(1) ? ex : null;
    const filtered = ex.weeks.filter((w: any) => ws.has(w.week));
    if (filtered.length) return { ...ex, weeks: filtered };
    if (ws.has(1) && ex.sets?.length > 0) { const { weeks: _, ...rest } = ex; return rest; }
    return null;
  };
  if (Array.isArray(raw)) return (raw.map(keep).filter(Boolean) as any[]);
  if (raw?.days) return { ...raw, days: raw.days.map((d: any) => ({ ...d, exercises: (d.exercises ?? []).map(keep).filter(Boolean) })) };
  return raw;
}

// Returns all weeks present in raw, including soft-deleted inactiveWeeks
function deriveAllWeeks(raw: any): number[] {
  const list = flatExList(raw);
  if (list.length === 0) return [];
  const s = new Set<number>();
  for (const ex of list) {
    if (ex.sets?.length > 0) s.add(1);
    for (const w of (ex.weeks ?? [])) { if (typeof w.week === 'number') s.add(w.week); }
    for (const w of (ex.inactiveWeeks ?? [])) { if (typeof w.week === 'number') s.add(w.week); }
  }
  return Array.from(s).sort((a, b) => a - b);
}

// Soft-assigns weeks: selected weeks become active, unselected move to inactiveWeeks (preserved for re-enabling)
function assignWeeks(raw: any, sel: number[]): any {
  const ws = new Set(sel);
  const processEx = (ex: any) => {
    const allData = new Map<number, any[]>();
    if (ex.sets?.length > 0) allData.set(1, ex.sets);
    for (const w of (ex.weeks ?? [])) { if (typeof w.week === 'number') allData.set(w.week, w.sets ?? []); }
    for (const w of (ex.inactiveWeeks ?? [])) { if (typeof w.week === 'number') allData.set(w.week, w.sets ?? []); }
    const active: { week: number; sets: any[] }[] = [];
    const inactive: { week: number; sets: any[] }[] = [];
    for (const [week, sets] of allData) {
      (ws.has(week) ? active : inactive).push({ week, sets });
    }
    active.sort((a, b) => a.week - b.week);
    inactive.sort((a, b) => a.week - b.week);
    const w1 = active.find(w => w.week === 1);
    const others = active.filter(w => w.week !== 1);
    const { weeks: _w, inactiveWeeks: _iw, ...exBase } = ex as any;
    const result: any = { ...exBase, sets: w1?.sets ?? ex.sets };
    if (others.length > 0) result.weeks = others;
    if (inactive.length > 0) result.inactiveWeeks = inactive;
    return result;
  };
  if (Array.isArray(raw)) return raw.map(processEx);
  if (raw?.days) return { ...raw, days: raw.days.map((d: any) => ({ ...d, exercises: (d.exercises ?? []).map(processEx) })) };
  return raw;
}

function daysSince(dateStr: string | null | undefined): number | null {
  if (!dateStr) return null;
  const diff = Date.now() - new Date(dateStr).getTime();
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}

export default function PlansPage() {
  const router = useRouter();
  const [plans, setPlans]         = useState<Plan[]>([]);
  const [loading, setLoading]     = useState(true);
  const [authed, setAuthed]       = useState(false);
  const [deleting, setDeleting]   = useState<string | null>(null);
  const [search, setSearch]       = useState('');
  const [expanded, setExpanded]   = useState<Set<string>>(new Set());
  const [userId, setUserId]             = useState<string>('');
  const [editingPlan, setEditingPlan]   = useState<Plan | null>(null);
  const [editingWeeks, setEditingWeeks] = useState<number[]>([]);
  const [editingTemplateFull, setEditingTemplateFull] = useState<any>(null);
  const [savingWeeks, setSavingWeeks]   = useState(false);

  // Needs attention
  const [threshold, setThreshold]           = useState(7);
  const [thresholdInput, setThresholdInput] = useState('7');
  const [savingThreshold, setSavingThreshold] = useState(false);
  const [lastWorkoutMap, setLastWorkoutMap] = useState<Map<string, string | null>>(new Map());
  const [noPlanPatients, setNoPlanPatients] = useState<{ patient_id: string; patientName: string }[]>([]);
  const [loadingActivity, setLoadingActivity] = useState(false);

  useEffect(() => {
    const sb = getSupabase();
    sb.auth.getSession().then(async ({ data }) => {
      if (!data.session) { router.push('/login'); return; }

      const { data: prof } = await sb
        .from('profiles')
        .select('role, approved, is_gym_owner, inactivity_threshold_days')
        .eq('id', data.session.user.id)
        .single();
      if (prof?.role !== 'practitioner' && !prof?.is_gym_owner) { router.push('/profile'); return; }

      const t = (prof as any)?.inactivity_threshold_days ?? 7;
      setThreshold(t);
      setThresholdInput(String(t));
      setUserId(data.session.user.id);
      setAuthed(true);

      const { data: rawPlans } = await sb
        .from('workout_plans')
        .select('id, name, description, patient_id, exercises, created_at, patient:patient_id(display_name)')
        .eq('practitioner_id', data.session.user.id)
        .order('created_at', { ascending: false });

      const mapped: Plan[] = (rawPlans ?? []).map((p: any) => {
        const patient = Array.isArray(p.patient) ? p.patient[0] : p.patient;
        const list = flatExList(p.exercises);
        return {
          id: p.id,
          name: p.name,
          description: p.description,
          patient_id: p.patient_id,
          patientName: patient?.display_name ?? 'Unknown',
          created_at: p.created_at,
          exerciseCount: list.length,
          weeks: deriveWeeks(p.exercises),
          exercisesRaw: p.exercises,
        };
      });

      setPlans(mapped);
      setLoading(false);

      // Fetch attention data in parallel
      const patientIds = [...new Set((rawPlans ?? []).map((p: any) => p.patient_id as string))];
      setLoadingActivity(true);
      const [workoutsResult, linkedResult] = await Promise.all([
        patientIds.length > 0
          ? sb.from('synced_workouts').select('user_id, date').in('user_id', patientIds).order('date', { ascending: false })
          : Promise.resolve({ data: [] }),
        sb.from('patient_links').select('patient_id, patient:patient_id(display_name)').eq('practitioner_id', data.session.user.id),
      ]);

      // Last workout map
      const map = new Map<string, string | null>();
      for (const id of patientIds) map.set(id, null);
      for (const w of (workoutsResult.data ?? [])) {
        if (!map.get(w.user_id)) map.set(w.user_id, w.date);
      }
      setLastWorkoutMap(map);

      // Patients with no plan assigned
      const planPatientIds = new Set(mapped.map(p => p.patient_id));
      const noPlan = (linkedResult.data ?? [])
        .filter((l: any) => !planPatientIds.has(l.patient_id))
        .map((l: any) => {
          const patient = Array.isArray(l.patient) ? l.patient[0] : l.patient;
          return { patient_id: l.patient_id, patientName: patient?.display_name ?? 'Unknown' };
        });
      setNoPlanPatients(noPlan);
      setLoadingActivity(false);
    });
  }, [router]);

  const handleSaveThreshold = async () => {
    const val = parseInt(thresholdInput, 10);
    if (isNaN(val) || val < 1) return;
    setSavingThreshold(true);
    await getSupabase().from('profiles').update({ inactivity_threshold_days: val }).eq('id', userId);
    setThreshold(val);
    setSavingThreshold(false);
  };

  const handleSaveWeeks = async () => {
    if (!editingPlan) return;
    setSavingWeeks(true);
    // Use patient's own data as source so inactiveWeeks are preserved and can be re-enabled.
    // Fall back to template only for weeks that don't exist anywhere in the patient's plan.
    const patientAllWeeks = new Set(deriveAllWeeks(editingPlan.exercisesRaw));
    const hasTemplateOnlyWeeks = editingTemplateFull && editingWeeks.some(w => !patientAllWeeks.has(w));
    const newExercisesRaw = hasTemplateOnlyWeeks
      ? filterByWeeks(editingTemplateFull, editingWeeks)
      : assignWeeks(editingPlan.exercisesRaw, editingWeeks);
    const { error } = await getSupabase()
      .from('workout_plans')
      .update({ exercises: newExercisesRaw })
      .eq('id', editingPlan.id);
    if (!error) {
      const newWeeks = deriveWeeks(newExercisesRaw);
      const newList = flatExList(newExercisesRaw);
      setPlans(prev => prev.map(p => p.id === editingPlan.id
        ? { ...p, exercisesRaw: newExercisesRaw, weeks: newWeeks, exerciseCount: newList.length }
        : p
      ));
      setEditingPlan(null);
      setEditingTemplateFull(null);
    }
    setSavingWeeks(false);
  };

  const handleDelete = async (planId: string) => {
    if (!confirm('Delete this plan? This cannot be undone.')) return;
    setDeleting(planId);
    await getSupabase().from('workout_plans').delete().eq('id', planId);
    setPlans(prev => prev.filter(p => p.id !== planId));
    setDeleting(null);
  };

  const toggleExpanded = (patientId: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(patientId) ? next.delete(patientId) : next.add(patientId);
      return next;
    });
  };

  // Group plans by patient
  const grouped: PatientGroup[] = [];
  const seen = new Map<string, PatientGroup>();
  for (const plan of plans) {
    if (!seen.has(plan.patient_id)) {
      const g: PatientGroup = { patient_id: plan.patient_id, patientName: plan.patientName, plans: [] };
      seen.set(plan.patient_id, g);
      grouped.push(g);
    }
    seen.get(plan.patient_id)!.plans.push(plan);
  }

  const filtered = grouped.filter(g =>
    g.patientName.toLowerCase().includes(search.toLowerCase())
  );

  // All attention flags combined (unfiltered by search)
  const attentionItems: AttentionItem[] = [
    ...noPlanPatients.map(p => ({ type: 'no_plan' as const, ...p })),
    ...grouped
      .filter(g => g.plans.length > 1)
      .map(g => ({ type: 'multiple_plans' as const, patient_id: g.patient_id, patientName: g.patientName, planCount: g.plans.length })),
    ...grouped
      .filter(g => { const d = daysSince(lastWorkoutMap.get(g.patient_id)); return d === null || d >= threshold; })
      .map(g => ({ type: 'inactive' as const, patient_id: g.patient_id, patientName: g.patientName, days: daysSince(lastWorkoutMap.get(g.patient_id)) })),
  ];

  if (!authed || loading) {
    return (
      <SkPage>
        <SkNav />
        <main style={{ maxWidth: 900, margin: '0 auto', padding: '32px 24px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
            <Sk width={140} height={26} radius={6} />
            <Sk width={200} height={38} radius={10} />
          </div>
          {[0,1].map(i => (
            <div key={i} style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16, padding: '16px 20px', marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
                <Sk width={140} height={16} />
                <Sk width={60} height={22} radius={999} style={{ marginLeft: 'auto' }} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12 }}>
                {[0,1,2].map(j => (
                  <div key={j} style={{ background: 'var(--card)', borderRadius: 12, padding: '14px 16px' }}>
                    <Sk width="70%" height={13} style={{ marginBottom: 8 }} />
                    <Sk width="50%" height={11} radius={4} />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </main>
      </SkPage>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', color: 'var(--text)', fontFamily: 'sans-serif' }}>
      <main style={{ maxWidth: 1100, margin: '0 auto', padding: '40px 32px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, flexWrap: 'wrap', gap: 16 }}>
          <div>
            <h1 style={{ fontSize: 28, fontWeight: 800, margin: 0 }}>Workout Plans</h1>
            <p style={{ color: 'var(--text-muted)', marginTop: 6, marginBottom: 0 }}>
              {grouped.length} patient{grouped.length !== 1 ? 's' : ''} · {plans.length} plan{plans.length !== 1 ? 's' : ''}
            </p>
          </div>

          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            {grouped.length > 0 && (
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search patients…"
                style={{
                  background: 'var(--card-alt)', border: '1px solid var(--border-strong)',
                  borderRadius: 10, padding: '10px 16px', color: 'var(--text)', fontSize: 14, outline: 'none', width: 220,
                }}
              />
            )}
            <button
              onClick={() => router.push('/plans/new')}
              style={{ background: TEAL, color: '#0f1117', borderRadius: 10, padding: '10px 22px', fontWeight: 700, fontSize: 14, border: 'none', cursor: 'pointer' }}
            >
              + New Plan
            </button>
          </div>
        </div>

        {plans.length === 0 ? (
          <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 20, padding: 60, textAlign: 'center', marginTop: 32 }}>
            <p style={{ fontSize: 40, marginBottom: 16 }}>📋</p>
            <p style={{ color: 'var(--text-muted)', marginBottom: 24 }}>No plans yet. Create your first plan for a patient.</p>
            <button onClick={() => router.push('/plans/new')} style={{ background: TEAL, color: '#0f1117', borderRadius: 12, padding: '12px 28px', fontWeight: 700, fontSize: 15, border: 'none', cursor: 'pointer' }}>
              Create First Plan
            </button>
          </div>
        ) : (
          <>
            {/* ── Needs Attention ── */}
            {!loadingActivity && (
              <div style={{ marginBottom: 28, marginTop: 24, border: `1px solid ${AMBER}40`, borderRadius: 16, overflow: 'hidden' }}>
                {/* Header */}
                <div style={{ background: `${AMBER}12`, padding: '14px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 15 }}>⚠️</span>
                    <span style={{ fontWeight: 700, fontSize: 15, color: AMBER }}>Needs Attention</span>
                    {attentionItems.length > 0 && (
                      <span style={{ background: AMBER, color: '#0f1117', fontSize: 11, fontWeight: 800, padding: '2px 8px', borderRadius: 999 }}>
                        {attentionItems.length}
                      </span>
                    )}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text-muted)', flexWrap: 'wrap' }}>
                    <span>Flag after</span>
                    <input
                      type="number"
                      min={1}
                      value={thresholdInput}
                      onChange={e => setThresholdInput(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && handleSaveThreshold()}
                      style={{
                        width: 52, background: 'var(--card-alt)', border: '1px solid var(--border-strong)',
                        borderRadius: 6, padding: '4px 8px', color: 'var(--text)', fontSize: 13,
                        textAlign: 'center', outline: 'none',
                      }}
                    />
                    <span>days without a workout</span>
                    {thresholdInput !== String(threshold) && (
                      <button
                        onClick={handleSaveThreshold}
                        disabled={savingThreshold}
                        style={{ background: TEAL, color: '#0f1117', border: 'none', borderRadius: 6, padding: '4px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer', opacity: savingThreshold ? 0.6 : 1 }}
                      >
                        {savingThreshold ? 'Saving…' : 'Save'}
                      </button>
                    )}
                  </div>
                </div>

                {/* Patient rows */}
                {attentionItems.length === 0 ? (
                  <div style={{ background: 'var(--card)', padding: '14px 20px', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ color: '#22c55e', fontSize: 15 }}>✓</span>
                    <span style={{ color: 'var(--text-muted)', fontSize: 14 }}>All patients are on track</span>
                  </div>
                ) : (
                  <div style={{ background: 'var(--card)' }}>
                    {attentionItems.map((item, i) => {
                      const flagColor = item.type === 'no_plan' ? BLUE : item.type === 'multiple_plans' ? PURPLE : AMBER;
                      const subtitle =
                        item.type === 'no_plan'        ? 'No plan assigned' :
                        item.type === 'multiple_plans' ? `${item.planCount} active plans — review if intentional` :
                        item.days === null              ? 'No workouts logged yet' :
                                                         `Last workout ${item.days} day${item.days !== 1 ? 's' : ''} ago`;
                      return (
                        <div
                          key={`${item.type}-${item.patient_id}`}
                          style={{
                            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                            padding: '12px 20px', borderTop: '1px solid var(--border-subtle)',
                            gap: 12, flexWrap: 'wrap',
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                            <div style={{ width: 36, height: 36, borderRadius: '50%', background: `${flagColor}20`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, flexShrink: 0 }}>
                              🏋️
                            </div>
                            <div>
                              <p style={{ margin: 0, fontWeight: 700, fontSize: 14, color: 'var(--text)' }}>{item.patientName}</p>
                              <p style={{ margin: 0, fontSize: 12, color: flagColor, marginTop: 2 }}>{subtitle}</p>
                            </div>
                          </div>
                          <div style={{ display: 'flex', gap: 8 }}>
                            <button
                              onClick={() => router.push(`/patients/${item.patient_id}`)}
                              style={{ background: 'var(--btn-purple-bg)', color: 'var(--btn-purple-text)', border: '1px solid var(--btn-purple-border)', borderRadius: 8, padding: '6px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
                            >
                              View Progress
                            </button>
                            <button
                              onClick={() => router.push(`/plans/new?patient=${item.patient_id}`)}
                              style={{ background: 'var(--btn-teal-bg)', color: 'var(--btn-teal-text)', border: '1px solid var(--btn-teal-border)', borderRadius: 8, padding: '6px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
                            >
                              + Add Plan
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* ── Patient plan list ── */}
            {filtered.length === 0 ? (
              <p style={{ color: 'var(--text-dim)', marginTop: 40, textAlign: 'center' }}>No patients match "{search}"</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {filtered.map(group => {
                  const isOpen = expanded.has(group.patient_id);
                  return (
                    <div key={group.patient_id} style={{ border: `1px solid ${isOpen ? PURPLE + '60' : 'var(--border)'}`, borderRadius: 16, overflow: 'hidden', transition: 'border-color 0.2s' }}>

                      {/* Patient header row */}
                      <button
                        onClick={() => toggleExpanded(group.patient_id)}
                        style={{
                          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                          padding: '18px 24px', background: isOpen ? `${PURPLE}12` : 'var(--card)',
                          border: 'none', cursor: 'pointer', transition: 'background 0.2s', textAlign: 'left',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                          <div style={{ width: 40, height: 40, borderRadius: '50%', background: `${PURPLE}25`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0 }}>
                            🏋️
                          </div>
                          <div>
                            <p style={{ margin: 0, fontWeight: 700, fontSize: 16, color: 'var(--text)' }}>
                              {group.patientName}
                            </p>
                            <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>
                              {group.plans.length} plan{group.plans.length !== 1 ? 's' : ''}
                            </p>
                          </div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <button
                            onClick={e => { e.stopPropagation(); router.push(`/patients/${group.patient_id}`); }}
                            style={{ background: 'var(--btn-purple-bg)', color: 'var(--btn-purple-text)', border: '1px solid var(--btn-purple-border)', borderRadius: 8, padding: '6px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
                          >
                            View Progress
                          </button>
                          <button
                            onClick={e => { e.stopPropagation(); router.push(`/plans/new?patient=${group.patient_id}`); }}
                            style={{ background: 'var(--btn-teal-bg)', color: 'var(--btn-teal-text)', border: '1px solid var(--btn-teal-border)', borderRadius: 8, padding: '6px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
                          >
                            + Add Plan
                          </button>
                          <span style={{ color: 'var(--text-muted)', fontSize: 18, transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s', display: 'inline-block' }}>
                            ▾
                          </span>
                        </div>
                      </button>

                      {/* Plans for this patient */}
                      {isOpen && (
                        <div style={{ borderTop: '1px solid var(--border-subtle)', padding: '16px 24px', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
                          {group.plans.map(plan => (
                            <div key={plan.id} style={{ background: 'var(--card)', border: `1px solid ${PURPLE}25`, borderRadius: 12, padding: 18, display: 'flex', flexDirection: 'column', gap: 10 }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                                <h3 style={{ fontWeight: 700, fontSize: 15, margin: 0 }}>{plan.name}</h3>
                                <span style={{ background: 'var(--badge-teal-bg)', color: 'var(--badge-teal-text)', fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 999, whiteSpace: 'nowrap', flexShrink: 0 }}>
                                  {plan.exerciseCount} ex
                                </span>
                              </div>
                              {plan.weeks.length > 0 && (
                                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
                                  {plan.weeks.map(w => (
                                    <button
                                      key={w}
                                      onClick={async e => {
                                        e.stopPropagation();
                                        setEditingPlan(plan);
                                        setEditingWeeks([...plan.weeks]);
                                        setEditingTemplateFull(null);
                                        const sb = getSupabase();
                                        const { data: tpl } = await sb
                                          .from('plan_templates')
                                          .select('exercises')
                                          .eq('practitioner_id', userId)
                                          .eq('name', plan.name)
                                          .maybeSingle();
                                        if (tpl) setEditingTemplateFull((tpl as any).exercises);
                                      }}
                                      title="Click to edit weeks"
                                      style={{ background: `${PURPLE}25`, color: PURPLE, fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 999, border: `1px solid ${PURPLE}40`, cursor: 'pointer', transition: 'background 0.15s' }}
                                      onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = `${PURPLE}45`; }}
                                      onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = `${PURPLE}25`; }}
                                    >
                                      W{w}
                                    </button>
                                  ))}
                                  <span style={{ fontSize: 10, color: 'var(--text-dim)', marginLeft: 2 }}>✎</span>
                                </div>
                              )}
                              {plan.description && (
                                <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: 0 }}>{plan.description}</p>
                              )}
                              <p style={{ color: 'var(--text-dim)', fontSize: 12, margin: 0 }}>
                                {new Date(plan.created_at).toLocaleDateString('en-CA')}
                              </p>
                              <div style={{ display: 'flex', gap: 8 }}>
                                <button
                                  onClick={() => router.push(`/plans/new?edit=${plan.id}`)}
                                  style={{ flex: 1, background: 'var(--btn-teal-bg)', color: 'var(--btn-teal-text)', borderRadius: 8, padding: '8px 0', fontWeight: 700, fontSize: 12, border: '1px solid var(--btn-teal-border)', cursor: 'pointer' }}
                                >
                                  Edit
                                </button>
                                <button
                                  onClick={() => handleDelete(plan.id)}
                                  disabled={deleting === plan.id}
                                  style={{ flex: 1, background: 'var(--btn-red-bg)', color: 'var(--btn-red-text)', borderRadius: 8, padding: '8px 0', fontWeight: 700, fontSize: 12, border: '1px solid var(--btn-red-border)', cursor: 'pointer', opacity: deleting === plan.id ? 0.5 : 1 }}
                                >
                                  Delete
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </main>

      {/* Edit Weeks modal */}
      {editingPlan && (
        <div
          onClick={() => { if (!savingWeeks) { setEditingPlan(null); setEditingTemplateFull(null); } }}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200, padding: 24 }}
        >
          <div onClick={e => e.stopPropagation()} style={{ background: 'var(--modal-bg)', border: '1px solid var(--border)', borderRadius: 20, width: '100%', maxWidth: 420, padding: 28 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16 }}>
              <div>
                <h2 style={{ fontWeight: 800, fontSize: 18, margin: 0 }}>Edit Shared Weeks</h2>
                <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: '4px 0 0' }}>{editingPlan.name} — {editingPlan.patientName}</p>
              </div>
              <button onClick={() => { setEditingPlan(null); setEditingTemplateFull(null); }} style={{ background: 'var(--card-alt)', border: 'none', color: 'var(--text-muted)', borderRadius: 8, width: 32, height: 32, fontSize: 18, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>×</button>
            </div>
            <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: '0 0 16px' }}>
              Select which weeks to share with this patient.{editingTemplateFull ? ' You can add or remove weeks.' : ' Unselected weeks will be removed.'}
            </p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20 }}>
              {Array.from(new Set([...deriveAllWeeks(editingPlan.exercisesRaw), ...(editingTemplateFull ? deriveWeeks(editingTemplateFull) : [])])).sort((a, b) => a - b).map(w => {
                const checked = editingWeeks.includes(w);
                return (
                  <button
                    key={w}
                    onClick={() => setEditingWeeks(prev => checked ? prev.filter(x => x !== w) : [...prev, w].sort((a, b) => a - b))}
                    style={{
                      padding: '8px 18px', borderRadius: 8, fontSize: 14, fontWeight: 700, cursor: 'pointer',
                      background: checked ? `${PURPLE}30` : 'var(--card-alt)',
                      color: checked ? PURPLE : 'var(--text-muted)',
                      border: `1px solid ${checked ? PURPLE + '60' : 'var(--border-strong)'}`,
                    }}
                  >
                    Week {w}
                  </button>
                );
              })}
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                onClick={() => { setEditingPlan(null); setEditingTemplateFull(null); }}
                disabled={savingWeeks}
                style={{ flex: 1, background: 'var(--card-alt)', color: 'var(--text-muted)', border: '1px solid var(--border-strong)', borderRadius: 10, padding: '11px 0', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}
              >
                Cancel
              </button>
              <button
                onClick={handleSaveWeeks}
                disabled={savingWeeks || editingWeeks.length === 0}
                style={{ flex: 2, background: PURPLE, color: 'var(--text)', border: 'none', borderRadius: 10, padding: '11px 0', fontSize: 14, fontWeight: 700, cursor: 'pointer', opacity: (savingWeeks || editingWeeks.length === 0) ? 0.6 : 1 }}
              >
                {savingWeeks ? 'Saving…' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
