'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { getSupabase } from '@/lib/supabase';
import { checkPractitionerAccess } from '@/lib/checkPractitionerAccess';

const TEAL   = '#1EDBA8';
const PURPLE = '#C471ED';
const GOLD   = '#F59E0B';

interface WorkoutSet {
  reps?: number; weight?: number;
  duration?: number; cardioduration?: number;
}
interface LoggedExercise {
  exercise: { name: string; muscleGroup?: string; type: string };
  sets: WorkoutSet[];
}
interface WorkoutLog {
  exercises: LoggedExercise[];
  effectivenessRating?: number;
  satisfactionRating?: number;
  enjoymentRating?: number;
  planId?: string;
}

function StarRating({ value }: { value: number | null }) {
  if (value === null) return <span style={{ color: 'var(--text-muted)' }}>—</span>;
  const full    = Math.floor(value);
  const half    = value % 1 >= 0.5;
  const empty   = 5 - full - (half ? 1 : 0);
  return (
    <span style={{ color: GOLD, fontSize: 18, letterSpacing: 2 }}>
      {'★'.repeat(full)}{half ? '⯨' : ''}{'☆'.repeat(empty)}
      <span style={{ color: 'var(--text-muted)', fontSize: 13, marginLeft: 6 }}>({value.toFixed(1)})</span>
    </span>
  );
}

function StatCard({ label, value, sub, accent, icon }: {
  label: string; value: string | number | React.ReactNode;
  sub?: string; accent?: string; icon?: string;
}) {
  return (
    <div style={{
      background: 'var(--card)',
      border: `1px solid ${accent ? `${accent}44` : 'var(--border)'}`,
      borderRadius: 16,
      padding: '24px 24px 20px',
      display: 'flex', flexDirection: 'column', gap: 8,
      boxShadow: accent ? `0 0 20px ${accent}18` : '0 2px 8px #0001',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {icon && <span style={{ fontSize: 20 }}>{icon}</span>}
        <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase' }}>{label}</span>
      </div>
      <div style={{ fontSize: 34, fontWeight: 800, color: accent ?? 'var(--text)', lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{sub}</div>}
    </div>
  );
}

function ActivityDots({ dates }: { dates: string[] }) {
  const dateSet = new Set(dates);
  const today   = new Date();
  const days: { date: string; active: boolean }[] = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(today.getTime() - i * 86400000);
    const s = d.toISOString().slice(0, 10);
    days.push({ date: s, active: dateSet.has(s) });
  }
  return (
    <div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: 12 }}>
        Activity — last 30 days
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {days.map(d => (
          <div
            key={d.date}
            title={d.date}
            style={{
              width: 18, height: 18, borderRadius: 4,
              background: d.active ? TEAL : 'var(--border)',
              opacity: d.active ? 1 : 0.4,
              transition: 'opacity 0.15s',
            }}
          />
        ))}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 10, fontSize: 12, color: 'var(--text-muted)' }}>
        <div style={{ width: 12, height: 12, borderRadius: 3, background: 'var(--border)', opacity: 0.4 }} /> No workout
        <div style={{ width: 12, height: 12, borderRadius: 3, background: TEAL, marginLeft: 8 }} /> Workout logged
      </div>
    </div>
  );
}

export default function EmployeeOverviewPage() {
  const router     = useRouter();
  const { employeeId } = useParams<{ employeeId: string }>();

  const [loading,       setLoading]       = useState(true);
  const [employeeName,  setEmployeeName]  = useState('');
  const [employeeEmail, setEmployeeEmail] = useState('');
  const [totalWorkouts,  setTotalWorkouts]  = useState(0);
  const [totalStretches, setTotalStretches] = useState(0);
  const [avgEffectiveness, setAvgEffectiveness] = useState<number | null>(null);
  const [avgEnjoyment,     setAvgEnjoyment]     = useState<number | null>(null);
  const [activityDates,    setActivityDates]     = useState<string[]>([]);
  const [assignedPlans,    setAssignedPlans]     = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    (async () => {
      const supabase = getSupabase();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.replace('/login'); return; }

      const { data: prof } = await supabase
        .from('profiles')
        .select('role, is_employer')
        .eq('id', user.id)
        .single();

      if (!prof || prof.role !== 'practitioner' || !prof.is_employer) {
        router.replace('/plans');
        return;
      }
      const hasAccess = await checkPractitionerAccess(supabase, user.id);
      if (!hasAccess) { router.push('/profile?subscription=expired'); return; }

      // Verify this employee is actually linked to this employer
      const { data: link } = await supabase
        .from('patient_links')
        .select('profiles!patient_links_patient_id_fkey(display_name, email)')
        .eq('practitioner_id', user.id)
        .eq('patient_id', employeeId)
        .single();

      if (!link) { router.replace('/plans'); return; }

      const empProfile = Array.isArray(link.profiles) ? link.profiles[0] : link.profiles;
      setEmployeeName(empProfile?.display_name ?? 'Unknown');
      setEmployeeEmail(empProfile?.email ?? '');

      // Get employer's plan IDs
      const { data: plans } = await supabase
        .from('workout_plans')
        .select('id, name')
        .eq('practitioner_id', user.id)
        .eq('patient_id', employeeId);

      const planList = plans ?? [];
      setAssignedPlans(planList.map((p: any) => ({ id: p.id, name: p.name })));
      const ptPlanIds = new Set(planList.map((p: any) => p.id as string));

      // Fetch workouts for this employee
      const { data: workouts } = await supabase
        .from('synced_workouts')
        .select('date, data')
        .eq('user_id', employeeId);

      const all = workouts ?? [];

      // Employer-plan workouts only — used for office stretches and ratings
      const employerWorkouts = all.filter((w: any) => {
        const pid = w.data?.planId;
        return pid && ptPlanIds.has(pid);
      });

      let strCount  = 0;
      const effRatings: number[] = [];
      const enjRatings: number[] = [];

      for (const w of employerWorkouts) {
        const log = w.data as WorkoutLog;
        strCount += (log.exercises ?? []).length;
        const eff = log.effectivenessRating ?? log.satisfactionRating;
        if (typeof eff === 'number' && eff > 0) effRatings.push(eff);
        if (typeof log.enjoymentRating === 'number' && log.enjoymentRating > 0) enjRatings.push(log.enjoymentRating);
      }

      // Total workouts and activity = all logged workouts (count only, no details)
      const allDates = all.map((w: any) => w.date as string);

      setTotalWorkouts(all.length);
      setTotalStretches(strCount);
      setAvgEffectiveness(effRatings.length ? effRatings.reduce((a, b) => a + b, 0) / effRatings.length : null);
      setAvgEnjoyment(enjRatings.length ? enjRatings.reduce((a, b) => a + b, 0) / enjRatings.length : null);
      setActivityDates([...new Set(allDates)]);
      setLoading(false);
    })();
  }, [router, employeeId]);

  const initials = employeeName.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ color: TEAL, fontSize: 16, fontWeight: 600 }}>Loading…</div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', color: 'var(--text)', fontFamily: 'sans-serif' }}>
      <main style={{ maxWidth: 900, margin: '0 auto', padding: '40px 32px' }}>

        {/* Back */}
        <button
          onClick={() => router.back()}
          style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 14, fontWeight: 600, padding: 0, marginBottom: 28, display: 'flex', alignItems: 'center', gap: 6 }}
        >
          ← Back
        </button>

        {/* Header */}
        <div style={{
          background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 20,
          padding: '32px 36px', marginBottom: 28, display: 'flex', alignItems: 'center', gap: 24,
        }}>
          <div style={{
            width: 72, height: 72, borderRadius: '50%', flexShrink: 0,
            background: `linear-gradient(135deg, ${TEAL}, ${PURPLE})`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#fff', fontWeight: 800, fontSize: 26,
          }}>
            {initials}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 24, fontWeight: 800, marginBottom: 4 }}>{employeeName}</div>
            <div style={{ color: 'var(--text-muted)', fontSize: 14 }}>{employeeEmail}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Assigned Plans</div>
            {assignedPlans.length === 0
              ? <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>None yet</span>
              : assignedPlans.map(p => (
                  <div key={p.id} style={{ fontSize: 13, fontWeight: 600, color: TEAL }}>{p.name}</div>
                ))}
          </div>
        </div>

        {/* Stat cards */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 28 }}>
          <StatCard label="Workouts Logged" value={totalWorkouts} sub="all activity" accent={TEAL} icon="🏃" />
          <StatCard label="Exercises Completed" value={totalStretches} sub="from employer plans" accent={PURPLE} icon="🧘" />
        </div>

        {/* Ratings */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 28 }}>
          <div style={{
            background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16,
            padding: '24px 24px 20px',
          }}>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: 12 }}>
              ⚡ Avg Effectiveness Rating
            </div>
            <StarRating value={avgEffectiveness} />
            {avgEffectiveness === null && (
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>No ratings submitted yet</div>
            )}
          </div>
          <div style={{
            background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16,
            padding: '24px 24px 20px',
          }}>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: 12 }}>
              😊 Avg Enjoyment Rating
            </div>
            <StarRating value={avgEnjoyment} />
            {avgEnjoyment === null && (
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>No ratings submitted yet</div>
            )}
          </div>
        </div>

        {/* Activity dots */}
        <div style={{
          background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16,
          padding: '24px 28px',
        }}>
          <ActivityDots dates={activityDates} />
        </div>

      </main>
    </div>
  );
}
