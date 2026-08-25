'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getSupabase } from '@/lib/supabase';

type AlertItem = {
  type: 'inactive' | 'no_plan' | 'multiple_plans';
  patient_id: string;
  patientName: string;
  message: string;
};

const STORAGE_KEY = 'll-notif-dismissed';

const LABEL: Record<AlertItem['type'], string> = {
  no_plan:        'No plan assigned',
  multiple_plans: 'Multiple active plans',
  inactive:       'Inactive',
};

const DOT_COLOR: Record<AlertItem['type'], string> = {
  no_plan:        '#ef4444',
  multiple_plans: '#f97316',
  inactive:       '#eab308',
};

export default function NotificationBell({ userId }: { userId: string }) {
  const [items, setItems]   = useState<AlertItem[]>([]);
  const [open, setOpen]     = useState(false);
  const [badge, setBadge]   = useState(0);
  const ref                 = useRef<HTMLDivElement>(null);
  const router              = useRouter();

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const sb = getSupabase();

      const [profRes, linkedRes, plansRes] = await Promise.all([
        sb.from('profiles').select('inactivity_threshold_days').eq('id', userId).single(),
        sb.from('patient_links')
          .select('patient_id, patient:patient_id(display_name)')
          .eq('practitioner_id', userId)
          .is('unlinked_at', null),
        sb.from('workout_plans').select('patient_id').eq('practitioner_id', userId),
      ]);

      if (cancelled) return;

      const threshold  = (profRes.data as any)?.inactivity_threshold_days ?? 7;
      const linked     = linkedRes.data ?? [];
      const plans      = plansRes.data ?? [];

      if (!linked.length) return;

      const allLinkedIds = linked.map((l: any) => l.patient_id as string);
      const nameMap = new Map(linked.map((l: any) => {
        const patient = Array.isArray(l.patient) ? l.patient[0] : l.patient;
        return [l.patient_id as string, (patient?.display_name ?? 'Unknown') as string];
      }));

      const planCount = new Map<string, number>();
      for (const p of plans) {
        planCount.set(p.patient_id, (planCount.get(p.patient_id) ?? 0) + 1);
      }

      const patientIdsWithPlan = allLinkedIds.filter(id => (planCount.get(id) ?? 0) > 0);

      const workoutsRes = patientIdsWithPlan.length > 0
        ? await sb.from('synced_workouts')
            .select('user_id, date')
            .in('user_id', patientIdsWithPlan)
            .order('date', { ascending: false })
        : { data: [] as any[] };

      if (cancelled) return;

      const lastWorkout = new Map<string, string | null>();
      for (const id of patientIdsWithPlan) lastWorkout.set(id, null);
      for (const w of (workoutsRes.data ?? [])) {
        if (!lastWorkout.get(w.user_id)) lastWorkout.set(w.user_id, w.date);
      }

      const now    = Date.now();
      const alerts: AlertItem[] = [];

      for (const pid of allLinkedIds) {
        const name  = nameMap.get(pid) ?? 'Unknown';
        const count = planCount.get(pid) ?? 0;

        if (count === 0) {
          alerts.push({ type: 'no_plan', patient_id: pid, patientName: name, message: 'No plan assigned' });
        } else if (count > 1) {
          alerts.push({ type: 'multiple_plans', patient_id: pid, patientName: name, message: `${count} active plans` });
        } else {
          const last       = lastWorkout.get(pid);
          const daysSince  = last ? Math.floor((now - new Date(last).getTime()) / 86_400_000) : Infinity;
          if (daysSince >= threshold) {
            const msg = isFinite(daysSince) ? `${daysSince}d without a workout` : 'No workouts logged';
            alerts.push({ type: 'inactive', patient_id: pid, patientName: name, message: msg });
          }
        }
      }

      setItems(alerts);

      try {
        const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
        setBadge(alerts.length > (saved.count ?? -1) ? alerts.length : 0);
      } catch {
        setBadge(alerts.length);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [userId]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  function handleToggle() {
    const next = !open;
    setOpen(next);
    if (next && badge > 0) {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ count: items.length })); } catch {}
      setBadge(0);
    }
  }

  function handleRowClick(patientId: string) {
    setOpen(false);
    router.push(`/patients/${patientId}`);
  }

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={handleToggle}
        aria-label={badge > 0 ? `${badge} patient alerts` : 'No alerts'}
        style={{
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 36,
          height: 36,
          padding: 0,
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          borderRadius: '50%',
        }}
      >
        {/* Bell icon */}
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.7 }}>
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
          <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
        </svg>

        {badge > 0 && (
          <span style={{
            position: 'absolute',
            top: 2,
            right: 2,
            minWidth: 16,
            height: 16,
            padding: '0 4px',
            background: '#ef4444',
            color: '#fff',
            fontSize: 10,
            fontWeight: 700,
            lineHeight: '16px',
            borderRadius: 999,
            textAlign: 'center',
            pointerEvents: 'none',
          }}>
            {badge > 9 ? '9+' : badge}
          </span>
        )}
      </button>

      {open && (
        <div style={{
          position: 'absolute',
          top: 'calc(100% + 8px)',
          right: 0,
          width: 300,
          background: 'var(--modal-bg)',
          border: '1px solid var(--border)',
          borderRadius: 12,
          boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
          zIndex: 10000,
          overflow: 'hidden',
        }}>
          <div style={{
            padding: '12px 16px',
            borderBottom: '1px solid var(--border)',
            fontWeight: 700,
            fontSize: 13,
            color: 'var(--text)',
          }}>
            Needs Attention
            {items.length > 0 && (
              <span style={{ marginLeft: 8, fontWeight: 500, color: 'var(--text-muted)' }}>
                {items.length} patient{items.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>

          {items.length === 0 ? (
            <div style={{ padding: '20px 16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
              All patients on track
            </div>
          ) : (
            <div style={{ maxHeight: 360, overflowY: 'auto' }}>
              {items.map((item, i) => (
                <button
                  key={`${item.patient_id}-${item.type}`}
                  onClick={() => handleRowClick(item.patient_id)}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 10,
                    width: '100%',
                    padding: '10px 16px',
                    borderBottom: i < items.length - 1 ? '1px solid var(--border)' : 'none',
                    background: 'transparent',
                    border: 'none',
                    borderRadius: 0,
                    cursor: 'pointer',
                    textAlign: 'left',
                  }}
                >
                  <span style={{
                    flexShrink: 0,
                    marginTop: 4,
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    background: DOT_COLOR[item.type],
                  }} />
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text)', lineHeight: '1.3' }}>
                      {item.patientName}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 1 }}>
                      {LABEL[item.type]} · {item.message}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}

          <div style={{
            padding: '10px 16px',
            borderTop: items.length > 0 ? '1px solid var(--border)' : 'none',
            display: 'flex',
            justifyContent: 'flex-end',
          }}>
            <button
              onClick={() => { setOpen(false); router.push('/plans'); }}
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: '#5fcfbf',
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                padding: 0,
              }}
            >
              View all in Patients →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
