'use client';

export const dynamic = 'force-dynamic';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { getSupabase } from '@/lib/supabase';

const TEAL   = '#5fcfbf';
const PURPLE = '#C471ED';

type Tab = 'signin' | 'signup';

export default function LoginPage() {
  const router = useRouter();
  const [tab, setTab]           = useState<Tab>('signin');
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [name, setName]         = useState('');
  const [role, setRole]         = useState<'patient' | 'practitioner'>('patient');
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');
  const [success, setSuccess]   = useState('');

  const resetForm = () => {
    setEmail(''); setPassword(''); setName(''); setError(''); setSuccess('');
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

    // Check if gym owner → dashboard, else → profile
    const { data: profile } = await supabase
      .from('profiles')
      .select('is_gym_owner')
      .eq('id', data.user.id)
      .single();

    if (profile?.is_gym_owner) {
      router.push('/dashboard');
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

    const supabase = getSupabase();
    const { data, error: err } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { display_name: name } },
    });

    if (err) {
      setError(err.message);
      setLoading(false);
      return;
    }

    if (data.user) {
      // Upsert profile row
      await supabase.from('profiles').upsert({
        id: data.user.id,
        display_name: name,
        role,
        email,
      });
    }

    setSuccess('Account created! Check your email to confirm your address, then sign in.');
    setLoading(false);
  };

  const inputStyle: React.CSSProperties = {
    background: 'var(--input-bg)',
    border: '1px solid var(--border-strong)',
    borderRadius: 12,
    padding: '12px 16px',
    color: 'var(--text)',
    fontSize: 15,
    outline: 'none',
    width: '100%',
    boxSizing: 'border-box',
  };

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
                flex: 1, padding: '10px 0', borderRadius: 10, border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 14, transition: 'all 0.2s',
                background: tab === t ? TEAL : 'transparent',
                color: tab === t ? '#0f1117' : 'rgba(255,255,255,0.5)',
              }}
            >
              {t === 'signin' ? 'Sign In' : 'Sign Up'}
            </button>
          ))}
        </div>

        {/* Sign In */}
        {tab === 'signin' && (
          <form onSubmit={handleSignIn} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <input type="email" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} required style={inputStyle} />
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
            <input type="text" placeholder="Full name" value={name} onChange={e => setName(e.target.value)} required style={inputStyle} />
            <input type="email" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} required style={inputStyle} />
            <input type="password" placeholder="Password (min 6 characters)" value={password} onChange={e => setPassword(e.target.value)} required minLength={6} style={inputStyle} />

            {/* Role selector */}
            <div>
              <p style={{ color: 'var(--text-muted)', fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 }}>I am a…</p>
              <div style={{ display: 'flex', gap: 10 }}>
                {(['patient', 'practitioner'] as const).map(r => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setRole(r)}
                    style={{
                      flex: 1, padding: '10px 0', borderRadius: 10, border: `1px solid ${role === r ? PURPLE : 'rgba(255,255,255,0.15)'}`,
                      background: role === r ? `${PURPLE}22` : 'transparent',
                      color: role === r ? PURPLE : 'rgba(255,255,255,0.5)',
                      fontWeight: 700, fontSize: 13, cursor: 'pointer',
                    }}
                  >
                    {r.charAt(0).toUpperCase() + r.slice(1)}
                  </button>
                ))}
              </div>
            </div>

            {error   && <p style={{ color: '#EF4444', fontSize: 13, margin: 0 }}>{error}</p>}
            {success && <p style={{ color: TEAL, fontSize: 13, margin: 0 }}>{success}</p>}

            {!success && (
              <button type="submit" disabled={loading} style={{ background: PURPLE, color: 'var(--text)', borderRadius: 12, padding: '13px 0', fontWeight: 700, fontSize: 15, border: 'none', cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.7 : 1 }}>
                {loading ? 'Creating account…' : 'Create Account'}
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
