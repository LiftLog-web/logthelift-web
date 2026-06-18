'use client';

import { usePathname, useRouter } from 'next/navigation';
import ProfileIcon from './icons/ProfileIcon';
import LogWorkoutIcon from './icons/LogWorkoutIcon';
import MyPlansIcon from './icons/MyPlansIcon';
import ProgressIcon from './icons/ProgressIcon';
import TeamMembersIcon from './icons/TeamMembersIcon';

const TEAL   = '#5fcfbf';
const PURPLE = '#C471ED';

const NAV_ITEMS = [
  { href: '/profile',  label: 'Profile',     Icon: ProfileIcon     },
  { href: '/log',      label: 'Log Workout', Icon: LogWorkoutIcon  },
  { href: '/my-plans', label: 'My Plans',    Icon: MyPlansIcon     },
  { href: '/progress', label: 'Progress',    Icon: ProgressIcon    },
  { href: '/friends',  label: 'Friends',     Icon: TeamMembersIcon },
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
    </nav>
  );
}
