'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useNavGuard } from '@/lib/NavGuardContext';

const TEAL = '#5fcfbf';

const NAV_ITEMS = [
  { href: '/plans',         label: 'Patients',     icon: '📋' },
  { href: '/plans/library', label: 'Plan Library',  icon: '📚' },
  { href: '/media-library', label: 'Video Library', icon: '🎬' },
  { href: '/profile',       label: 'Profile',       icon: '👤' },
];

export default function PractitionerNav({ rightSlot }: { rightSlot?: React.ReactNode }) {
  const router    = useRouter();
  const pathname  = usePathname();
  const { guardFn } = useNavGuard();

  const isActive = (href: string) => {
    if (href === '/plans') return pathname === '/plans' || pathname.startsWith('/plans/new');
    return pathname.startsWith(href);
  };

  return (
    <nav style={{
      borderBottom: '1px solid var(--border)',
      padding: '0 32px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      background: 'var(--bg)',
      position: 'sticky',
      top: 0,
      zIndex: 100,
      height: 56,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <a href="/" style={{ color: TEAL, fontWeight: 800, fontSize: 18, textDecoration: 'none', marginRight: 16 }}>
          LiftLog
        </a>
        {NAV_ITEMS.map(item => (
          <button
            key={item.href}
            onClick={() => guardFn ? guardFn(item.href) : router.push(item.href)}
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
      </div>

      {rightSlot && (
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {rightSlot}
        </div>
      )}
    </nav>
  );
}
