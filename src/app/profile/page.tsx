'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getSupabase } from '@/lib/supabase';
import { Sk, SkPage } from '@/components/Skeleton';

const TEAL   = '#5fcfbf';
const PURPLE = '#C471ED';
const YELLOW = '#F9F295';

interface Profile {
  id: string;
  display_name: string;
  email: string;
  role: 'patient' | 'practitioner';
  approved: boolean;
  is_gym_owner: boolean;
  is_employer: boolean;
  company_name: string | null;
  avatar_url: string | null;
}

interface Practitioner {
  id: string;
  display_name: string;
  email: string;
}

interface Patient {
  id: string;
  display_name: string;
  email: string;
}

type PageState = 'loading' | 'ready' | 'unauthenticated';

const MASTER_PRACTITIONER_ID = process.env.NEXT_PUBLIC_FEATURED_PRACTITIONER_ID || '969ea6c6-ba6d-4ee4-8bb8-a7cee267f40c';

interface FeaturedStats {
  avg_effectiveness:     number | null;
  effectiveness_count:   number;
  avg_enjoyment:         number | null;
  enjoyment_count:       number;
  active_employer_count: number;
  total_employee_count:  number;
}

function makeCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

export default function ProfilePage() {
  const router = useRouter();
  const [pageState, setPageState]     = useState<PageState>('loading');
  const [profile, setProfile]         = useState<Profile | null>(null);
  const [practitioners, setPractitioners] = useState<Practitioner[]>([]);
  const [patients, setPatients]       = useState<Patient[]>([]);
  const [sessionToken, setSessionToken] = useState('');

  const [featuredStats, setFeaturedStats] = useState<FeaturedStats | null>(null);
  const [employerTeams, setEmployerTeams] = useState<{ id: string; name: string; memberCount: number }[]>([]);

  // Subscription state (practitioners only)
  const [subscription, setSubscription] = useState<{ status: string; periodEnd: string | null; hasAccess: boolean; canCancel: boolean } | null>(null);
  const [cancelingSubscription, setCancelingSubscription] = useState(false);
  const [cancelSuccess, setCancelSuccess] = useState<string | null>(null);

  // Invite code state
  const [inviteCode, setInviteCode]   = useState<{ code: string; expires_at: string } | null>(null);
  const [inviteLoading, setInviteLoading] = useState(false);
  const [copiedCode, setCopiedCode]   = useState(false);

  // Email invite state
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteName, setInviteName]   = useState('');
  const [sendingInvite, setSendingInvite] = useState(false);
  const [inviteSent, setInviteSent]   = useState(false);
  const [inviteError, setInviteError] = useState('');

  useEffect(() => {
    const supabase = getSupabase();
    supabase.auth.getSession().then(async ({ data }) => {
      if (!data.session) {
        setPageState('unauthenticated');
        return;
      }

      const userId = data.session.user.id;
      setSessionToken(data.session.access_token);

      if (userId === MASTER_PRACTITIONER_ID) {
        router.push('/master/dashboard');
        return;
      }

      const { data: prof } = await supabase
        .from('profiles')
        .select('id, display_name, email, role, approved, is_gym_owner, is_employer, company_name, avatar_url')
        .eq('id', userId)
        .single();

      if (!prof) { setPageState('unauthenticated'); return; }

      // Gym owners → dashboard
      if (prof.is_gym_owner) { router.push('/dashboard'); return; }

      setProfile(prof);

      if (prof.role === 'patient') {
        const { data: links } = await supabase
          .from('patient_links')
          .select('profiles:practitioner_id(id, display_name, email)')
          .eq('patient_id', userId);
        const pts = (links ?? []).map((l: any) => Array.isArray(l.profiles) ? l.profiles[0] : l.profiles).filter(Boolean);
        setPractitioners(pts);
      } else {
        const [linksRes, teamsRes] = await Promise.all([
          supabase
            .from('patient_links')
            .select('profiles:patient_id(id, display_name, email), team_id')
            .eq('practitioner_id', userId),
          prof.is_employer
            ? supabase.from('employer_teams').select('id, name').eq('employer_id', userId).order('name')
            : Promise.resolve({ data: [] }),
        ]);
        const links = linksRes.data ?? [];
        const pats = links.map((l: any) => Array.isArray(l.profiles) ? l.profiles[0] : l.profiles).filter(Boolean);
        setPatients(pats);

        if (prof.is_employer) {
          const teamCounts: Record<string, number> = {};
          for (const l of links) {
            const tid = (l as any).team_id;
            if (tid) teamCounts[tid] = (teamCounts[tid] ?? 0) + 1;
          }
          setEmployerTeams(((teamsRes as any).data ?? []).map((t: any) => ({ id: t.id, name: t.name, memberCount: teamCounts[t.id] ?? 0 })));
        }

        // Load active invite code
        const { data: codeData } = await supabase
          .from('invite_codes')
          .select('code, expires_at')
          .eq('practitioner_id', userId)
          .is('used_by', null)
          .gt('expires_at', new Date().toISOString())
          .order('created_at', { ascending: false })
          .limit(1)
          .single();
        setInviteCode(codeData ?? null);

        if (userId === MASTER_PRACTITIONER_ID) {
          const { data: statsRows } = await supabase.rpc('get_featured_program_stats', { p_practitioner_id: userId });
          setFeaturedStats((statsRows as FeaturedStats[])?.[0] ?? null);
        }

        // Load subscription info
        const { data: subData } = await supabase
          .from('practitioner_subscriptions')
          .select('status, current_period_end, grandfathered, stripe_subscription_id')
          .eq('practitioner_id', userId)
          .single();
        if (subData) {
          const now = new Date();
          const periodEnd = subData.current_period_end ? new Date(subData.current_period_end) : null;
          const trialEndData = (subData as any).trial_end ? new Date((subData as any).trial_end) : null;
          const trialActive = subData.status === 'trialing' && trialEndData !== null && trialEndData > now;
          const hasAccess = !!subData.grandfathered || subData.status === 'active' || subData.status === 'past_due' || trialActive;
          const canCancel = !!(subData as any).stripe_subscription_id &&
            (subData.status === 'active' || subData.status === 'trialing' || subData.status === 'past_due');
          setSubscription({
            status: subData.status,
            periodEnd: periodEnd ? periodEnd.toISOString() : null,
            hasAccess,
            canCancel,
          });
        }
      }

      setPageState('ready');
    });
  }, [router]);

  const handleSignOut = async () => {
    await getSupabase().auth.signOut();
    router.push('/login');
  };

  const handleGenerateCode = async () => {
    if (!profile) return;
    setInviteLoading(true);
    const sb = getSupabase();
    await sb.from('invite_codes').delete().eq('practitioner_id', profile.id).is('used_by', null);
    const code = makeCode();
    await sb.from('invite_codes').insert({ practitioner_id: profile.id, code });
    const { data } = await sb
      .from('invite_codes')
      .select('code, expires_at')
      .eq('practitioner_id', profile.id)
      .is('used_by', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();
    setInviteCode(data ?? null);
    setInviteLoading(false);
  };

  const handleCopyCode = () => {
    if (!inviteCode?.code) return;
    navigator.clipboard.writeText(inviteCode.code);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  const handleSendInvite = async () => {
    if (!inviteEmail.trim()) return;
    setSendingInvite(true);
    setInviteError('');
    try {
      const res = await fetch('/api/send-invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionToken}` },
        body: JSON.stringify({ patients: [{ email: inviteEmail.trim(), name: inviteName.trim() || undefined }] }),
      });
      const json = await res.json();
      if (json.sent > 0) {
        setInviteSent(true);
        setInviteEmail('');
        setInviteName('');
        setTimeout(() => setInviteSent(false), 4000);
      } else {
        setInviteError(json.results?.[0]?.error ?? 'Failed to send. Please try again.');
      }
    } catch {
      setInviteError('Failed to send. Please try again.');
    }
    setSendingInvite(false);
  };

  const handleCancelSubscription = async () => {
    if (!confirm(
      subscription?.periodEnd
        ? `Are you sure? You'll keep full access to all practitioner features until ${new Date(subscription.periodEnd).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}. Your patients' data will not be deleted.`
        : "Are you sure? You'll keep full access until the end of your billing period. Your patients' data will not be deleted."
    )) return;

    setCancelingSubscription(true);
    setCancelSuccess(null);
    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/cancel-subscription`,
        { method: 'POST', headers: { Authorization: `Bearer ${sessionToken}` } }
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? 'Failed to cancel subscription');
      const periodEnd = new Date(body.periodEnd);
      setSubscription(prev => prev ? { ...prev, status: 'active' } : prev);
      setCancelSuccess(
        `Your subscription has been canceled. You'll keep full access until ${periodEnd.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}.`
      );
    } catch (err: any) {
      alert(err?.message ?? 'Could not cancel subscription. Please contact logthelift@gmail.com.');
    } finally {
      setCancelingSubscription(false);
    }
  };

  if (pageState === 'loading') {
    return (
      <SkPage>
        <main style={{ maxWidth: 900, margin: '0 auto', padding: '40px 32px' }}>
          {/* Profile card */}
          <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 20, padding: '32px', marginBottom: 28, display: 'flex', alignItems: 'center', gap: 24 }}>
            <Sk width={72} height={72} radius={999} />
            <div style={{ flex: 1 }}>
              <Sk width={180} height={20} style={{ marginBottom: 10 }} />
              <Sk width={220} height={13} radius={4} style={{ marginBottom: 14 }} />
              <div style={{ display: 'flex', gap: 8 }}>
                <Sk width={90} height={24} radius={999} />
                <Sk width={100} height={24} radius={999} />
              </div>
            </div>
            <Sk width={80} height={32} radius={8} />
          </div>
          {/* Connections */}
          <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 20, overflow: 'hidden', marginBottom: 24 }}>
            <div style={{ padding: '20px 28px', borderBottom: '1px solid var(--border-subtle)' }}>
              <Sk width={140} height={17} radius={5} />
            </div>
            {[0,1,2].map(i => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '14px 28px', borderTop: i > 0 ? '1px solid var(--border-subtle)' : 'none' }}>
                <Sk width={40} height={40} radius={999} />
                <div>
                  <Sk width={130} height={13} style={{ marginBottom: 6 }} />
                  <Sk width={180} height={11} radius={4} />
                </div>
              </div>
            ))}
          </div>
          {/* Actions row */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: 14 }}>
            {[0,1].map(i => (
              <div key={i} style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 20, padding: '24px 28px' }}>
                <Sk width={140} height={15} style={{ marginBottom: 8 }} />
                <Sk width="90%" height={12} radius={4} style={{ marginBottom: 16 }} />
                <Sk width={120} height={36} radius={10} />
              </div>
            ))}
          </div>
        </main>
      </SkPage>
    );
  }

  if (pageState === 'unauthenticated') {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
        <p style={{ color: 'var(--text-muted)' }}>You need to sign in to view your profile.</p>
        <a href="/login" style={{ background: TEAL, color: '#0f1117', borderRadius: 12, padding: '12px 28px', fontWeight: 700, textDecoration: 'none' }}>Sign In</a>
      </div>
    );
  }

  const isPractitioner = profile?.role === 'practitioner';
  const isEmployer = !!profile?.is_employer;

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', color: 'var(--text)', fontFamily: 'sans-serif' }}>

      {/* Patient-only nav (practitioners get NavShell from layout) */}
      {!isPractitioner && (
        <nav style={{ borderBottom: '1px solid var(--border)', padding: '16px 32px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <a href="/profile" style={{ color: TEAL, fontWeight: 800, fontSize: 20, textDecoration: 'none' }}>LiftLog</a>
        </nav>
      )}

      <main style={{ maxWidth: 900, margin: '0 auto', padding: '40px 32px' }}>

        {/* Profile card */}
        <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 20, padding: '32px', marginBottom: 32, display: 'flex', alignItems: 'center', gap: 24 }}>
          <div style={{ width: 72, height: 72, borderRadius: '50%', background: isPractitioner ? 'var(--badge-purple-bg)' : 'var(--badge-teal-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28, flexShrink: 0, overflow: 'hidden' }}>
            {profile?.avatar_url
              ? <img src={profile.avatar_url} alt={profile.display_name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              : (isEmployer ? '🏢' : isPractitioner ? '🩺' : '🏋️')}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
              <h1 style={{ fontSize: 24, fontWeight: 800, margin: '0 0 4px' }}>{profile?.display_name}</h1>
            </div>
            <p style={{ color: 'var(--text-muted)', fontSize: 14, margin: '0 0 12px' }}>{profile?.email}</p>
            {isEmployer && profile?.company_name && (
              <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: '0 0 12px' }}>{profile.company_name}</p>
            )}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ background: isPractitioner ? 'var(--badge-purple-bg)' : 'var(--badge-teal-bg)', color: isPractitioner ? 'var(--badge-purple-text)' : 'var(--badge-teal-text)', padding: '4px 12px', borderRadius: 999, fontSize: 12, fontWeight: 700 }}>
                {isEmployer ? 'Employer' : isPractitioner ? 'Practitioner' : 'Patient'}
              </span>
              {isPractitioner && (
                <span style={{ background: profile?.approved ? 'var(--badge-teal-bg)' : 'var(--badge-yellow-bg)', color: profile?.approved ? 'var(--badge-teal-text)' : 'var(--badge-yellow-text)', padding: '4px 12px', borderRadius: 999, fontSize: 12, fontWeight: 700 }}>
                  {profile?.approved ? 'Approved' : 'Pending Approval'}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Connections */}
        <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 20, overflow: 'hidden' }}>
          <div style={{ padding: '20px 28px', borderBottom: '1px solid var(--border-subtle)' }}>
            <h2 style={{ fontWeight: 700, fontSize: 18, margin: 0 }}>
              {isPractitioner ? `My ${isEmployer ? 'Employees' : 'Patients'} (${patients.length})` : `My Practitioners (${practitioners.length})`}
            </h2>
          </div>

          {(isPractitioner ? patients : practitioners).length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center' }}>
              <p style={{ color: 'var(--text-dim)', marginBottom: 16 }}>
                {isPractitioner
                  ? (isEmployer ? 'No employees linked yet. Send an invite email or upload a CSV to get started.' : 'No patients linked yet. Use your invite code below or send an invite email.')
                  : 'No practitioners linked yet. Use the LiftLog app to connect with a practitioner.'}
              </p>
              {!isPractitioner && (
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  <a href="https://apps.apple.com/app/id6762567982" target="_blank" rel="noopener noreferrer"
                    style={{ background: TEAL, color: '#0f1117', borderRadius: 12, padding: '12px 28px', fontWeight: 700, textDecoration: 'none', fontSize: 14 }}>
                    App Store
                  </a>
                  <a href="https://play.google.com/store/apps/details?id=com.logthelift.app" target="_blank" rel="noopener noreferrer"
                    style={{ background: YELLOW, color: '#0f1117', borderRadius: 12, padding: '12px 28px', fontWeight: 700, textDecoration: 'none', fontSize: 14 }}>
                    Google Play
                  </a>
                </div>
              )}
            </div>
          ) : (
            <div>
              {(isPractitioner ? patients : practitioners).map((person, i) => (
                <a key={person.id} href={isPractitioner ? (isEmployer ? `/employee/${person.id}` : `/patients/${person.id}`) : undefined}
                  style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '16px 28px', borderTop: i > 0 ? '1px solid var(--border-subtle)' : 'none', textDecoration: 'none', color: 'inherit', cursor: isPractitioner ? 'pointer' : 'default', transition: 'background 0.15s' }}
                  onMouseEnter={e => { if (isPractitioner) (e.currentTarget as HTMLElement).style.background = 'var(--card-alt)'; }}
                  onMouseLeave={e => { if (isPractitioner) (e.currentTarget as HTMLElement).style.background = ''; }}
                >
                  <div style={{ width: 40, height: 40, borderRadius: '50%', background: isPractitioner ? 'var(--badge-teal-bg)' : 'var(--badge-purple-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, flexShrink: 0 }}>
                    {isPractitioner ? '🏋️' : '🩺'}
                  </div>
                  <div>
                    <p style={{ fontWeight: 600, margin: '0 0 2px' }}>{person.display_name}</p>
                    <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: 0 }}>{person.email}</p>
                  </div>
                </a>
              ))}
            </div>
          )}
        </div>

        {/* My Teams (employer only) */}
        {isEmployer && (
          <div style={{ marginTop: 28, background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 20, overflow: 'hidden' }}>
            <div style={{ padding: '20px 28px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
              <h2 style={{ fontWeight: 700, fontSize: 18, margin: 0 }}>My Teams ({employerTeams.length})</h2>
              <a href="/teams" style={{ fontSize: 13, color: TEAL, textDecoration: 'none', fontWeight: 600, whiteSpace: 'nowrap' }}>Manage →</a>
            </div>
            {employerTeams.length === 0 ? (
              <div style={{ padding: '32px 28px', textAlign: 'center' }}>
                <p style={{ color: 'var(--text-dim)', fontSize: 14, margin: '0 0 16px' }}>No teams yet. Create teams to organize employees for the leaderboard.</p>
                <a href="/teams" style={{ background: TEAL, color: '#0f1117', borderRadius: 10, padding: '10px 22px', fontWeight: 700, textDecoration: 'none', fontSize: 14 }}>Set Up Teams</a>
              </div>
            ) : (
              <div>
                {employerTeams.map((team, i) => (
                  <a
                    key={team.id}
                    href="/teams"
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, padding: '14px 28px', borderTop: i > 0 ? '1px solid var(--border-subtle)' : 'none', textDecoration: 'none', color: 'inherit', transition: 'background 0.15s' }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'var(--card-alt)')}
                    onMouseLeave={e => (e.currentTarget.style.background = '')}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <div style={{ width: 36, height: 36, borderRadius: '50%', background: `${PURPLE}18`, border: `1px solid ${PURPLE}30`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, flexShrink: 0 }}>👥</div>
                      <span style={{ fontWeight: 600, fontSize: 15 }}>{team.name}</span>
                    </div>
                    <span style={{ fontSize: 13, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{team.memberCount} member{team.memberCount !== 1 ? 's' : ''}</span>
                  </a>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Master practitioner program metrics */}
        {profile?.id === MASTER_PRACTITIONER_ID && (
          <div style={{ marginTop: 28, background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 20, padding: '28px' }}>
            <h2 style={{ fontWeight: 700, fontSize: 18, margin: '0 0 4px' }}>Program Ratings</h2>
            <p style={{ color: 'var(--text-muted)', fontSize: 14, margin: '0 0 24px' }}>
              Aggregated from all employees across active employer programs.
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14 }}>
              {/* Avg Effectiveness */}
              <div style={{ background: 'var(--card-alt)', border: `1px solid ${PURPLE}30`, borderRadius: 16, padding: '20px 20px 18px' }}>
                <p style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text-dim)', margin: '0 0 10px' }}>Avg Effectiveness</p>
                {featuredStats?.avg_effectiveness != null ? (
                  <>
                    <p style={{ fontSize: 28, fontWeight: 800, color: PURPLE, margin: '0 0 4px' }}>
                      {Number(featuredStats.avg_effectiveness).toFixed(1)}
                      <span style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-muted)', marginLeft: 2 }}>/5</span>
                    </p>
                    <p style={{ fontSize: 12, color: 'var(--text-dim)', margin: 0 }}>
                      {'★'.repeat(Math.round(Number(featuredStats.avg_effectiveness)))}{'☆'.repeat(5 - Math.round(Number(featuredStats.avg_effectiveness)))}
                    </p>
                    <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '6px 0 0' }}>{featuredStats.effectiveness_count} vote{featuredStats.effectiveness_count !== 1 ? 's' : ''}</p>
                  </>
                ) : (
                  <p style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-dim)', margin: 0 }}>—</p>
                )}
              </div>

              {/* Avg Enjoyment */}
              <div style={{ background: 'var(--card-alt)', border: `1px solid ${TEAL}30`, borderRadius: 16, padding: '20px 20px 18px' }}>
                <p style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text-dim)', margin: '0 0 10px' }}>Avg Enjoyment</p>
                {featuredStats?.avg_enjoyment != null ? (
                  <>
                    <p style={{ fontSize: 28, fontWeight: 800, color: TEAL, margin: '0 0 4px' }}>
                      {Number(featuredStats.avg_enjoyment).toFixed(1)}
                      <span style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-muted)', marginLeft: 2 }}>/5</span>
                    </p>
                    <p style={{ fontSize: 12, color: 'var(--text-dim)', margin: 0 }}>
                      {'★'.repeat(Math.round(Number(featuredStats.avg_enjoyment)))}{'☆'.repeat(5 - Math.round(Number(featuredStats.avg_enjoyment)))}
                    </p>
                    <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '6px 0 0' }}>{featuredStats.enjoyment_count} vote{featuredStats.enjoyment_count !== 1 ? 's' : ''}</p>
                  </>
                ) : (
                  <p style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-dim)', margin: 0 }}>—</p>
                )}
              </div>

              {/* Active Employers */}
              <div style={{ background: 'var(--card-alt)', border: '1px solid var(--border)', borderRadius: 16, padding: '20px 20px 18px' }}>
                <p style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text-dim)', margin: '0 0 10px' }}>Active Employers</p>
                <p style={{ fontSize: 28, fontWeight: 800, color: 'var(--text)', margin: '0 0 4px' }}>{featuredStats?.active_employer_count ?? '—'}</p>
                <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>running a program</p>
              </div>

              {/* Total Employees */}
              <div style={{ background: 'var(--card-alt)', border: '1px solid var(--border)', borderRadius: 16, padding: '20px 20px 18px' }}>
                <p style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text-dim)', margin: '0 0 10px' }}>Total Employees</p>
                <p style={{ fontSize: 28, fontWeight: 800, color: 'var(--text)', margin: '0 0 4px' }}>{featuredStats?.total_employee_count ?? '—'}</p>
                <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>across all employers</p>
              </div>
            </div>
          </div>
        )}

        {/* Invite code (non-employer practitioners only) */}
        {isPractitioner && !isEmployer && (
          <div style={{ marginTop: 28, background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 20, padding: '28px' }}>
            <h2 style={{ fontWeight: 700, fontSize: 18, margin: '0 0 4px' }}>My Invite Code</h2>
            <p style={{ color: 'var(--text-muted)', fontSize: 14, margin: '0 0 20px' }}>
              Share this code with {isEmployer ? 'an employee' : 'a patient'}. They enter it in the LiftLog app under <strong style={{ color: 'var(--text)' }}>Stats → Link to Practitioner</strong>.
            </p>

            {inviteLoading ? (
              <div style={{ textAlign: 'center', padding: '20px 0', color: 'var(--text-muted)', fontSize: 14 }}>Generating…</div>
            ) : inviteCode ? (
              <>
                <div style={{ background: `${TEAL}15`, border: `1px solid ${TEAL}44`, borderRadius: 14, padding: '20px', textAlign: 'center', marginBottom: 16 }}>
                  <p style={{ color: 'var(--text-muted)', fontSize: 11, fontWeight: 600, letterSpacing: '1px', margin: '0 0 8px', textTransform: 'uppercase' }}>Your Code</p>
                  <p style={{ color: TEAL, fontSize: 40, fontWeight: 800, letterSpacing: '8px', margin: '0 0 8px', fontFamily: 'monospace' }}>{inviteCode.code}</p>
                  <p style={{ color: 'var(--text-muted)', fontSize: 12, margin: 0 }}>Expires {new Date(inviteCode.expires_at).toLocaleDateString()}</p>
                </div>
                <div style={{ display: 'flex', gap: 10 }}>
                  <button onClick={handleCopyCode}
                    style={{ flex: 1, background: copiedCode ? TEAL : 'var(--card-alt)', color: copiedCode ? '#0f1117' : 'var(--text)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>
                    {copiedCode ? 'Copied!' : 'Copy Code'}
                  </button>
                  <button onClick={handleGenerateCode}
                    style={{ flex: 1, background: 'var(--card-alt)', color: 'var(--text-muted)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px', fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>
                    New Code
                  </button>
                </div>
              </>
            ) : (
              <>
                <p style={{ color: 'var(--text-muted)', fontSize: 14, textAlign: 'center', marginBottom: 16 }}>No active code. Generate one to share with {isEmployer ? 'a team member' : 'a patient'}.</p>
                <button onClick={handleGenerateCode}
                  style={{ width: '100%', background: TEAL, color: '#0f1117', border: 'none', borderRadius: 12, padding: '13px', fontWeight: 700, fontSize: 15, cursor: 'pointer' }}>
                  Generate Invite Code
                </button>
              </>
            )}
          </div>
        )}

        {/* Invite by email (practitioners only) */}
        {isPractitioner && (
          <div style={{ marginTop: 16, background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 20, padding: '28px' }}>
            <h2 style={{ fontWeight: 700, fontSize: 18, margin: '0 0 4px' }}>Invite by Email</h2>
            <p style={{ color: 'var(--text-muted)', fontSize: 14, margin: '0 0 8px' }}>
              Send {isEmployer ? 'an employee' : 'a patient'} their unique invite code and app download link by email.
            </p>
            <p style={{ fontSize: 14, margin: '0 0 20px' }}>
              <strong>Remind your {isEmployer ? 'employee' : 'patient'} to check their junk/spam folder</strong>{' '}if they don&apos;t see the email in their inbox.
            </p>
            <div style={{ display: 'flex', gap: 10, marginBottom: inviteError ? 8 : 12, flexWrap: 'wrap' }}>
              <input
                value={inviteName}
                onChange={e => setInviteName(e.target.value)}
                placeholder={isEmployer ? 'Employee name (optional)' : 'Patient name (optional)'}
                style={{ flex: 1, minWidth: 150, background: 'var(--card-alt)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 14px', color: 'var(--text)', fontSize: 14, outline: 'none' }}
              />
              <input
                value={inviteEmail}
                onChange={e => { setInviteEmail(e.target.value); setInviteError(''); }}
                placeholder={isEmployer ? 'employee@email.com' : 'patient@email.com'}
                type="email"
                style={{ flex: 2, minWidth: 200, background: 'var(--card-alt)', border: `1px solid ${inviteError ? '#ff6b6b' : 'var(--border)'}`, borderRadius: 10, padding: '10px 14px', color: 'var(--text)', fontSize: 14, outline: 'none' }}
              />
            </div>
            {inviteError && <p style={{ color: '#ff6b6b', fontSize: 13, margin: '0 0 10px' }}>{inviteError}</p>}
            <button
              onClick={handleSendInvite}
              disabled={sendingInvite || !inviteEmail.trim()}
              style={{ width: '100%', background: inviteSent ? TEAL : PURPLE, color: inviteSent ? '#0f1117' : 'var(--text)', border: 'none', borderRadius: 12, padding: '13px', fontWeight: 700, fontSize: 15, cursor: sendingInvite || !inviteEmail.trim() ? 'not-allowed' : 'pointer', opacity: !inviteEmail.trim() ? 0.55 : 1, transition: 'background 0.2s' }}>
              {inviteSent ? 'Invite Sent!' : sendingInvite ? 'Sending…' : 'Send Invite Email'}
            </button>
          </div>
        )}

        {/* Practitioner utilities */}
        {isPractitioner && (
          <div style={{ marginTop: 16, background: 'var(--card)', border: '1px solid var(--border-subtle)', borderRadius: 16, padding: '20px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
            <div>
              <p style={{ fontWeight: 700, fontSize: 15, margin: '0 0 3px' }}>Bulk Import {isEmployer ? 'Employees' : 'Patients'}</p>
              <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: 0 }}>Import multiple {isEmployer ? 'employees' : 'patients'} at once from a file.</p>
            </div>
            <a href="/import" style={{ background: TEAL, color: '#0f1117', borderRadius: 10, padding: '9px 20px', fontWeight: 700, textDecoration: 'none', fontSize: 13, whiteSpace: 'nowrap', border: 'none' }}>
              Import {isEmployer ? 'Employees' : 'Patients'}
            </a>
          </div>
        )}

        {/* Cancel subscription (practitioners with active access, not already canceled) */}
        {isPractitioner && subscription?.canCancel && (
          <div style={{ marginTop: 16, background: 'var(--modal-bg)', border: '1px solid #ff6b6b44', borderRadius: 16, padding: '20px 24px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: cancelSuccess ? 12 : 0 }}>
              <div>
                <p style={{ fontWeight: 700, fontSize: 15, margin: '0 0 3px', color: '#ff6b6b' }}>Cancel Subscription</p>
                <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: 0 }}>
                  {subscription?.periodEnd
                    ? `You'll keep access until ${new Date(subscription.periodEnd).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
                    : 'Your access continues until the end of the billing period'}
                </p>
              </div>
              <button
                onClick={handleCancelSubscription}
                disabled={cancelingSubscription}
                style={{ background: 'transparent', color: '#ff6b6b', border: '1px solid #ff6b6b', borderRadius: 10, padding: '9px 20px', fontWeight: 700, fontSize: 13, cursor: cancelingSubscription ? 'not-allowed' : 'pointer', opacity: cancelingSubscription ? 0.6 : 1, whiteSpace: 'nowrap' }}>
                {cancelingSubscription ? 'Canceling…' : 'Cancel Subscription'}
              </button>
            </div>
            {cancelSuccess && (
              <p style={{ color: '#5fcfbf', fontSize: 13, margin: 0, background: '#5fcfbf18', borderRadius: 8, padding: '10px 14px' }}>
                {cancelSuccess}
              </p>
            )}
          </div>
        )}

        {/* Patient quick actions */}
        {!isPractitioner && (
          <div style={{ marginTop: 32, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 14 }}>
            <div style={{ background: `${TEAL}11`, border: `1px solid ${TEAL}33`, borderRadius: 20, padding: '24px 28px', display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <p style={{ fontWeight: 700, fontSize: 16, margin: '0 0 4px' }}>Log a Workout</p>
                <p style={{ color: 'var(--text-muted)', fontSize: 14, margin: 0 }}>Record your session from your computer.</p>
              </div>
              <a href="/log" style={{ background: TEAL, color: '#0f1117', borderRadius: 12, padding: '10px 20px', fontWeight: 700, textDecoration: 'none', fontSize: 14, textAlign: 'center' }}>
                Log Workout
              </a>
            </div>
            <div style={{ background: `${PURPLE}11`, border: `1px solid ${PURPLE}33`, borderRadius: 20, padding: '24px 28px', display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <p style={{ fontWeight: 700, fontSize: 16, margin: '0 0 4px' }}>My Plans</p>
                <p style={{ color: 'var(--text-muted)', fontSize: 14, margin: 0 }}>View plans assigned by your practitioner.</p>
              </div>
              <a href="/my-plans" style={{ background: PURPLE, color: 'var(--text)', borderRadius: 12, padding: '10px 20px', fontWeight: 700, textDecoration: 'none', fontSize: 14, textAlign: 'center' }}>
                View Plans
              </a>
            </div>
            <div style={{ background: `${YELLOW}0d`, border: `1px solid ${YELLOW}30`, borderRadius: 20, padding: '24px 28px', display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <p style={{ fontWeight: 700, fontSize: 16, margin: '0 0 4px' }}>Progress</p>
                <p style={{ color: 'var(--text-muted)', fontSize: 14, margin: 0 }}>Track your consistency, strength gains, and workout history.</p>
              </div>
              <a href="/progress" style={{ background: YELLOW, color: '#0f1117', borderRadius: 12, padding: '10px 20px', fontWeight: 700, textDecoration: 'none', fontSize: 14, textAlign: 'center' }}>
                View Progress
              </a>
            </div>
            <div style={{ background: `${PURPLE}0d`, border: `1px solid ${PURPLE}30`, borderRadius: 20, padding: '24px 28px', display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <p style={{ fontWeight: 700, fontSize: 16, margin: '0 0 4px' }}>Friends</p>
                <p style={{ color: 'var(--text-muted)', fontSize: 14, margin: 0 }}>View friend activity, react to workouts, and add new friends.</p>
              </div>
              <a href="/friends" style={{ background: PURPLE, color: 'var(--text)', borderRadius: 12, padding: '10px 20px', fontWeight: 700, textDecoration: 'none', fontSize: 14, textAlign: 'center' }}>
                View Friends
              </a>
            </div>
          </div>
        )}

        {/* App CTA */}
        <div style={{ marginTop: 32, background: `${TEAL}11`, border: `1px solid ${TEAL}33`, borderRadius: 20, padding: '24px 28px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
          <div>
            <p style={{ fontWeight: 700, fontSize: 16, margin: '0 0 4px' }}>Full experience on mobile</p>
            <p style={{ color: 'var(--text-muted)', fontSize: 14, margin: 0 }}>Log workouts, track progress, and connect with your team on the LiftLog app.</p>
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <a href="https://apps.apple.com/app/id6762567982" target="_blank" rel="noopener noreferrer"
              style={{ background: TEAL, color: '#0f1117', borderRadius: 12, padding: '12px 24px', fontWeight: 700, textDecoration: 'none', fontSize: 14, whiteSpace: 'nowrap' }}>
              App Store
            </a>
            <a href="https://play.google.com/store/apps/details?id=com.logthelift.app" target="_blank" rel="noopener noreferrer"
              style={{ background: YELLOW, color: '#0f1117', borderRadius: 12, padding: '12px 24px', fontWeight: 700, textDecoration: 'none', fontSize: 14, whiteSpace: 'nowrap' }}>
              Google Play
            </a>
          </div>
        </div>

      </main>
    </div>
  );
}
