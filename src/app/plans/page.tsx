'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getSupabase } from '@/lib/supabase';

const TEAL   = '#5fcfbf';
const PURPLE = '#C471ED';

interface Plan {
  id: string;
  name: string;
  description: string | null;
  patient_id: string;
  patientName: string;
  created_at: string;
  exerciseCount: number;
}

interface PatientGroup {
  patient_id: string;
  patientName: string;
  plans: Plan[];
}

export default function PlansPage() {
  const router = useRouter();
  const [plans, setPlans]         = useState<Plan[]>([]);
  const [loading, setLoading]     = useState(true);
  const [authed, setAuthed]       = useState(false);
  const [deleting, setDeleting]   = useState<string | null>(null);
  const [search, setSearch]       = useState('');
  const [expanded, setExpanded]   = useState<Set<string>>(new Set());

  useEffect(() => {
    const sb = getSupabase();
    sb.auth.getSession().then(async ({ data }) => {
      if (!data.session) { router.push('/login'); return; }

      const { data: prof } = await sb.from('profiles').select('role, approved, is_gym_owner').eq('id', data.session.user.id).single();
      if (prof?.role !== 'practitioner' && !prof?.is_gym_owner) { router.push('/profile'); return; }
      setAuthed(true);

      const { data: rawPlans } = await sb
        .from('workout_plans')
        .select('id, name, description, patient_id, exercises, created_at, patient:patient_id(display_name)')
        .eq('practitioner_id', data.session.user.id)
        .order('created_at', { ascending: false });

      const mapped: Plan[] = (rawPlans ?? []).map((p: any) => {
        const patient = Array.isArray(p.patient) ? p.patient[0] : p.patient;
        return {
          id: p.id,
          name: p.name,
          description: p.description,
          patient_id: p.patient_id,
          patientName: patient?.display_name ?? 'Unknown',
          created_at: p.created_at,
          exerciseCount: Array.isArray(p.exercises) ? p.exercises.length : 0,
        };
      });

      setPlans(mapped);
      setLoading(false);
    });
  }, [router]);

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

  if (!authed || loading) {
    return (
      <div style={{ minHeight: '100vh', background: '#0f1117', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ width: 32, height: 32, border: `3px solid ${TEAL}`, borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: '#0f1117', color: '#fff', fontFamily: 'sans-serif' }}>
      <nav style={{ borderBottom: '1px solid rgba(255,255,255,0.1)', padding: '16px 32px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', maxWidth: 1100, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <a href="/" style={{ color: TEAL, fontWeight: 800, fontSize: 20, textDecoration: 'none' }}>LiftLog</a>
          <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: 14 }}>/ Plans</span>
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          <a href="/profile" style={{ color: 'rgba(255,255,255,0.5)', fontSize: 14, textDecoration: 'none', padding: '8px 16px' }}>Profile</a>
          <button
            onClick={() => router.push('/import')}
            style={{ background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.7)', borderRadius: 10, padding: '8px 20px', fontWeight: 700, fontSize: 14, border: '1px solid rgba(255,255,255,0.15)', cursor: 'pointer' }}
          >
            Import Patients
          </button>
          <button
            onClick={() => router.push('/plans/new')}
            style={{ background: TEAL, color: '#0f1117', borderRadius: 10, padding: '8px 20px', fontWeight: 700, fontSize: 14, border: 'none', cursor: 'pointer' }}
          >
            + New Plan
          </button>
        </div>
      </nav>

      <main style={{ maxWidth: 1100, margin: '0 auto', padding: '40px 32px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, flexWrap: 'wrap', gap: 16 }}>
          <div>
            <h1 style={{ fontSize: 28, fontWeight: 800, margin: 0 }}>Workout Plans</h1>
            <p style={{ color: 'rgba(255,255,255,0.4)', marginTop: 6, marginBottom: 0 }}>
              {grouped.length} patient{grouped.length !== 1 ? 's' : ''} · {plans.length} plan{plans.length !== 1 ? 's' : ''}
            </p>
          </div>

          {grouped.length > 0 && (
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search patients…"
              style={{
                background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.15)',
                borderRadius: 10, padding: '10px 16px', color: '#fff', fontSize: 14, outline: 'none', width: 220,
              }}
            />
          )}
        </div>

        {plans.length === 0 ? (
          <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 20, padding: 60, textAlign: 'center', marginTop: 32 }}>
            <p style={{ fontSize: 40, marginBottom: 16 }}>📋</p>
            <p style={{ color: 'rgba(255,255,255,0.4)', marginBottom: 24 }}>No plans yet. Create your first plan for a patient.</p>
            <button onClick={() => router.push('/plans/new')} style={{ background: TEAL, color: '#0f1117', borderRadius: 12, padding: '12px 28px', fontWeight: 700, fontSize: 15, border: 'none', cursor: 'pointer' }}>
              Create First Plan
            </button>
          </div>
        ) : filtered.length === 0 ? (
          <p style={{ color: 'rgba(255,255,255,0.3)', marginTop: 40, textAlign: 'center' }}>No patients match "{search}"</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 28 }}>
            {filtered.map(group => {
              const isOpen = expanded.has(group.patient_id);
              return (
                <div key={group.patient_id} style={{ border: `1px solid ${isOpen ? PURPLE + '60' : 'rgba(255,255,255,0.1)'}`, borderRadius: 16, overflow: 'hidden', transition: 'border-color 0.2s' }}>

                  {/* Patient header row — clickable */}
                  <button
                    onClick={() => toggleExpanded(group.patient_id)}
                    style={{
                      width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '18px 24px', background: isOpen ? `${PURPLE}12` : 'rgba(255,255,255,0.03)',
                      border: 'none', cursor: 'pointer', transition: 'background 0.2s', textAlign: 'left',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                      <div style={{ width: 40, height: 40, borderRadius: '50%', background: `${PURPLE}25`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0 }}>
                        🏋️
                      </div>
                      <div>
                        <p style={{ margin: 0, fontWeight: 700, fontSize: 16, color: isOpen ? '#fff' : 'rgba(255,255,255,0.9)' }}>
                          {group.patientName}
                        </p>
                        <p style={{ margin: 0, fontSize: 13, color: 'rgba(255,255,255,0.4)', marginTop: 2 }}>
                          {group.plans.length} plan{group.plans.length !== 1 ? 's' : ''}
                        </p>
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <button
                        onClick={e => { e.stopPropagation(); router.push(`/patients/${group.patient_id}`); }}
                        style={{ background: `${PURPLE}20`, color: PURPLE, border: `1px solid ${PURPLE}40`, borderRadius: 8, padding: '6px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
                      >
                        View Progress
                      </button>
                      <button
                        onClick={e => { e.stopPropagation(); router.push(`/plans/new?patient=${group.patient_id}`); }}
                        style={{ background: `${TEAL}20`, color: TEAL, border: `1px solid ${TEAL}40`, borderRadius: 8, padding: '6px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
                      >
                        + Add Plan
                      </button>
                      <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 18, transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s', display: 'inline-block' }}>
                        ▾
                      </span>
                    </div>
                  </button>

                  {/* Plans for this patient */}
                  {isOpen && (
                    <div style={{ borderTop: `1px solid rgba(255,255,255,0.07)`, padding: '16px 24px', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
                      {group.plans.map(plan => (
                        <div key={plan.id} style={{ background: 'rgba(255,255,255,0.04)', border: `1px solid ${PURPLE}25`, borderRadius: 12, padding: 18, display: 'flex', flexDirection: 'column', gap: 10 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                            <h3 style={{ fontWeight: 700, fontSize: 15, margin: 0 }}>{plan.name}</h3>
                            <span style={{ background: `${TEAL}20`, color: TEAL, fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 999, whiteSpace: 'nowrap', flexShrink: 0 }}>
                              {plan.exerciseCount} ex
                            </span>
                          </div>
                          {plan.description && (
                            <p style={{ color: 'rgba(255,255,255,0.45)', fontSize: 13, margin: 0 }}>{plan.description}</p>
                          )}
                          <p style={{ color: 'rgba(255,255,255,0.3)', fontSize: 12, margin: 0 }}>
                            {new Date(plan.created_at).toLocaleDateString('en-CA')}
                          </p>
                          <div style={{ display: 'flex', gap: 8 }}>
                            <button
                              onClick={() => router.push(`/plans/new?edit=${plan.id}`)}
                              style={{ flex: 1, background: `${TEAL}20`, color: TEAL, borderRadius: 8, padding: '8px 0', fontWeight: 700, fontSize: 12, border: `1px solid ${TEAL}40`, cursor: 'pointer' }}
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => handleDelete(plan.id)}
                              disabled={deleting === plan.id}
                              style={{ flex: 1, background: 'rgba(239,68,68,0.1)', color: '#EF4444', borderRadius: 8, padding: '8px 0', fontWeight: 700, fontSize: 12, border: '1px solid rgba(239,68,68,0.3)', cursor: 'pointer', opacity: deleting === plan.id ? 0.5 : 1 }}
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
      </main>
    </div>
  );
}
