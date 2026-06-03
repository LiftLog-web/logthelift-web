'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getSupabase } from '@/lib/supabase';
import { Sk, SkPage, SkNav } from '@/components/Skeleton';

const TEAL   = '#5fcfbf';
const PURPLE = '#C471ED';
const YELLOW = '#F9F295';

interface PlanSet {
  reps?: number;
  weight?: number;
  seconds?: number;
  minutes?: number;
  rest?: number;
}

interface PlanExercise {
  id: string;
  exercise: {
    id: string;
    name: string;
    muscleGroup: string;
    equipment: string;
    type: 'weighted' | 'duration' | 'cardio';
  };
  sets: PlanSet[];
  targetSets: number;
  notes: string;
}

interface Plan {
  id: string;
  name: string;
  description: string | null;
  exercises: any;
  created_at: string;
  practitionerName: string;
}

function setLabel(s: PlanSet, type: string): string {
  if (type === 'cardio')   return `${s.minutes ?? '?'} min${s.rest ? ` · ${s.rest} min rest` : ''}`;
  if (type === 'duration') return `${s.seconds ?? '?'}s${s.rest ? ` · ${s.rest} min rest` : ''}`;
  const parts = [];
  if (s.reps)   parts.push(`${s.reps} reps`);
  if (s.weight) parts.push(`${s.weight} kg`);
  if (s.rest)   parts.push(`${s.rest} min rest`);
  return parts.join(' · ') || '—';
}

const TYPE_COLOR: Record<string, string> = {
  weighted: TEAL,
  duration: PURPLE,
  cardio:   YELLOW,
};
const TYPE_BG_CSS:   Record<string, string> = { weighted: 'var(--badge-teal-bg)',   duration: 'var(--badge-purple-bg)',   cardio: 'var(--badge-yellow-bg)'   };
const TYPE_TEXT_CSS: Record<string, string> = { weighted: 'var(--badge-teal-text)', duration: 'var(--badge-purple-text)', cardio: 'var(--badge-yellow-text)' };

function ExerciseCard({ pe, idx }: { pe: PlanExercise; idx: number }) {
  return (
    <div style={{ background: 'var(--card)', border: '1px solid var(--border-subtle)', borderRadius: 12, padding: '16px 18px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: pe.notes ? 10 : 12 }}>
        <span style={{ color: 'var(--text-dim)', fontSize: 13, flexShrink: 0 }}>{idx + 1}.</span>
        <span style={{ fontWeight: 700, fontSize: 15, flex: 1 }}>{pe.exercise.name}</span>
        <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 999, background: TYPE_BG_CSS[pe.exercise.type], color: TYPE_TEXT_CSS[pe.exercise.type] }}>
          {pe.exercise.type}
        </span>
        <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>
          {pe.exercise.muscleGroup} · {pe.exercise.equipment}
        </span>
      </div>
      {pe.notes?.trim() && (
        <div style={{ background: 'var(--badge-purple-bg)', border: '1px solid var(--btn-purple-border)', borderRadius: 8, padding: '8px 12px', marginBottom: 12, fontSize: 13, color: 'var(--text-muted)' }}>
          PT note: {pe.notes}
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {pe.sets.map((s, si) => (
          <div key={si} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 12, color: 'var(--text-dim)', width: 44, flexShrink: 0 }}>Set {si + 1}</span>
            <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>{setLabel(s, pe.exercise.type)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function MyPlansPage() {
  const router = useRouter();

  const [authed,   setAuthed]   = useState(false);
  const [plans,    setPlans]    = useState<Plan[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    const sb = getSupabase();
    sb.auth.getSession().then(async ({ data }) => {
      if (!data.session) { router.push('/login'); return; }
      const uid = data.session.user.id;

      const { data: prof } = await sb.from('profiles').select('role').eq('id', uid).single();
      if (prof?.role !== 'patient') { router.push('/profile'); return; }

      const { data: rawPlans } = await sb
        .from('workout_plans')
        .select('id, name, description, exercises, created_at, practitioner:practitioner_id(display_name)')
        .eq('patient_id', uid)
        .order('created_at', { ascending: false });

      const mapped: Plan[] = (rawPlans ?? []).map((p: any) => {
        const pract = Array.isArray(p.practitioner) ? p.practitioner[0] : p.practitioner;
        return {
          id: p.id,
          name: p.name,
          description: p.description,
          exercises: p.exercises ?? [],
          created_at: p.created_at,
          practitionerName: pract?.display_name ?? 'Your Practitioner',
        };
      });

      setPlans(mapped);
      setAuthed(true);
      setLoading(false);
    });
  }, [router]);

  const toggle = (id: string) =>
    setExpanded(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  if (loading || !authed) {
    return (
      <SkPage>
        <SkNav />
        <main style={{ maxWidth: 800, margin: '0 auto', padding: '32px 24px' }}>
          <Sk width={160} height={26} radius={6} style={{ marginBottom: 24 }} />
          {[0,1,2].map(i => (
            <div key={i} style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16, padding: '20px 24px', marginBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
                <Sk width={160} height={15} />
                <Sk width={80} height={22} radius={999} style={{ marginLeft: 'auto' }} />
                <Sk width={22} height={22} radius={6} />
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <Sk width={70} height={22} radius={999} />
                <Sk width={80} height={22} radius={999} />
              </div>
            </div>
          ))}
        </main>
      </SkPage>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', color: 'var(--text)', fontFamily: 'sans-serif' }}>

      {/* Nav */}
      <nav style={{ borderBottom: '1px solid var(--border)', padding: '16px 32px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', maxWidth: 900, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <a href="/profile" style={{ color: TEAL, fontWeight: 800, fontSize: 20, textDecoration: 'none' }}>LiftLog</a>
          <span style={{ color: 'var(--text-dim)', fontSize: 14 }}>/ My Plans</span>
        </div>
        <a href="/log" style={{ background: TEAL, color: '#0f1117', borderRadius: 10, padding: '8px 18px', fontSize: 13, fontWeight: 700, textDecoration: 'none' }}>
          + Log Workout
        </a>
      </nav>

      <main style={{ maxWidth: 900, margin: '0 auto', padding: '40px 32px' }}>

        <h1 style={{ fontSize: 24, fontWeight: 800, margin: '0 0 6px' }}>My Plans</h1>
        <p style={{ color: 'var(--text-muted)', fontSize: 14, margin: '0 0 32px' }}>
          Workout plans assigned by your practitioner.
        </p>

        {plans.length === 0 ? (
          <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 20, padding: 60, textAlign: 'center' }}>
            <p style={{ fontSize: 40, marginBottom: 12 }}>📋</p>
            <p style={{ color: 'var(--text-muted)', marginBottom: 8 }}>No plans assigned yet.</p>
            <p style={{ color: 'var(--text-faint)', fontSize: 13 }}>Your practitioner will assign plans to you through the LiftLog app.</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {plans.map(plan => {
              const isOpen = expanded.has(plan.id);
              const isNewFormat = plan.exercises && !Array.isArray(plan.exercises) && plan.exercises.days;
              const flatExercises: PlanExercise[] = isNewFormat ? [] : (Array.isArray(plan.exercises) ? plan.exercises : []);
              const days: { id: string; label: string; exercises: PlanExercise[] }[] = isNewFormat ? plan.exercises.days : [];
              const totalExercises = isNewFormat
                ? days.reduce((n: number, d: any) => n + d.exercises.length, 0)
                : flatExercises.length;

              return (
                <div key={plan.id} style={{ border: `1px solid ${isOpen ? PURPLE + '60' : 'var(--border)'}`, borderRadius: 16, overflow: 'hidden', transition: 'border-color 0.2s' }}>

                  {/* Plan header */}
                  <button
                    onClick={() => toggle(plan.id)}
                    style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 16, padding: '20px 24px', background: isOpen ? `${PURPLE}0d` : 'var(--card)', border: 'none', cursor: 'pointer', textAlign: 'left' }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>{plan.name}</div>
                      <div style={{ fontSize: 13, color: 'var(--text-muted)', display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                        <span>From: {plan.practitionerName}</span>
                        {isNewFormat && (
                          <span style={{ fontWeight: 700, color: TEAL }}>{plan.exercises.frequencyPerWeek}x / week · {days.length} day{days.length !== 1 ? 's' : ''}</span>
                        )}
                        <span>{totalExercises} exercise{totalExercises !== 1 ? 's' : ''}</span>
                        {plan.description && <span style={{ color: 'var(--text-dim)' }}>{plan.description}</span>}
                      </div>
                    </div>

                    <a
                      href={`/log?planId=${plan.id}`}
                      onClick={e => e.stopPropagation()}
                      style={{ background: TEAL, color: '#0f1117', borderRadius: 10, padding: '8px 18px', fontSize: 13, fontWeight: 700, textDecoration: 'none', whiteSpace: 'nowrap', flexShrink: 0 }}
                    >
                      Start Workout
                    </a>

                    <span style={{ color: 'var(--text-dim)', fontSize: 14, transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s', display: 'inline-block', flexShrink: 0 }}>▾</span>
                  </button>

                  {/* Plan detail */}
                  {isOpen && (
                    <div style={{ borderTop: '1px solid var(--border-subtle)', padding: '20px 24px' }}>
                      {isNewFormat ? (
                        /* New multi-day format */
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                          {days.map((day: any) => (
                            <div key={day.id}>
                              <div style={{ fontWeight: 700, fontSize: 14, color: TEAL, marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{day.label}</div>
                              {day.exercises.length === 0 ? (
                                <p style={{ color: 'var(--text-dim)', fontSize: 13 }}>No exercises for this day.</p>
                              ) : (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                                  {day.exercises.map((pe: PlanExercise, idx: number) => (
                                    <ExerciseCard key={pe.id} pe={pe} idx={idx} />
                                  ))}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      ) : (
                        /* Old flat format */
                        flatExercises.length === 0 ? (
                          <p style={{ color: 'var(--text-dim)', fontSize: 14 }}>No exercises in this plan.</p>
                        ) : (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                            {flatExercises.map((pe, idx) => (
                              <ExerciseCard key={pe.id} pe={pe} idx={idx} />
                            ))}
                          </div>
                        )
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
