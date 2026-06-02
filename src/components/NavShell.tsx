'use client';

import { useEffect, useState } from 'react';
import { getSupabase } from '@/lib/supabase';
import PractitionerNav from './PractitionerNav';
import PatientNav from './PatientNav';

type NavRole = 'pract' | 'patient' | null;

export default function NavShell() {
  const [role, setRole] = useState<NavRole>(null);

  useEffect(() => {
    getSupabase().auth.getSession().then(async ({ data }) => {
      if (!data.session) {
        localStorage.removeItem('ll_pract');
        localStorage.removeItem('ll_patient');
        setRole(null);
        return;
      }
      const { data: prof } = await getSupabase()
        .from('profiles').select('role, is_gym_owner').eq('id', data.session.user.id).single();

      if (prof?.role === 'practitioner' || !!prof?.is_gym_owner) {
        localStorage.setItem('ll_pract', '1');
        localStorage.removeItem('ll_patient');
        setRole('pract');
      } else if (prof?.role === 'patient') {
        localStorage.setItem('ll_patient', '1');
        localStorage.removeItem('ll_pract');
        setRole('patient');
      } else {
        localStorage.removeItem('ll_pract');
        localStorage.removeItem('ll_patient');
        setRole(null);
      }
    });
  }, []);

  if (role === 'pract')   return <PractitionerNav />;
  if (role === 'patient') return <PatientNav />;
  return null;
}
