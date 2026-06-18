'use client';

import { useEffect, useState } from 'react';
import { getSupabase } from '@/lib/supabase';
import PractitionerNav from './PractitionerNav';
import PatientNav from './PatientNav';
import MasterNav from './MasterNav';

const MASTER_ID = process.env.NEXT_PUBLIC_FEATURED_PRACTITIONER_ID ?? '';

type NavRole = 'master' | 'pract' | 'patient' | null;

export default function NavShell() {
  const [role,       setRole]       = useState<NavRole>(null);
  const [isEmployer, setIsEmployer] = useState(false);

  useEffect(() => {
    const supabase = getSupabase();

    const resolveRole = async (session: { user: { id: string } } | null) => {
      if (!session) {
        localStorage.removeItem('ll_pract');
        localStorage.removeItem('ll_patient');
        setRole(null);
        return;
      }
      const { data: prof } = await supabase
        .from('profiles').select('role, is_gym_owner, is_employer').eq('id', session.user.id).single();

      if (prof?.role === 'practitioner' || !!prof?.is_gym_owner) {
        localStorage.setItem('ll_pract', '1');
        localStorage.removeItem('ll_patient');
        if (session.user.id === MASTER_ID) {
          setRole('master');
        } else {
          setIsEmployer(!!(prof as any)?.is_employer);
          setRole('pract');
        }
      } else if (prof?.role === 'patient') {
        localStorage.setItem('ll_patient', '1');
        localStorage.removeItem('ll_pract');
        setRole('patient');
      } else {
        localStorage.removeItem('ll_pract');
        localStorage.removeItem('ll_patient');
        setRole(null);
      }
    };

    supabase.auth.getSession().then(({ data }) => resolveRole(data.session));

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      resolveRole(session);
    });

    return () => subscription.unsubscribe();
  }, []);

  if (role === 'master')  return <MasterNav />;
  if (role === 'pract')   return <PractitionerNav isEmployer={isEmployer} />;
  if (role === 'patient') return <PatientNav />;
  return null;
}
