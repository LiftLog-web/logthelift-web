'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getSupabase } from '@/lib/supabase';

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

export default function ProfilePage() {
  const router = useRouter();
  const [pageState, setPageState]     = useState<PageState>('loading');
  const [profile, setProfile]         = useState<Profile | null>(null);
  const [practitioners, setPractitioners] = useState<Practitioner[]>([]);
  const [patients, setPatients]       = useState<Patient[]>([]);

  useEffect(() => {
    const supabase = getSupabase();
    supabase.auth.getSession().then(async ({ data }) => {
      if (!data.session) {
        setPageState('unauthenticated');
        return;
      }

      const userId = data.session.user.id;

      const { data: prof } = await supabase
        .from('profiles')
        .select('id, display_name, email, role, approved, is_gym_owner, avatar_url')
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
        const { data: links } = await supabase
          .from('patient_links')
          .select('profiles:patient_id(id, display_name, email)')
          .eq('practitioner_id', userId);
        const pats = (links ?? []).map((l: any) => Array.isArray(l.profiles) ? l.profiles[0] : l.profiles).filter(Boolean);
        setPatients(pats);
      }

      setPageState('ready');
    });
  }, [router]);

  const handleSignOut = async () => {
    await getSupabase().auth.signOut();
    router.push('/login');
  };

  if (pageState === 'loading') {
    return (
      <div style={{ minHeight: '100vh', background: '#0f1117', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ width: 32, height: 32, border: `3px solid ${TEAL}`, borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (pageState === 'unauthenticated') {
    return (
      <div style={{ minHeight: '100vh', background: '#0f1117', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
        <p style={{ color: 'rgba(255,255,255,0.5)' }}>You need to sign in to view your profile.</p>
        <a href="/login" style={{ background: TEAL, color: '#0f1117', borderRadius: 12, padding: '12px 28px', fontWeight: 700, textDecoration: 'none' }}>Sign In</a>
      </div>
    );
  }

  const isPractitioner = profile?.role === 'practitioner';

  return (
    <div style={{ minHeight: '100vh', background: '#0f1117', color: '#fff', fontFamily: 'sans-serif' }}>

      {/* Patient-only nav (practitioners get NavShell from layout) */}
      {!isPractitioner && (
        <nav style={{ borderBottom: '1px solid rgba(255,255,255,0.1)', padding: '16px 32px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <a href="/profile" style={{ color: TEAL, fontWeight: 800, fontSize: 20, textDecoration: 'none' }}>LiftLog</a>
          <button onClick={handleSignOut} style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)', color: 'rgba(255,255,255,0.6)', borderRadius: 10, padding: '8px 16px', fontSize: 13, cursor: 'pointer' }}>Sign Out</button>
        </nav>
      )}

      <main style={{ maxWidth: 900, margin: '0 auto', padding: '40px 32px' }}>

        {/* Profile card */}
        <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 20, padding: '32px', marginBottom: 32, display: 'flex', alignItems: 'center', gap: 24 }}>
          <div style={{ width: 72, height: 72, borderRadius: '50%', background: isPractitioner ? `${PURPLE}33` : `${TEAL}33`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28, flexShrink: 0, overflow: 'hidden' }}>
            {profile?.avatar_url
              ? <img src={profile.avatar_url} alt={profile.display_name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              : (isPractitioner ? '🩺' : '🏋️')}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
              <h1 style={{ fontSize: 24, fontWeight: 800, margin: '0 0 4px' }}>{profile?.display_name}</h1>
              <button onClick={handleSignOut} style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.15)', color: 'rgba(255,255,255,0.55)', borderRadius: 8, padding: '6px 14px', fontSize: 13, cursor: 'pointer', flexShrink: 0 }}>Sign Out</button>
            </div>
            <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 14, margin: '0 0 12px' }}>{profile?.email}</p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ background: isPractitioner ? `${PURPLE}22` : `${TEAL}22`, color: isPractitioner ? PURPLE : TEAL, padding: '4px 12px', borderRadius: 999, fontSize: 12, fontWeight: 700 }}>
                {isPractitioner ? 'Practitioner' : 'Patient'}
              </span>
              {isPractitioner && (
                <span style={{ background: profile?.approved ? `${TEAL}22` : `${YELLOW}22`, color: profile?.approved ? TEAL : YELLOW, padding: '4px 12px', borderRadius: 999, fontSize: 12, fontWeight: 700 }}>
                  {profile?.approved ? 'Approved' : 'Pending Approval'}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Connections */}
        <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 20, overflow: 'hidden' }}>
          <div style={{ padding: '20px 28px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
            <h2 style={{ fontWeight: 700, fontSize: 18, margin: 0 }}>
              {isPractitioner ? `My Patients (${patients.length})` : `My Practitioners (${practitioners.length})`}
            </h2>
          </div>

          {(isPractitioner ? patients : practitioners).length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center' }}>
              <p style={{ color: 'rgba(255,255,255,0.3)', marginBottom: 16 }}>
                {isPractitioner
                  ? 'No patients linked yet. Share your invite code in the LiftLog app.'
                  : 'No practitioners linked yet. Use the LiftLog app to connect with a practitioner.'}
              </p>
              <a href="https://apps.apple.com/app/id6762567982" target="_blank" rel="noopener noreferrer"
                style={{ background: TEAL, color: '#0f1117', borderRadius: 12, padding: '12px 28px', fontWeight: 700, textDecoration: 'none', fontSize: 14 }}>
                Open LiftLog App
              </a>
            </div>
          ) : (
            <div>
              {(isPractitioner ? patients : practitioners).map((person, i) => (
                <div key={person.id} style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '16px 28px', borderTop: i > 0 ? '1px solid rgba(255,255,255,0.06)' : 'none' }}>
                  <div style={{ width: 40, height: 40, borderRadius: '50%', background: isPractitioner ? `${TEAL}22` : `${PURPLE}22`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, flexShrink: 0 }}>
                    {isPractitioner ? '🏋️' : '🩺'}
                  </div>
                  <div>
                    <p style={{ fontWeight: 600, margin: '0 0 2px' }}>{person.display_name}</p>
                    <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13, margin: 0 }}>{person.email}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Practitioner utilities */}
        {isPractitioner && (
          <div style={{ marginTop: 28, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 16, padding: '20px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
            <div>
              <p style={{ fontWeight: 700, fontSize: 15, margin: '0 0 3px' }}>Bulk Import Patients</p>
              <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13, margin: 0 }}>Import multiple patients at once from a file.</p>
            </div>
            <a href="/import" style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.15)', color: 'rgba(255,255,255,0.7)', borderRadius: 10, padding: '9px 20px', fontWeight: 700, textDecoration: 'none', fontSize: 13, whiteSpace: 'nowrap' }}>
              Import Patients
            </a>
          </div>
        )}

        {/* Patient quick actions */}
        {!isPractitioner && (
          <div style={{ marginTop: 32, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 14 }}>
            <div style={{ background: `${TEAL}11`, border: `1px solid ${TEAL}33`, borderRadius: 20, padding: '24px 28px', display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <p style={{ fontWeight: 700, fontSize: 16, margin: '0 0 4px' }}>Log a Workout</p>
                <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 14, margin: 0 }}>Record your session from your computer.</p>
              </div>
              <a href="/log" style={{ background: TEAL, color: '#0f1117', borderRadius: 12, padding: '10px 20px', fontWeight: 700, textDecoration: 'none', fontSize: 14, textAlign: 'center' }}>
                Log Workout
              </a>
            </div>
            <div style={{ background: `${PURPLE}11`, border: `1px solid ${PURPLE}33`, borderRadius: 20, padding: '24px 28px', display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <p style={{ fontWeight: 700, fontSize: 16, margin: '0 0 4px' }}>My Plans</p>
                <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 14, margin: 0 }}>View plans assigned by your practitioner.</p>
              </div>
              <a href="/my-plans" style={{ background: PURPLE, color: '#fff', borderRadius: 12, padding: '10px 20px', fontWeight: 700, textDecoration: 'none', fontSize: 14, textAlign: 'center' }}>
                View Plans
              </a>
            </div>
            <div style={{ background: `${YELLOW}0d`, border: `1px solid ${YELLOW}30`, borderRadius: 20, padding: '24px 28px', display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <p style={{ fontWeight: 700, fontSize: 16, margin: '0 0 4px' }}>Progress</p>
                <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 14, margin: 0 }}>Track your consistency, strength gains, and workout history.</p>
              </div>
              <a href="/progress" style={{ background: YELLOW, color: '#0f1117', borderRadius: 12, padding: '10px 20px', fontWeight: 700, textDecoration: 'none', fontSize: 14, textAlign: 'center' }}>
                View Progress
              </a>
            </div>
            <div style={{ background: `${PURPLE}0d`, border: `1px solid ${PURPLE}30`, borderRadius: 20, padding: '24px 28px', display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <p style={{ fontWeight: 700, fontSize: 16, margin: '0 0 4px' }}>Friends</p>
                <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 14, margin: 0 }}>View friend activity, react to workouts, and add new friends.</p>
              </div>
              <a href="/friends" style={{ background: PURPLE, color: '#fff', borderRadius: 12, padding: '10px 20px', fontWeight: 700, textDecoration: 'none', fontSize: 14, textAlign: 'center' }}>
                View Friends
              </a>
            </div>
          </div>
        )}

        {/* App CTA */}
        <div style={{ marginTop: 32, background: `${TEAL}11`, border: `1px solid ${TEAL}33`, borderRadius: 20, padding: '24px 28px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
          <div>
            <p style={{ fontWeight: 700, fontSize: 16, margin: '0 0 4px' }}>Full experience on mobile</p>
            <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 14, margin: 0 }}>Log workouts, track progress, and connect with your team on the LiftLog app.</p>
          </div>
          <a href="https://apps.apple.com/app/id6762567982" target="_blank" rel="noopener noreferrer"
            style={{ background: TEAL, color: '#0f1117', borderRadius: 12, padding: '12px 24px', fontWeight: 700, textDecoration: 'none', fontSize: 14, whiteSpace: 'nowrap' }}>
            Download App
          </a>
        </div>

      </main>
    </div>
  );
}
