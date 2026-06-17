'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useNavGuard } from '@/lib/NavGuardContext';
import PatientsIcon from './icons/PatientsIcon';
import TeamMembersIcon from './icons/TeamMembersIcon';
import PlanLibraryIcon from './icons/PlanLibraryIcon';
import VideoLibraryIcon from './icons/VideoLibraryIcon';
import ProfileIcon from './icons/ProfileIcon';

const PURPLE = '#C471ED';

export default function PractitionerNav({ rightSlot, isEmployer = false }: { rightSlot?: React.ReactNode; isEmployer?: boolean }) {
  const router    = useRouter();
  const pathname  = usePathname();
  const { guardFn } = useNavGuard();

  const NAV_ITEMS = [
    { href: '/plans',         label: isEmployer ? 'Team Members' : 'Patients',    Icon: isEmployer ? TeamMembersIcon : PatientsIcon },
    { href: '/plans/library', label: 'Plan Library',  Icon: PlanLibraryIcon },
    { href: '/media-library', label: 'Video Library', Icon: VideoLibraryIcon },
    { href: '/profile',       label: 'Profile',       Icon: ProfileIcon },
  ];

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
        <a href="/" style={{ color: PURPLE, fontWeight: 800, fontSize: 18, textDecoration: 'none', marginRight: 16 }}>
          LiftLog
        </a>
        {NAV_ITEMS.map(item => (
          <button
            key={item.href}
            onClick={() => guardFn ? guardFn(item.href) : router.push(item.href)}
            style={{
              background: 'none',
              border: 'none',
              borderBottom: isActive(item.href) ? `2px solid ${PURPLE}` : '2px solid transparent',
              padding: '0 12px',
              height: 56,
              cursor: 'pointer',
              color: isActive(item.href) ? PURPLE : 'var(--text)',
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

      {rightSlot && (
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {rightSlot}
        </div>
      )}
    </nav>
  );
}
