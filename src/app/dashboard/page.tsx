'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState } from 'react';
import { getSupabase } from '@/lib/supabase';
import { Sk, SkPage, SHIMMER_CSS } from '@/components/Skeleton';

const TEAL   = '#5fcfbf';
const PURPLE = '#C471ED';
const YELLOW = '#F9F295';

type AuthState = 'loading' | 'login' | 'not_owner' | 'ready';

interface GymProfile {
  id: string;
  gym_name: string;
  address: string;
  tier: string;
  max_pts: number;
}

interface Subscription {
  status: string;
  trial_end: string | null;
}

interface WeekAdherence {
  weekStart: string;
  logged: number;
  prescribed: number;
  pct: number;
}

interface PTRow {
  id: string;
  pt_id: string;
  status: 'pending' | 'accepted' | 'declined';
  invited_at: string;
  responded_at: string | null;
  ptName: string;
  ptEmail: string;
  patientCount: number;
  avgSatisfaction: number | null;
  satisfactionCount: number;
  plansCreated: number;
  adherencePct: number | null;
  weeklyTarget: number | null;
  weeklyAdherence: WeekAdherence[];
  lastActive: string | null;
}

const TIER_LABELS: Record<string, string> = {
  per_pt: 'Per PT',
  starter: 'Starter',
  mid: 'Mid-Size',
  large: 'Large',
};

function renderStars(rating: number): string {
  const full  = Math.floor(rating);
  const half  = rating - full >= 0.5 ? 1 : 0;
  const empty = 5 - full - half;
  return '★'.repeat(full) + (half ? '½' : '') + '☆'.repeat(empty);
}

function getMondayOfWeek(d: Date): Date {
  const day = d.getDay();
  const diff = day === 0 ? 6 : day - 1;
  const monday = new Date(d);
  monday.setHours(0, 0, 0, 0);
  monday.setDate(d.getDate() - diff);
  return monday;
}

function getMondayOfCurrentWeek(): Date {
  return getMondayOfWeek(new Date());
}

function toDateStr(d: Date): string {
  return d.toISOString().split('T')[0];
}

function statusBadge(status: string) {
  const styles: Record<string, { bg: string; color: string; label: string }> = {
    accepted: { bg: `${TEAL}22`, color: TEAL,   label: 'Active'   },
    pending:  { bg: `${YELLOW}22`, color: YELLOW, label: 'Pending' },
    declined: { bg: '#EF444422',   color: '#EF4444', label: 'Declined' },
  };
  const s = styles[status] ?? styles.pending;
  return (
    <span style={{ background: s.bg, color: s.color, padding: '3px 10px', borderRadius: 999, fontSize: 12, fontWeight: 700 }}>
      {s.label}
    </span>
  );
}

export default function DashboardPage() {
  const [authState, setAuthState]   = useState<AuthState>('loading');
  const [email, setEmail]           = useState('');
  const [password, setPassword]     = useState('');
  const [loginError, setLoginError] = useState('');
  const [logging, setLogging]       = useState(false);

  const [gym, setGym]               = useState<GymProfile | null>(null);
  const [sub, setSub]               = useState<Subscription | null>(null);
  const [pts, setPts]               = useState<PTRow[]>([]);
  const [loadingData, setLoadingData] = useState(false);
  const [targetEdits, setTargetEdits]   = useState<Record<string, string>>({});
  const [savingTarget, setSavingTarget] = useState<Record<string, boolean>>({});
  const [expandedPtId, setExpandedPtId] = useState<string | null>(null);

  useEffect(() => {
    getSupabase().auth.getSession().then(({ data }) => {
      if (data.session) {
        loadDashboard(data.session.user.id);
      } else {
        setAuthState('login');
      }
    });
  }, []);

  const loadDashboard = async (userId: string) => {
    setLoadingData(true);

    // Check gym owner flag
    const { data: profile } = await getSupabase()
      .from('profiles')
      .select('is_gym_owner')
      .eq('id', userId)
      .single();

    if (!profile?.is_gym_owner) {
      setAuthState('not_owner');
      setLoadingData(false);
      return;
    }

    // Get gym profile
    const { data: gymData } = await getSupabase()
      .from('gym_profiles')
      .select('id, gym_name, address, tier, max_pts')
      .eq('owner_id', userId)
      .single();

    if (!gymData) {
      setAuthState('not_owner');
      setLoadingData(false);
      return;
    }
    setGym(gymData);

    // Get subscription
    const { data: subData } = await getSupabase()
      .from('gym_subscriptions')
      .select('status, trial_end')
      .eq('gym_id', gymData.id)
      .single();
    setSub(subData ?? null);

    // Get PT links with PT profiles
    const { data: links } = await getSupabase()
      .from('gym_pt_links')
      .select('id, pt_id, status, invited_at, responded_at, weekly_workout_target, pt:pt_id(display_name, email)')
      .eq('gym_id', gymData.id)
      .order('invited_at', { ascending: false });

    if (!links) {
      setPts([]);
      setAuthState('ready');
      setLoadingData(false);
      return;
    }

    // For each accepted PT, fetch patient count + avg satisfaction
    const ptRows: PTRow[] = await Promise.all(
      links.map(async (link: any) => {
        const pt = Array.isArray(link.pt) ? link.pt[0] : link.pt;
        const base: PTRow = {
          id: link.id,
          pt_id: link.pt_id,
          status: link.status,
          invited_at: link.invited_at,
          responded_at: link.responded_at,
          ptName: pt?.display_name ?? 'Unknown',
          ptEmail: pt?.email ?? '',
          patientCount: 0,
          avgSatisfaction: null,
          satisfactionCount: 0,
          plansCreated: 0,
          adherencePct: null,
          weeklyTarget: link.weekly_workout_target ?? null,
          weeklyAdherence: [],
          lastActive: null,
        };

        if (link.status !== 'accepted') return base;

        // Run all accepted-PT queries in parallel
        const [patientLinksRes, plansRes] = await Promise.all([
          getSupabase().from('patient_links').select('patient_id').eq('practitioner_id', link.pt_id),
          getSupabase().from('workout_plans').select('created_at').eq('practitioner_id', link.pt_id).order('created_at', { ascending: false }),
        ]);

        const patientIds = (patientLinksRes.data ?? []).map((p: any) => p.patient_id);
        base.patientCount = patientIds.length;

        const plans = plansRes.data ?? [];
        base.plansCreated = plans.length;
        base.lastActive   = plans[0]?.created_at ?? null;

        // Satisfaction ratings + adherence from synced_workouts
        if (patientIds.length > 0) {
          const { data: workouts } = await getSupabase()
            .from('synced_workouts')
            .select('user_id, date, data')
            .in('user_id', patientIds);

          if (workouts && workouts.length > 0) {
            // Avg satisfaction (all-time)
            const ratings = workouts
              .map((w: any) => w.data?.satisfactionRating)
              .filter((r: any) => typeof r === 'number' && r >= 1 && r <= 5);
            if (ratings.length > 0) {
              base.avgSatisfaction   = ratings.reduce((a: number, b: number) => a + b, 0) / ratings.length;
              base.satisfactionCount = ratings.length;
            }

            // Adherence: all complete weeks, current week excluded
            const cwStr = toDateStr(getMondayOfCurrentWeek());
            const completedWorkouts = workouts.filter((w: any) => w.date < cwStr);

            if (base.weeklyTarget !== null && base.weeklyTarget > 0) {
              const prescribed = patientIds.length * base.weeklyTarget;
              // Group by week (Monday)
              const byWeek: Record<string, number> = {};
              for (const w of completedWorkouts) {
                const monday = toDateStr(getMondayOfWeek(new Date(w.date + 'T00:00:00')));
                byWeek[monday] = (byWeek[monday] ?? 0) + 1;
              }
              const weeks = Object.keys(byWeek).sort();
              base.weeklyAdherence = weeks.map(weekStart => {
                const logged = byWeek[weekStart];
                const pct = Math.min(100, Math.round((logged / prescribed) * 100));
                return { weekStart, logged, prescribed, pct };
              });
              if (weeks.length > 0) {
                const totalPrescribed = prescribed * weeks.length;
                base.adherencePct = Math.min(100, Math.round((completedWorkouts.length / totalPrescribed) * 100));
              } else {
                base.adherencePct = 0;
              }
            } else {
              base.adherencePct = null;
            }
          } else {
            base.adherencePct = base.weeklyTarget !== null ? 0 : null;
            base.weeklyAdherence = [];
          }
        }

        return base;
      })
    );

    setPts(ptRows);
    setAuthState('ready');
    setLoadingData(false);
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLogging(true);
    setLoginError('');
    const { data, error } = await getSupabase().auth.signInWithPassword({ email, password });
    if (error || !data.user) {
      setLoginError('Invalid email or password.');
      setLogging(false);
      return;
    }
    await loadDashboard(data.user.id);
    setLogging(false);
  };

  const handleLogout = async () => {
    await getSupabase().auth.signOut();
    setAuthState('login');
    setGym(null);
    setPts([]);
  };

  const saveTarget = async (ptLinkId: string, rawValue: string) => {
    const trimmed = rawValue.trim();
    const parsed  = trimmed === '' ? null : parseInt(trimmed, 10);
    if (trimmed !== '' && (isNaN(parsed!) || parsed! < 1 || parsed! > 99)) return;
    setSavingTarget(s => ({ ...s, [ptLinkId]: true }));
    await getSupabase().from('gym_pt_links').update({ weekly_workout_target: parsed }).eq('id', ptLinkId);
    setPts(prev => prev.map(p => p.id === ptLinkId ? { ...p, weeklyTarget: parsed } : p));
    setTargetEdits(s => { const n = { ...s }; delete n[ptLinkId]; return n; });
    setSavingTarget(s => ({ ...s, [ptLinkId]: false }));
  };

  const activePTs  = pts.filter(p => p.status === 'accepted').length;
  const pendingPTs = pts.filter(p => p.status === 'pending').length;

  /* ── Loading skeleton ── */
  if (authState === 'loading') {
    return (
      <SkPage>

        {/* Nav */}
        <nav style={{ borderBottom: '1px solid var(--border)', padding: '16px 32px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', maxWidth: 1200, margin: '0 auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ color: TEAL, fontWeight: 800, fontSize: 20 }}>LiftLog</span>
            <Sk width={130} height={14} radius={4} />
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <Sk width={72} height={30} radius={8} />
            <Sk width={84} height={30} radius={8} />
            <Sk width={80} height={30} radius={8} />
          </div>
        </nav>

        <main style={{ maxWidth: 1200, margin: '0 auto', padding: '40px 32px' }}>
          {/* Gym name */}
          <div style={{ marginBottom: 40 }}>
            <Sk width={260} height={34} radius={8} style={{ marginBottom: 10 }} />
            <Sk width={150} height={15} radius={5} />
          </div>

          {/* Stat cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, marginBottom: 40 }}>
            {[0,1,2,3].map(i => (
              <div key={i} style={{ background: 'var(--card)', border: '1px solid var(--border-subtle)', borderRadius: 16, padding: '20px 24px' }}>
                <Sk width={90} height={11} radius={3} style={{ marginBottom: 14 }} />
                <Sk width={70} height={30} radius={6} />
              </div>
            ))}
          </div>

          {/* PT Roster */}
          <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 20, overflow: 'hidden' }}>
            <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border-subtle)' }}>
              <Sk width={90} height={18} radius={5} />
            </div>
            <div style={{ padding: '0 20px' }}>
              {[0,1,2].map(i => <SkeletonRow key={i} first={i === 0} />)}
            </div>
          </div>
        </main>
      </SkPage>
    );
  }

  /* ── Login ── */
  if (authState === 'login') {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <div style={{ width: '100%', maxWidth: 400, background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 24, padding: 40 }}>
          <p style={{ color: TEAL, fontSize: 24, fontWeight: 800, marginBottom: 8 }}>LiftLog</p>
          <h1 style={{ color: 'var(--text)', fontSize: 20, fontWeight: 700, marginBottom: 4 }}>Gym Owner Dashboard</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: 14, marginBottom: 32 }}>Sign in with your LiftLog gym owner account</p>
          <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <input
              type="email"
              placeholder="Email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              style={{ background: 'var(--input-bg)', border: '1px solid var(--border-strong)', borderRadius: 12, padding: '12px 16px', color: 'var(--text)', fontSize: 15, outline: 'none' }}
            />
            <input
              type="password"
              placeholder="Password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              style={{ background: 'var(--input-bg)', border: '1px solid var(--border-strong)', borderRadius: 12, padding: '12px 16px', color: 'var(--text)', fontSize: 15, outline: 'none' }}
            />
            {loginError && <p style={{ color: '#EF4444', fontSize: 13 }}>{loginError}</p>}
            <button
              type="submit"
              disabled={logging}
              style={{ background: TEAL, color: '#0f1117', borderRadius: 12, padding: '13px 0', fontWeight: 700, fontSize: 15, border: 'none', cursor: logging ? 'not-allowed' : 'pointer', opacity: logging ? 0.7 : 1 }}
            >
              {logging ? 'Signing in…' : 'Sign In'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  /* ── Not a gym owner ── */
  if (authState === 'not_owner') {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <div style={{ textAlign: 'center', maxWidth: 400 }}>
          <p style={{ fontSize: 48, marginBottom: 16 }}>⚠️</p>
          <h1 style={{ color: 'var(--text)', fontSize: 22, fontWeight: 700, marginBottom: 8 }}>Not a gym owner account</h1>
          <p style={{ color: 'var(--text-muted)', marginBottom: 24 }}>This dashboard is only accessible to approved gym owner accounts.</p>
          <button onClick={handleLogout} style={{ background: TEAL, color: '#0f1117', borderRadius: 12, padding: '12px 24px', fontWeight: 700, border: 'none', cursor: 'pointer' }}>
            Sign Out
          </button>
        </div>
      </div>
    );
  }

  /* ── Dashboard ── */
  const tierLabel = TIER_LABELS[gym?.tier ?? ''] ?? gym?.tier ?? '—';
  const subStatus = sub?.status ?? '—';
  const trialEnd  = sub?.trial_end ? new Date(sub.trial_end).toLocaleDateString('en-CA') : null;

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', color: 'var(--text)', fontFamily: 'sans-serif' }}>

      {/* Nav */}
      <nav style={{ borderBottom: '1px solid var(--border)', padding: '16px 32px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', maxWidth: 1200, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ color: TEAL, fontWeight: 800, fontSize: 20 }}>LiftLog</span>
          <span style={{ color: 'var(--text-dim)', fontSize: 14 }}>/ Gym Dashboard</span>
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <a href="/plans" style={{ color: 'var(--text-muted)', fontSize: 14, textDecoration: 'none', padding: '8px 16px' }}>My Plans</a>
          <a href="/import-pts" style={{ color: 'var(--text-muted)', fontSize: 14, textDecoration: 'none', padding: '8px 16px' }}>Import PTs</a>
          <button onClick={handleLogout} style={{ background: 'var(--input-bg)', border: '1px solid var(--border-strong)', color: 'var(--text-muted)', borderRadius: 10, padding: '8px 16px', fontSize: 13, cursor: 'pointer' }}>
            Sign Out
          </button>
        </div>
      </nav>

      <main style={{ maxWidth: 1200, margin: '0 auto', padding: '40px 32px' }}>

        {/* Gym header */}
        <div style={{ marginBottom: 40 }}>
          <h1 style={{ fontSize: 32, fontWeight: 800, marginBottom: 4 }}>{gym?.gym_name}</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: 15 }}>{gym?.address}</p>
        </div>

        {/* Stats cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, marginBottom: 40 }}>
          <StatCard label="Active PTs" value={`${activePTs} / ${gym?.max_pts ?? '—'}`} color={TEAL} />
          <StatCard label="Pending Invites" value={String(pendingPTs)} color={YELLOW} />
          <StatCard label="Plan" value={tierLabel} color={PURPLE} />
          <StatCard
            label="Subscription"
            value={subStatus.charAt(0).toUpperCase() + subStatus.slice(1)}
            sub={trialEnd ? `Trial ends ${trialEnd}` : undefined}
            color={subStatus === 'active' ? TEAL : YELLOW}
          />
        </div>

        {/* PT roster */}
        <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 20, overflow: 'hidden' }}>
          <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border-subtle)' }}>
            <h2 style={{ fontWeight: 700, fontSize: 18, margin: 0 }}>PT Roster</h2>
          </div>

          {loadingData ? (
            <div style={{ padding: '0 20px' }}>
              <style>{SHIMMER_CSS}</style>
              {[0,1,2].map(i => <SkeletonRow key={i} first={i === 0} />)}
            </div>
          ) : pts.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-dim)' }}>
              No PTs invited yet. Use the LiftLog app to invite PTs to your gym.
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ color: 'var(--text)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid var(--border-subtle)' }}>
                  <th style={{ padding: '10px 20px', textAlign: 'left',   fontWeight: 600 }}>PT</th>
                  <th style={{ padding: '10px 14px', textAlign: 'center', fontWeight: 600 }}>Status</th>
                  <th style={{ padding: '10px 14px', textAlign: 'center', fontWeight: 600 }}>Patients</th>
                  <th style={{ padding: '10px 14px', textAlign: 'center', fontWeight: 600 }}>Plans</th>
                  <th style={{ padding: '10px 14px', textAlign: 'center', fontWeight: 600, cursor: 'help', whiteSpace: 'nowrap' }}
                      title="Overall workout adherence · completed workouts ÷ prescribed workouts · all time, current week excluded">
                    Logged Workouts ℹ
                  </th>
                  <th style={{ padding: '10px 14px', textAlign: 'center', fontWeight: 600 }}>Satisfaction</th>
                  <th style={{ padding: '10px 14px', textAlign: 'center', fontWeight: 600, whiteSpace: 'nowrap' }}>Last Active</th>
                </tr>
              </thead>
              <tbody>
                {pts.map((pt, i) => (
                  <tr key={pt.id} style={{ borderTop: '1px solid var(--border-subtle)', background: i % 2 === 0 ? 'transparent' : 'var(--card)' }}>

                    {/* PT name + email */}
                    <td style={{ padding: '14px 20px' }}>
                      <div style={{ fontWeight: 700, fontSize: 14 }}>{pt.ptName}</div>
                      <div style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 2 }}>{pt.ptEmail}</div>
                    </td>

                    {/* Status */}
                    <td style={{ padding: '14px 14px', textAlign: 'center' }}>{statusBadge(pt.status)}</td>

                    {/* Patients */}
                    <td style={{ padding: '14px 14px', textAlign: 'center', fontWeight: 600, color: pt.patientCount > 0 ? 'var(--text)' : 'var(--text-dim)' }}>
                      {pt.status === 'accepted' ? pt.patientCount : '—'}
                    </td>

                    {/* Plans Created */}
                    <td style={{ padding: '14px 14px', textAlign: 'center', fontWeight: 600, color: pt.plansCreated > 0 ? 'var(--text)' : 'var(--text-dim)' }}>
                      {pt.status === 'accepted' ? pt.plansCreated : '—'}
                    </td>

                    {/* Logged Workouts % */}
                    <td style={{ padding: '14px 14px', textAlign: 'center' }}>
                      {pt.status === 'accepted' ? (
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5 }}>
                          {pt.weeklyTarget !== null && pt.adherencePct !== null ? (
                            <>
                              {/* Overall snapshot */}
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, justifyContent: 'center' }}>
                                <div style={{ width: 40, height: 5, background: 'var(--border)', borderRadius: 999, overflow: 'hidden', flexShrink: 0 }}>
                                  <div style={{ height: '100%', width: `${pt.adherencePct}%`, background: pt.adherencePct >= 80 ? TEAL : pt.adherencePct >= 50 ? YELLOW : '#EF4444', borderRadius: 999 }} />
                                </div>
                                <span style={{ color: pt.adherencePct >= 80 ? TEAL : pt.adherencePct >= 50 ? YELLOW : '#EF4444', fontWeight: 700 }}>
                                  {pt.adherencePct}%
                                </span>
                              </span>
                              {/* Weekly breakdown toggle */}
                              {pt.weeklyAdherence.length > 0 && (
                                <button
                                  onClick={() => setExpandedPtId(expandedPtId === pt.id ? null : pt.id)}
                                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 11, textDecoration: 'underline', padding: 0 }}
                                >
                                  {expandedPtId === pt.id ? 'Hide weeks ▲' : 'Weekly breakdown ▼'}
                                </button>
                              )}
                              {/* Per-week breakdown table */}
                              {expandedPtId === pt.id && (
                                <div style={{ marginTop: 4, background: 'var(--card-alt)', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden', width: 190 }}>
                                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                                    <thead>
                                      <tr style={{ borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-muted)' }}>
                                        <th style={{ padding: '4px 8px', textAlign: 'left', fontWeight: 600 }}>Week of</th>
                                        <th style={{ padding: '4px 8px', textAlign: 'center', fontWeight: 600 }}>Done/Goal</th>
                                        <th style={{ padding: '4px 8px', textAlign: 'center', fontWeight: 600 }}>Rate</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {pt.weeklyAdherence.slice().reverse().map(w => (
                                        <tr key={w.weekStart} style={{ borderTop: '1px solid var(--border-subtle)' }}>
                                          <td style={{ padding: '4px 8px', color: 'var(--text-muted)' }}>
                                            {new Date(w.weekStart + 'T00:00:00').toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })}
                                          </td>
                                          <td style={{ padding: '4px 8px', textAlign: 'center', color: 'var(--text)' }}>
                                            {w.logged}/{w.prescribed}
                                          </td>
                                          <td style={{ padding: '4px 8px', textAlign: 'center', fontWeight: 700, color: w.pct >= 80 ? TEAL : w.pct >= 50 ? YELLOW : '#EF4444' }}>
                                            {w.pct}%
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              )}
                            </>
                          ) : pt.weeklyTarget === null ? (
                            <span style={{ color: 'var(--text-faint)', fontSize: 11 }}>set target below</span>
                          ) : (
                            <span style={{ color: 'var(--text-dim)', fontWeight: 700 }}>0%</span>
                          )}
                          {/* Target input */}
                          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            <span style={{ color: 'var(--text-dim)', fontSize: 11 }}>Target:</span>
                            <input
                              type="number"
                              min={1}
                              max={99}
                              placeholder="—"
                              value={targetEdits[pt.id] ?? (pt.weeklyTarget !== null ? String(pt.weeklyTarget) : '')}
                              onChange={e => setTargetEdits(s => ({ ...s, [pt.id]: e.target.value }))}
                              onBlur={e => saveTarget(pt.id, e.target.value)}
                              onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                              style={{ width: 32, background: 'var(--input-bg)', border: '1px solid var(--border-strong)', borderRadius: 6, color: 'var(--text)', fontSize: 11, textAlign: 'center', padding: '2px 4px', outline: 'none', opacity: savingTarget[pt.id] ? 0.5 : 1 }}
                            />
                            <span style={{ color: 'var(--text-dim)', fontSize: 11 }}>/wk</span>
                          </div>
                        </div>
                      ) : (
                        <span style={{ color: 'var(--text-dim)' }}>—</span>
                      )}
                    </td>

                    {/* Avg Satisfaction + sample size */}
                    <td style={{ padding: '14px 14px', textAlign: 'center' }}>
                      {pt.status === 'accepted' && pt.avgSatisfaction !== null ? (
                        <>
                          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, justifyContent: 'center' }}>
                            <span style={{ color: YELLOW, fontSize: 13 }}>{renderStars(pt.avgSatisfaction)}</span>
                            <span style={{ color: TEAL, fontWeight: 700 }}>{pt.avgSatisfaction.toFixed(1)}</span>
                            <span style={{ color: 'var(--text-dim)', fontSize: 11 }}>/5</span>
                          </div>
                          <div style={{ color: 'var(--text-dim)', fontSize: 11, marginTop: 2 }}>
                            {pt.satisfactionCount} rating{pt.satisfactionCount !== 1 ? 's' : ''}
                          </div>
                        </>
                      ) : (
                        <span style={{ color: 'var(--text-dim)' }}>—</span>
                      )}
                    </td>

                    {/* Last Active */}
                    <td style={{ padding: '14px 14px', textAlign: 'center', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                      {pt.status === 'accepted' && pt.lastActive
                        ? new Date(pt.lastActive).toLocaleDateString('en-CA')
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </main>
    </div>
  );
}

function SkeletonRow({ first }: { first: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '16px 0', borderTop: first ? 'none' : '1px solid var(--border-subtle)' }}>
      {/* PT name + email */}
      <div style={{ flex: '0 0 200px', display: 'flex', flexDirection: 'column', gap: 7 }}>
        <Sk width={140} height={13} />
        <Sk width={170} height={11} radius={4} />
      </div>
      {/* Status badge */}
      <div style={{ flex: '0 0 80px', display: 'flex', justifyContent: 'center' }}>
        <Sk width={62} height={22} radius={999} />
      </div>
      {/* Patients */}
      <div style={{ flex: '0 0 70px', display: 'flex', justifyContent: 'center' }}>
        <Sk width={24} height={14} />
      </div>
      {/* Plans */}
      <div style={{ flex: '0 0 60px', display: 'flex', justifyContent: 'center' }}>
        <Sk width={20} height={14} />
      </div>
      {/* Logged workouts */}
      <div style={{ flex: '0 0 130px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Sk width={40} height={5} radius={999} />
          <Sk width={30} height={13} radius={4} />
        </div>
        <Sk width={90} height={18} radius={6} />
      </div>
      {/* Satisfaction */}
      <div style={{ flex: '0 0 110px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
        <Sk width={90} height={13} radius={4} />
        <Sk width={50} height={11} radius={3} />
      </div>
      {/* Last active */}
      <div style={{ flex: 1, display: 'flex', justifyContent: 'center' }}>
        <Sk width={80} height={13} radius={4} />
      </div>
    </div>
  );
}

function StatCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color: string }) {
  return (
    <div style={{ background: 'var(--card)', border: `1px solid ${color}30`, borderRadius: 16, padding: '20px 24px' }}>
      <p style={{ color: 'var(--text-muted)', fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>{label}</p>
      <p style={{ color, fontSize: 28, fontWeight: 800, margin: 0 }}>{value}</p>
      {sub && <p style={{ color: 'var(--text-dim)', fontSize: 12, marginTop: 4 }}>{sub}</p>}
    </div>
  );
}
