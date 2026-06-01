'use client';

import { usePathname, useRouter } from 'next/navigation';

const TEAL = '#5fcfbf';

const NAV_ITEMS = [
  { href: '/profile',  label: 'Profile',     icon: '👤' },
  { href: '/log',      label: 'Log Workout', icon: '📅' },
  { href: '/my-plans', label: 'My Plans',    icon: '📋' },
  { href: '/progress', label: 'Progress',    icon: '📊' },
  { href: '/friends',  label: 'Friends',     icon: '👥' },
];

export default function PatientNav() {
  const router   = useRouter();
  const pathname = usePathname();

  const isActive = (href: string) => pathname.startsWith(href);

  return (
    <nav style={{
      borderBottom: '1px solid var(--border)',
      padding: '0 32px',
      display: 'flex',
      alignItems: 'center',
      background: 'var(--bg)',
      position: 'sticky',
      top: 0,
      zIndex: 100,
      height: 56,
    }}>
      <a href="/" style={{ color: TEAL, fontWeight: 800, fontSize: 18, textDecoration: 'none', marginRight: 16 }}>
        LiftLog
      </a>
      {NAV_ITEMS.map(item => (
        <button
          key={item.href}
          onClick={() => router.push(item.href)}
          style={{
            background: 'none',
            border: 'none',
            borderBottom: isActive(item.href) ? `2px solid ${TEAL}` : '2px solid transparent',
            padding: '0 12px',
            height: 56,
            cursor: 'pointer',
            color: isActive(item.href) ? TEAL : 'var(--text)',
            fontSize: 13,
            fontWeight: isActive(item.href) ? 700 : 400,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            transition: 'color 0.15s, border-color 0.15s',
            whiteSpace: 'nowrap',
          }}
        >
          <span style={{ fontSize: 15 }}>{item.icon}</span>
          {item.label}
        </button>
      ))}
    </nav>
  );
}
