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

export default function PlansPage() {
  const router = useRouter();
  const [plans, setPlans]       = useState<Plan[]>([]);
  const [loading, setLoading]   = useState(true);
  const [authed, setAuthed]     = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  useEffect(() => {
    const sb = getSupabase();
    sb.auth.getSession().then(async ({ data }) => {
      if (!data.session) { router.push('/login'); return; }

      const { data: prof } = await sb.from('profiles').select('role, approved').eq('id', data.session.user.id).single();
      if (prof?.role !== 'practitioner') { router.push('/profile'); return; }
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
            onClick={() => router.push('/plans/new')}
            style={{ background: TEAL, color: '#0f1117', borderRadius: 10, padding: '8px 20px', fontWeight: 700, fontSize: 14, border: 'none', cursor: 'pointer' }}
          >
            + New Plan
          </button>
        </div>
      </nav>

      <main style={{ maxWidth: 1100, margin: '0 auto', padding: '40px 32px' }}>
        <h1 style={{ fontSize: 28, fontWeight: 800, marginBottom: 8 }}>Workout Plans</h1>
        <p style={{ color: 'rgba(255,255,255,0.4)', marginBottom: 32 }}>Create and manage plans for your patients.</p>

        {plans.length === 0 ? (
          <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 20, padding: 60, textAlign: 'center' }}>
            <p style={{ fontSize: 40, marginBottom: 16 }}>📋</p>
            <p style={{ color: 'rgba(255,255,255,0.4)', marginBottom: 24 }}>No plans yet. Create your first plan for a patient.</p>
            <button onClick={() => router.push('/plans/new')} style={{ background: TEAL, color: '#0f1117', borderRadius: 12, padding: '12px 28px', fontWeight: 700, fontSize: 15, border: 'none', cursor: 'pointer' }}>
              Create First Plan
            </button>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 16 }}>
            {plans.map(plan => (
              <div key={plan.id} style={{ background: 'rgba(255,255,255,0.04)', border: `1px solid ${PURPLE}30`, borderRadius: 16, padding: 24, display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <h3 style={{ fontWeight: 700, fontSize: 17, margin: 0 }}>{plan.name}</h3>
                  <span style={{ background: `${TEAL}20`, color: TEAL, fontSize: 12, fontWeight: 700, padding: '3px 10px', borderRadius: 999, whiteSpace: 'nowrap' }}>
                    {plan.exerciseCount} exercise{plan.exerciseCount !== 1 ? 's' : ''}
                  </span>
                </div>
                {plan.description && <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 14, margin: 0 }}>{plan.description}</p>}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 14 }}>🏋️</span>
                  <span style={{ color: PURPLE, fontSize: 14, fontWeight: 600 }}>{plan.patientName}</span>
                </div>
                <p style={{ color: 'rgba(255,255,255,0.3)', fontSize: 12, margin: 0 }}>
                  Created {new Date(plan.created_at).toLocaleDateString('en-CA')}
                </p>
                <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                  <button
                    onClick={() => router.push(`/plans/new?edit=${plan.id}`)}
                    style={{ flex: 1, background: `${TEAL}20`, color: TEAL, borderRadius: 10, padding: '9px 0', fontWeight: 700, fontSize: 13, border: `1px solid ${TEAL}40`, cursor: 'pointer' }}
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => handleDelete(plan.id)}
                    disabled={deleting === plan.id}
                    style={{ flex: 1, background: 'rgba(239,68,68,0.1)', color: '#EF4444', borderRadius: 10, padding: '9px 0', fontWeight: 700, fontSize: 13, border: '1px solid rgba(239,68,68,0.3)', cursor: 'pointer', opacity: deleting === plan.id ? 0.5 : 1 }}
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
