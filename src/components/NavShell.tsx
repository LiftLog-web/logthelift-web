'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { getSupabase } from '@/lib/supabase';
import PractitionerNav from './PractitionerNav';

// Top-level pages that use the shared nav
const NAV_PAGES = ['/plans', '/plans/library', '/exercises', '/media-library', '/import', '/profile'];

// Editor/detail pages that have their own full nav — exclude them
function isEditorPage(pathname: string) {
  return (
    pathname === '/plans/new' ||
    pathname.startsWith('/plans/new?') ||
    (pathname.startsWith('/plans/library/') && pathname !== '/plans/library') ||
    /^\/patients\/[^/]+/.test(pathname)
  );
}

function shouldShowNav(pathname: string) {
  if (isEditorPage(pathname)) return false;
  const base = pathname.split('?')[0];
  return NAV_PAGES.includes(base);
}

export default function NavShell() {
  const pathname = usePathname();
  const onNavPage = shouldShowNav(pathname);

  const [show, setShow] = useState(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem('ll_pract') === '1' && shouldShowNav(window.location.pathname);
  });

  useEffect(() => {
    if (!onNavPage) { setShow(false); return; }

    if (localStorage.getItem('ll_pract') === '1') setShow(true);

    getSupabase().auth.getSession().then(async ({ data }) => {
      if (!data.session) { localStorage.removeItem('ll_pract'); setShow(false); return; }
      const { data: prof } = await getSupabase()
        .from('profiles').select('role, is_gym_owner').eq('id', data.session.user.id).single();
      const ok = prof?.role === 'practitioner' || !!prof?.is_gym_owner;
      if (ok) { localStorage.setItem('ll_pract', '1'); setShow(true); }
      else     { localStorage.removeItem('ll_pract');  setShow(false); }
    });
  }, [onNavPage]);

  if (!show) return null;
  return <PractitionerNav />;
}
