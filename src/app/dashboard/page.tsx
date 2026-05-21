'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState } from 'react';
import { getSupabase } from '@/lib/supabase';

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
      .select('id, pt_id, status, invited_at, responded_at, pt:pt_id(display_name, email)')
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
        };

        if (link.status !== 'accepted') return base;

        // Patient count
        const { data: patientLinks } = await getSupabase()
          .from('patient_links')
          .select('patient_id')
          .eq('practitioner_id', link.pt_id);

        const patientIds = (patientLinks ?? []).map((p: any) => p.patient_id);
        base.patientCount = patientIds.length;

        // Satisfaction ratings from synced_workouts
        if (patientIds.length > 0) {
          const { data: workouts } = await getSupabase()
            .from('synced_workouts')
            .select('data')
            .in('user_id', patientIds);

          if (workouts && workouts.length > 0) {
            const ratings = workouts
              .map((w: any) => w.data?.satisfactionRating)
              .filter((r: any) => typeof r === 'number' && r >= 1 && r <= 5);
            if (ratings.length > 0) {
              base.avgSatisfaction = ratings.reduce((a: number, b: number) => a + b, 0) / ratings.length;
            }
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

  const activePTs  = pts.filter(p => p.status === 'accepted').length;
  const pendingPTs = pts.filter(p => p.status === 'pending').length;

  /* ── Loading ── */
  if (authState === 'loading') {
    return (
      <div style={{ minHeight: '100vh', background: '#0f1117', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ width: 32, height: 32, border: `3px solid ${TEAL}`, borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  /* ── Login ── */
  if (authState === 'login') {
    return (
      <div style={{ minHeight: '100vh', background: '#0f1117', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <div style={{ width: '100%', maxWidth: 400, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 24, padding: 40 }}>
          <p style={{ color: TEAL, fontSize: 24, fontWeight: 800, marginBottom: 8 }}>LiftLog</p>
          <h1 style={{ color: '#fff', fontSize: 20, fontWeight: 700, marginBottom: 4 }}>Gym Owner Dashboard</h1>
          <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 14, marginBottom: 32 }}>Sign in with your LiftLog gym owner account</p>
          <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <input
              type="email"
              placeholder="Email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 12, padding: '12px 16px', color: '#fff', fontSize: 15, outline: 'none' }}
            />
            <input
              type="password"
              placeholder="Password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 12, padding: '12px 16px', color: '#fff', fontSize: 15, outline: 'none' }}
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
      <div style={{ minHeight: '100vh', background: '#0f1117', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <div style={{ textAlign: 'center', maxWidth: 400 }}>
          <p style={{ fontSize: 48, marginBottom: 16 }}>⚠️</p>
          <h1 style={{ color: '#fff', fontSize: 22, fontWeight: 700, marginBottom: 8 }}>Not a gym owner account</h1>
          <p style={{ color: 'rgba(255,255,255,0.4)', marginBottom: 24 }}>This dashboard is only accessible to approved gym owner accounts.</p>
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
    <div style={{ minHeight: '100vh', background: '#0f1117', color: '#fff', fontFamily: 'sans-serif' }}>

      {/* Nav */}
      <nav style={{ borderBottom: '1px solid rgba(255,255,255,0.1)', padding: '16px 32px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', maxWidth: 1200, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ color: TEAL, fontWeight: 800, fontSize: 20 }}>LiftLog</span>
          <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: 14 }}>/ Gym Dashboard</span>
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <a href="/plans" style={{ color: 'rgba(255,255,255,0.5)', fontSize: 14, textDecoration: 'none', padding: '8px 16px' }}>My Plans</a>
          <a href="/import-pts" style={{ color: 'rgba(255,255,255,0.5)', fontSize: 14, textDecoration: 'none', padding: '8px 16px' }}>Import PTs</a>
          <button onClick={handleLogout} style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)', color: 'rgba(255,255,255,0.6)', borderRadius: 10, padding: '8px 16px', fontSize: 13, cursor: 'pointer' }}>
            Sign Out
          </button>
        </div>
      </nav>

      <main style={{ maxWidth: 1200, margin: '0 auto', padding: '40px 32px' }}>

        {/* Gym header */}
        <div style={{ marginBottom: 40 }}>
          <h1 style={{ fontSize: 32, fontWeight: 800, marginBottom: 4 }}>{gym?.gym_name}</h1>
          <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 15 }}>{gym?.address}</p>
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
        <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 20, overflow: 'hidden' }}>
          <div style={{ padding: '20px 24px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
            <h2 style={{ fontWeight: 700, fontSize: 18, margin: 0 }}>PT Roster</h2>
          </div>

          {loadingData ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'rgba(255,255,255,0.3)' }}>Loading…</div>
          ) : pts.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'rgba(255,255,255,0.3)' }}>
              No PTs invited yet. Use the LiftLog app to invite PTs to your gym.
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                <thead>
                  <tr style={{ color: 'rgba(255,255,255,0.4)', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    {['PT Name', 'Email', 'Status', 'Patients', 'Avg Satisfaction', 'Invited'].map(h => (
                      <th key={h} style={{ padding: '12px 24px', textAlign: 'left', fontWeight: 600, whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {pts.map((pt, i) => (
                    <tr key={pt.id} style={{ borderTop: '1px solid rgba(255,255,255,0.06)', background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.02)' }}>
                      <td style={{ padding: '16px 24px', fontWeight: 600 }}>{pt.ptName}</td>
                      <td style={{ padding: '16px 24px', color: 'rgba(255,255,255,0.5)' }}>{pt.ptEmail}</td>
                      <td style={{ padding: '16px 24px' }}>{statusBadge(pt.status)}</td>
                      <td style={{ padding: '16px 24px', color: pt.patientCount > 0 ? '#fff' : 'rgba(255,255,255,0.3)' }}>
                        {pt.status === 'accepted' ? pt.patientCount : '—'}
                      </td>
                      <td style={{ padding: '16px 24px' }}>
                        {pt.status === 'accepted' && pt.avgSatisfaction !== null ? (
                          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ color: YELLOW, fontSize: 14 }}>{renderStars(pt.avgSatisfaction)}</span>
                            <span style={{ color: TEAL, fontWeight: 700 }}>{pt.avgSatisfaction.toFixed(1)}</span>
                            <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: 12 }}>/5</span>
                          </span>
                        ) : (
                          <span style={{ color: 'rgba(255,255,255,0.3)' }}>—</span>
                        )}
                      </td>
                      <td style={{ padding: '16px 24px', color: 'rgba(255,255,255,0.4)', whiteSpace: 'nowrap' }}>
                        {new Date(pt.invited_at).toLocaleDateString('en-CA')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

function StatCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color: string }) {
  return (
    <div style={{ background: 'rgba(255,255,255,0.04)', border: `1px solid ${color}30`, borderRadius: 16, padding: '20px 24px' }}>
      <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>{label}</p>
      <p style={{ color, fontSize: 28, fontWeight: 800, margin: 0 }}>{value}</p>
      {sub && <p style={{ color: 'rgba(255,255,255,0.3)', fontSize: 12, marginTop: 4 }}>{sub}</p>}
    </div>
  );
}
