'use client';
import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';

function ResetPasswordContent() {
  const searchParams = useSearchParams();
  const code = searchParams.get('code');
  const [showFallback, setShowFallback] = useState(false);
  const [appLink, setAppLink] = useState<string | null>(null);

  useEffect(() => {
    // PKCE flow: Supabase puts the auth code in ?code= (query param)
    if (code) {
      const link = `liftlog://reset-password?code=${encodeURIComponent(code)}`;
      setAppLink(link);
      window.location.href = link;
      const t = setTimeout(() => setShowFallback(true), 2500);
      return () => clearTimeout(t);
    }
    // Implicit-flow fallback: Supabase puts tokens in the URL fragment (#)
    // which never reaches the server but is readable client-side.
    const hash = window.location.hash; // e.g. "#access_token=...&type=recovery"
    if (hash && hash.length > 1) {
      const link = `liftlog://reset-password${hash}`;
      setAppLink(link);
      window.location.href = link;
      const t = setTimeout(() => setShowFallback(true), 2500);
      return () => clearTimeout(t);
    }
    setShowFallback(true);
  }, [code]);

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'var(--bg)',
      padding: '24px',
    }}>
      <div style={{
        background: 'var(--modal-bg)',
        border: '1px solid var(--border)',
        borderRadius: '16px',
        padding: '48px 40px',
        maxWidth: '420px',
        width: '100%',
        textAlign: 'center',
      }}>
        {/* LiftLog wordmark */}
        <div style={{ fontSize: '22px', fontWeight: 700, color: '#5fcfbf', marginBottom: '32px', letterSpacing: '-0.5px' }}>
          LiftLog
        </div>

        {!showFallback ? (
          <>
            <div style={{
              width: '48px', height: '48px', borderRadius: '50%',
              border: '3px solid var(--border)', borderTopColor: '#5fcfbf',
              animation: 'spin 0.8s linear infinite', margin: '0 auto 24px',
            }} />
            <p style={{ color: 'var(--text-muted)', fontSize: '15px', margin: 0 }}>
              Opening LiftLog&hellip;
            </p>
          </>
        ) : appLink ? (
          <>
            <div style={{ fontSize: '24px', marginBottom: '16px' }}>📱</div>
            <h1 style={{ color: 'var(--text)', fontSize: '18px', fontWeight: 600, margin: '0 0 12px' }}>
              Open LiftLog to Reset Your Password
            </h1>
            <p style={{ color: 'var(--text-muted)', fontSize: '14px', lineHeight: '1.6', margin: '0 0 28px' }}>
              This link is designed for the LiftLog mobile app. Please open it on your phone, or tap the button below.
            </p>
            <a
              href={appLink}
              style={{
                display: 'block',
                background: 'rgba(95,207,191,0.13)',
                color: '#5fcfbf',
                border: '1px solid rgba(95,207,191,0.40)',
                borderRadius: '10px',
                padding: '13px 24px',
                fontSize: '15px',
                fontWeight: 600,
                textDecoration: 'none',
                marginBottom: '12px',
              }}
            >
              Open LiftLog App
            </a>
            <p style={{ color: 'var(--text-faint)', fontSize: '12px', margin: 0 }}>
              If you don&apos;t have LiftLog installed, download it from the App Store.
            </p>
          </>
        ) : (
          <>
            <div style={{ fontSize: '24px', marginBottom: '12px' }}>⚠️</div>
            <h1 style={{ color: 'var(--text)', fontSize: '18px', fontWeight: 600, margin: '0 0 12px' }}>
              Invalid Reset Link
            </h1>
            <p style={{ color: 'var(--text-muted)', fontSize: '14px', lineHeight: '1.6', margin: 0 }}>
              This password reset link is invalid or has expired. Please request a new one from the LiftLog app.
            </p>
          </>
        )}
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)' }}>
        <p style={{ color: 'var(--text-muted)' }}>Loading&hellip;</p>
      </div>
    }>
      <ResetPasswordContent />
    </Suspense>
  );
}
