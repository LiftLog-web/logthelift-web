'use client';

export const dynamic = 'force-dynamic';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { getSupabase } from '@/lib/supabase';

const TEAL   = '#5fcfbf';
const PURPLE = '#C471ED';
const YELLOW = '#F9F295';

type Tab  = 'signin' | 'signup';
type Role = 'patient' | 'practitioner' | 'business';
type BusinessType = 'gym' | 'employer';

export default function LoginPage() {
  const router = useRouter();
  const [tab,          setTab]          = useState<Tab>('signin');
  const [email,        setEmail]        = useState('');
  const [password,     setPassword]     = useState('');
  const [name,         setName]         = useState('');
  const [role,         setRole]         = useState<Role>('patient');
  const [companyName,  setCompanyName]  = useState('');
  const [businessType, setBusinessType] = useState<BusinessType>('employer');
  const [loading,      setLoading]      = useState(false);
  const [error,        setError]        = useState('');
  const [success,      setSuccess]      = useState('');

  const resetForm = () => {
    setEmail(''); setPassword(''); setName(''); setCompanyName('');
    setError(''); setSuccess(''); setRole('patient'); setBusinessType('employer');
  };

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    const supabase = getSupabase();
    const { data, error: err } = await supabase.auth.signInWithPassword({ email, password });

    if (err || !data.user) {
      setError('Invalid email or password.');
      setLoading(false);
      return;
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('role, is_gym_owner, is_employer, business_type')
      .eq('id', data.user.id)
      .single();

    if (profile?.is_gym_owner) {
      router.push('/dashboard');
    } else if ((profile as any)?.is_employer) {
      router.push('/plans');
    } else if ((profile as any)?.business_type && !profile?.is_gym_owner && !(profile as any)?.is_employer) {
      router.push('/pending');
    } else {
      router.push('/profile');
    }
    setLoading(false);
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    if (!name.trim()) {
      setError('Please enter your name.');
      setLoading(false);
      return;
    }

    if (role === 'business' && !companyName.trim()) {
      setError('Please enter your company or organization name.');
      setLoading(false);
      return;
    }

    try {
      const supabase = getSupabase();
      const { data, error: err } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { display_name: name } },
      });

      console.log('[signUp] raw data:', JSON.stringify(data));
      console.log('[signUp] raw error:', JSON.stringify(err));

      if (err) {
        setError(err.message);
        setLoading(false);
        return;
      }

      // Newer Supabase JS versions return user: null even for successful new signups
      // when email confirmation is pending — only block on actual errors above.
      if (data.user) {
        const profileRow: Record<string, unknown> = {
          id:           data.user.id,
          display_name: name,
          role:         role === 'business' ? 'practitioner' : role,
          email,
        };
        if (role === 'business') {
          profileRow.company_name  = companyName.trim();
          profileRow.business_type = businessType;
        }
        await supabase.from('profiles').upsert(profileRow);
      }

      if (role === 'business') {
        await fetch('/api/business-application', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ name, email, companyName: companyName.trim(), businessType }),
        });
        window.location.href = '/pending?company=' + encodeURIComponent(companyName.trim());
        return;
      }

      if (!data.user) {
        setError('This email is already registered. Please sign in instead.');
        setLoading(false);
        return;
      }

      setSuccess('Account created! Check your email to confirm your address, then sign in.');
    } catch (ex) {
      console.error('handleSignUp error:', ex);
      setError('Something went wrong. Please try again.');
    }

    setLoading(false);
  };

  const inputStyle: React.CSSProperties = {
    background:    'var(--input-bg)',
    border:        '1px solid var(--border-strong)',
    borderRadius:  12,
    padding:       '12px 16px',
    color:         'var(--text)',
    fontSize:      15,
    outline:       'none',
    width:         '100%',
    boxSizing:     'border-box',
  };

  const roles: { value: Role; label: string; color: string }[] = [
    { value: 'patient',       label: 'Patient',      color: PURPLE },
    { value: 'practitioner',  label: 'Practitioner', color: PURPLE },
    { value: 'business',      label: 'Business',     color: YELLOW },
  ];

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24 }}>

      {/* Logo */}
      <a href="/" style={{ color: TEAL, fontWeight: 800, fontSize: 24, textDecoration: 'none', marginBottom: 32 }}>LiftLog</a>

      <div style={{ width: '100%', maxWidth: 420, background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 24, padding: 40 }}>

        {/* Tabs */}
        <div style={{ display: 'flex', background: 'var(--card-alt)', borderRadius: 12, padding: 4, marginBottom: 32 }}>
          {(['signin', 'signup'] as Tab[]).map(t => (
            <button
              key={t}
              onClick={() => { setTab(t); resetForm(); }}
              style={{
                flex: 1, padding: '10px 0', borderRadius: 10, border: 'none', cursor: 'pointer',
                fontWeight: 700, fontSize: 14, transition: 'all 0.2s',
                background: tab === t ? TEAL : 'transparent',
                color:      tab === t ? '#0f1117' : PURPLE,
              }}
            >
              {t === 'signin' ? 'Sign In' : 'Sign Up'}
            </button>
          ))}
        </div>

        {/* Sign In */}
        {tab === 'signin' && (
          <form onSubmit={handleSignIn} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <input type="email"    placeholder="Email"    value={email}    onChange={e => setEmail(e.target.value)}    required style={inputStyle} />
            <input type="password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} required style={inputStyle} />
            {error && <p style={{ color: '#EF4444', fontSize: 13, margin: 0 }}>{error}</p>}
            <button type="submit" disabled={loading} style={{ background: TEAL, color: '#0f1117', borderRadius: 12, padding: '13px 0', fontWeight: 700, fontSize: 15, border: 'none', cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.7 : 1 }}>
              {loading ? 'Signing in…' : 'Sign In'}
            </button>
          </form>
        )}

        {/* Sign Up */}
        {tab === 'signup' && (
          <form onSubmit={handleSignUp} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <input type="text"     placeholder="Full name"               value={name}     onChange={e => setName(e.target.value)}     required style={inputStyle} />
            <input type="email"    placeholder="Email"                   value={email}    onChange={e => setEmail(e.target.value)}    required style={inputStyle} />
            <input type="password" placeholder="Password (min 6 characters)" value={password} onChange={e => setPassword(e.target.value)} required minLength={6} style={inputStyle} />

            {/* Role selector */}
            <div>
              <p style={{ color: 'var(--text-muted)', fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 }}>I am a…</p>
              <div style={{ display: 'flex', gap: 8 }}>
                {roles.map(r => (
                  <button
                    key={r.value}
                    type="button"
                    onClick={() => setRole(r.value)}
                    style={{
                      flex: 1, padding: '10px 0', borderRadius: 10,
                      border:      `1px solid ${role === r.value ? r.color : 'var(--border-strong)'}`,
                      background:  role === r.value ? r.color : 'transparent',
                      color:       role === r.value ? '#0f1117' : 'var(--text-muted)',
                      fontWeight:  700, fontSize: 12, cursor: 'pointer',
                    }}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Business extra fields */}
            {role === 'business' && (
              <>
                <input
                  type="text"
                  placeholder="Company or organization name"
                  value={companyName}
                  onChange={e => setCompanyName(e.target.value)}
                  required
                  style={inputStyle}
                />
                <div>
                  <p style={{ color: 'var(--text-muted)', fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 }}>Business type</p>
                  <div style={{ display: 'flex', gap: 8 }}>
                    {([
                      { value: 'employer', label: 'Corporate / Employer' },
                      { value: 'gym',      label: 'Gym / Studio' },
                    ] as { value: BusinessType; label: string }[]).map(bt => (
                      <button
                        key={bt.value}
                        type="button"
                        onClick={() => setBusinessType(bt.value)}
                        style={{
                          flex: 1, padding: '10px 0', borderRadius: 10,
                          border:     `1px solid ${businessType === bt.value ? YELLOW : 'var(--border-strong)'}`,
                          background: businessType === bt.value ? YELLOW : 'transparent',
                          color:      businessType === bt.value ? '#0f1117' : 'var(--text-muted)',
                          fontWeight: 700, fontSize: 12, cursor: 'pointer',
                        }}
                      >
                        {bt.label}
                      </button>
                    ))}
                  </div>
                </div>
                <p style={{ color: 'var(--text-muted)', fontSize: 12, margin: 0, lineHeight: 1.5 }}>
                  Business accounts are reviewed before activation. We'll be in touch within 24 hours.
                </p>
              </>
            )}

            {error   && <p style={{ color: '#EF4444', fontSize: 13, margin: 0 }}>{error}</p>}
            {success && <p style={{ color: TEAL,     fontSize: 13, margin: 0 }}>{success}</p>}

            {!success && (
              <button
                type="submit"
                disabled={loading}
                style={{
                  background: role === 'business' ? YELLOW : PURPLE,
                  color:      role === 'business' ? '#0f1117' : 'var(--text)',
                  borderRadius: 12, padding: '13px 0', fontWeight: 700, fontSize: 15,
                  border: 'none', cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.7 : 1,
                }}
              >
                {loading
                  ? (role === 'business' ? 'Submitting…' : 'Creating account…')
                  : (role === 'business' ? 'Submit Application' : 'Create Account')}
              </button>
            )}
          </form>
        )}

        <p style={{ textAlign: 'center', color: 'var(--text-dim)', fontSize: 13, marginTop: 24, marginBottom: 0 }}>
          New to LiftLog?{' '}
          <a href="https://apps.apple.com/app/id6762567982" target="_blank" rel="noopener noreferrer" style={{ color: TEAL }}>Download the app</a>
        </p>
      </div>
    </div>
  );
}
