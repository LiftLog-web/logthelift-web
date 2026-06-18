'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { getSupabase } from '@/lib/supabase';

const TEAL   = '#5fcfbf';
const YELLOW = '#F9F295';

export default function PendingPage() {
  const searchParams = useSearchParams();
  const [companyName, setCompanyName] = useState(searchParams.get('company') ?? '');

  useEffect(() => {
    if (companyName) return;
    getSupabase().auth.getSession().then(async ({ data }) => {
      if (!data.session) return;
      const { data: prof } = await getSupabase()
        .from('profiles')
        .select('company_name')
        .eq('id', data.session.user.id)
        .single();
      setCompanyName((prof as any)?.company_name ?? '');
    });
  }, []);

  async function handleSignOut() {
    await getSupabase().auth.signOut();
    window.location.href = '/login';
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <a href="/" style={{ color: TEAL, fontWeight: 800, fontSize: 24, textDecoration: 'none', marginBottom: 40 }}>LiftLog</a>

      <div style={{ width: '100%', maxWidth: 480, background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 24, padding: 40, textAlign: 'center' }}>
        <div style={{ fontSize: 52, marginBottom: 16 }}>⏳</div>
        <h1 style={{ fontSize: 22, fontWeight: 800, margin: '0 0 12px', color: 'var(--text)' }}>
          Application Under Review
        </h1>
        {companyName ? (
          <p style={{ color: 'var(--text-muted)', fontSize: 15, lineHeight: 1.6, margin: '0 0 24px' }}>
            Thanks for applying{' '}
            <strong style={{ color: YELLOW }}>{companyName}</strong>! We're reviewing your account and will be in touch within 24 hours.
          </p>
        ) : (
          <p style={{ color: 'var(--text-muted)', fontSize: 15, lineHeight: 1.6, margin: '0 0 24px' }}>
            Thanks for applying! We're reviewing your account and will be in touch within 24 hours.
          </p>
        )}
        <p style={{ color: 'var(--text-muted)', fontSize: 14, margin: '0 0 32px' }}>
          Questions? Email us at{' '}
          <a href="mailto:logthelift@gmail.com" style={{ color: TEAL, fontWeight: 600 }}>logthelift@gmail.com</a>
        </p>
        <button
          onClick={handleSignOut}
          style={{ background: 'transparent', border: '1px solid var(--border-strong)', borderRadius: 10, padding: '10px 24px', color: 'var(--text-muted)', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
        >
          Sign Out
        </button>
      </div>
    </div>
  );
}
