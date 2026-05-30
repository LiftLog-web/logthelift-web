'use client';

import { useEffect, useState } from 'react';
import { getSupabase } from '@/lib/supabase';
import PractitionerNav from './PractitionerNav';

export default function NavShell() {
  const [show, setShow] = useState(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem('ll_pract') === '1';
  });

  useEffect(() => {
    if (localStorage.getItem('ll_pract') === '1') setShow(true);

    getSupabase().auth.getSession().then(async ({ data }) => {
      if (!data.session) { localStorage.removeItem('ll_pract'); setShow(false); return; }
      const { data: prof } = await getSupabase()
        .from('profiles').select('role, is_gym_owner').eq('id', data.session.user.id).single();
      const ok = prof?.role === 'practitioner' || !!prof?.is_gym_owner;
      if (ok) { localStorage.setItem('ll_pract', '1'); setShow(true); }
      else     { localStorage.removeItem('ll_pract');  setShow(false); }
    });
  }, []);

  if (!show) return null;
  return <PractitionerNav />;
}
