'use client';

import { usePathname, useRouter } from 'next/navigation';
import { getSupabase } from '@/lib/supabase';
import DashboardIcon from './icons/DashboardIcon';
import ProgramsIcon from './icons/ProgramsIcon';
import ClientsIcon from './icons/ClientsIcon';

const TEAL   = '#5fcfbf';
const PURPLE = '#C471ED';

const NAV_ITEMS = [
  { href: '/master/dashboard', label: 'Dashboard', Icon: DashboardIcon },
  { href: '/master/programs',  label: 'Programs',  Icon: ProgramsIcon  },
  { href: '/master/clients',   label: 'Clients',   Icon: ClientsIcon   },
];

export default function MasterNav() {
  const router   = useRouter();
  const pathname = usePathname();

  const isActive = (href: string) => pathname.startsWith(href);

  const handleSignOut = async () => {
    await getSupabase().auth.signOut();
    router.push('/login');
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
            onClick={() => router.push(item.href)}
            style={{
              background: 'none',
              border: 'none',
              borderBottom: isActive(item.href) ? `2px solid ${PURPLE}` : '2px solid transparent',
              padding: '0 12px',
              height: 56,
              cursor: 'pointer',
              color: isActive(item.href) ? 'var(--nav-active)' : 'var(--nav-inactive)',
              fontSize: 14,
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              transition: 'color 0.15s, border-color 0.15s',
              whiteSpace: 'nowrap',
            }}
          >
            <item.Icon size={24} />
            {item.label}
          </button>
        ))}
      </div>

      <button
        onClick={handleSignOut}
        style={{ background: 'none', border: '1px solid var(--border-strong)', borderRadius: 8, padding: '6px 14px', color: 'var(--text-muted)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
      >
        Sign Out
      </button>
    </nav>
  );
}
