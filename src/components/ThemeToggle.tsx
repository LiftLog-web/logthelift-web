'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTheme } from '@/lib/ThemeContext';
import { getSupabase } from '@/lib/supabase';

export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const isDark = theme === 'dark';
  const router = useRouter();
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    const sb = getSupabase();
    sb.auth.getSession().then(({ data }) => setSignedIn(!!data.session));
    const { data: { subscription } } = sb.auth.onAuthStateChange((_event, session) => {
      setSignedIn(!!session);
    });
    return () => subscription.unsubscribe();
  }, []);

  async function handleSignOut() {
    const sb = getSupabase();
    await sb.auth.signOut();
    router.push('/login');
  }

  const pillStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    padding: '5px 12px',
    background: isDark ? 'rgba(255,255,255,0.09)' : '#ffffff',
    border: `1px solid ${isDark ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.22)'}`,
    boxShadow: isDark ? 'none' : '0 1px 4px rgba(0,0,0,0.10)',
    borderRadius: 999,
    cursor: 'pointer',
    fontFamily: 'sans-serif',
    backdropFilter: 'blur(8px)',
    WebkitBackdropFilter: 'blur(8px)',
    transition: 'background 0.2s, border 0.2s',
  };

  return (
    <div style={{ position: 'fixed', top: 14, right: 20, zIndex: 9999, display: 'flex', alignItems: 'center', gap: 8 }}>
      {signedIn && (
        <button
          onClick={handleSignOut}
          style={{
            ...pillStyle,
            color: isDark ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.6)',
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          Sign Out
        </button>
      )}

      <button
        onClick={toggle}
        aria-label="Toggle light/dark mode"
        title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
        style={{ ...pillStyle, gap: 7, paddingLeft: 9 }}
      >
        {/* Moon */}
        <svg width="14" height="14" viewBox="0 0 24 24" fill={isDark ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.6)'} style={{ flexShrink: 0 }}>
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
        </svg>

        {/* Pill switch track */}
        <div style={{
          width: 36, height: 20, borderRadius: 999,
          background: isDark ? 'rgba(255,255,255,0.18)' : '#5fcfbf',
          position: 'relative', transition: 'background 0.25s', flexShrink: 0,
        }}>
          <div style={{
            position: 'absolute', top: 3, left: isDark ? 3 : 17,
            width: 14, height: 14, borderRadius: '50%', background: '#fff',
            boxShadow: '0 1px 4px rgba(0,0,0,0.25)',
            transition: 'left 0.22s cubic-bezier(.4,0,.2,1)',
          }} />
        </div>

        {/* Sun */}
        <svg width="14" height="14" viewBox="0 0 24 24" fill={isDark ? 'rgba(255,255,255,0.35)' : '#5fcfbf'} style={{ flexShrink: 0 }}>
          <circle cx="12" cy="12" r="5"/>
          <line x1="12" y1="1" x2="12" y2="3" stroke={isDark ? 'rgba(255,255,255,0.35)' : '#5fcfbf'} strokeWidth="2" strokeLinecap="round"/>
          <line x1="12" y1="21" x2="12" y2="23" stroke={isDark ? 'rgba(255,255,255,0.35)' : '#5fcfbf'} strokeWidth="2" strokeLinecap="round"/>
          <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" stroke={isDark ? 'rgba(255,255,255,0.35)' : '#5fcfbf'} strokeWidth="2" strokeLinecap="round"/>
          <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" stroke={isDark ? 'rgba(255,255,255,0.35)' : '#5fcfbf'} strokeWidth="2" strokeLinecap="round"/>
          <line x1="1" y1="12" x2="3" y2="12" stroke={isDark ? 'rgba(255,255,255,0.35)' : '#5fcfbf'} strokeWidth="2" strokeLinecap="round"/>
          <line x1="21" y1="12" x2="23" y2="12" stroke={isDark ? 'rgba(255,255,255,0.35)' : '#5fcfbf'} strokeWidth="2" strokeLinecap="round"/>
          <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" stroke={isDark ? 'rgba(255,255,255,0.35)' : '#5fcfbf'} strokeWidth="2" strokeLinecap="round"/>
          <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" stroke={isDark ? 'rgba(255,255,255,0.35)' : '#5fcfbf'} strokeWidth="2" strokeLinecap="round"/>
        </svg>
      </button>
    </div>
  );
}
