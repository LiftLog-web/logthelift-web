'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { getSupabase } from '@/lib/supabase';
import { Sk, SkPage, SkSubHeader } from '@/components/Skeleton';

const TEAL   = '#5fcfbf';
const PURPLE = '#C471ED';
const YELLOW = '#F9F295';

/* ── Types matching GymTracker's WorkoutLog ─────────────────────── */
interface WorkoutSet {
  id?: string;
  reps?: number;
  weight?: number;
  unit?: 'kg' | 'lbs';
  duration?: number;       // seconds (duration exercises)
  cardioduration?: number; // minutes (cardio)
  speed?: number;
  incline?: number;
}

interface LoggedExercise {
  id: string;
  exercise: { id: string; name: string; muscleGroup: string; type: string };
  sets: WorkoutSet[];
  targetSets?: WorkoutSet[];
  notes: string;
  practitionerNotes?: string;
}

interface WorkoutLog {
  id: string;
  date: string;
  exercises: LoggedExercise[];
  notes: string;
  duration: number;
  planId?: string;
  satisfactionRating?: 1 | 2 | 3 | 4 | 5;
}

type ExStatus = 'completed' | 'partial' | 'none';

/* ── Completion logic (mirrors GymTracker/src/lib/completion.ts) ── */
function exStatus(ex: LoggedExercise): ExStatus {
  const targets = ex.targetSets ?? [];
  if (targets.length === 0) return ex.sets.length > 0 ? 'completed' : 'none';

  let met = 0;
  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    const a = ex.sets[i];
    if (!a) break;
    if (t.reps !== undefined) {
      if ((a.reps ?? 0) >= t.reps && (a.weight ?? 0) >= (t.weight ?? 0)) met++;
    } else if (t.duration !== undefined) {
      if ((a.duration ?? 0) >= t.duration) met++;
    } else if (t.cardioduration !== undefined) {
      if ((a.cardioduration ?? 0) >= t.cardioduration) met++;
    } else {
      met++;
    }
  }

  if (met === 0 && ex.sets.length === 0) return 'none';
  if (met >= targets.length) return 'completed';
  return 'partial';
}

function renderStars(rating: number): string {
  const full  = Math.floor(rating);
  const half  = rating - full >= 0.5 ? 1 : 0;
  const empty = 5 - full - half;
  return '★'.repeat(full) + (half ? '½' : '') + '☆'.repeat(empty);
}
const STATUS_COLOR: Record<ExStatus, string> = {
  completed: TEAL,
  partial:   YELLOW,
  none:      '#EF4444',
};
const STATUS_LABEL: Record<ExStatus, string> = {
  completed: 'Completed',
  partial:   'Partial',
  none:      'Skipped',
};

function setLabel(s: WorkoutSet, type: string): string {
  if (type === 'cardio')    return s.cardioduration ? `${s.cardioduration} min` : '—';
  if (type === 'duration')  return s.duration       ? `${s.duration}s`          : '—';
  const w = s.weight !== undefined ? `${s.weight}${s.unit ?? 'kg'}` : '';
  const r = s.reps    !== undefined ? `${s.reps} reps`                : '';
  return [r, w].filter(Boolean).join(' × ') || '—';
}

/* ── Week grouping helpers ──────────────────────────────────────── */
function getWeekStartDate(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00');
  const day = d.getDay();
  d.setDate(d.getDate() - (day === 0 ? 6 : day - 1)); // back to Monday
  return d.toISOString().split('T')[0];
}

function weekLabel(weekStartStr: string): { range: string; badge: string | null } {
  const start = new Date(weekStartStr + 'T12:00:00');
  const end   = new Date(weekStartStr + 'T12:00:00');
  end.setDate(end.getDate() + 6);

  const today = new Date();
  const curDay = today.getDay();
  const thisMonday = new Date(today);
  thisMonday.setDate(today.getDate() - (curDay === 0 ? 6 : curDay - 1));
  thisMonday.setHours(12, 0, 0, 0);

  const lastMonday = new Date(thisMonday);
  lastMonday.setDate(lastMonday.getDate() - 7);

  const fmt = (d: Date) => d.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });
  const range = `${fmt(start)} – ${fmt(end)}`;
  const badge =
    start.getTime() === thisMonday.getTime() ? 'This Week' :
    start.getTime() === lastMonday.getTime() ? 'Last Week' : null;
  return { range, badge };
}

/* ── Component ──────────────────────────────────────────────────── */
export default function PatientProgressPage() {
  const router    = useRouter();
  const { patientId } = useParams<{ patientId: string }>();

  const [authed,        setAuthed]        = useState(false);
  const [patientName,   setPatientName]   = useState('');
  const [patientEmail,  setPatientEmail]  = useState('');
  const [practName,     setPractName]     = useState('');
  const [workouts,      setWorkouts]      = useState<WorkoutLog[]>([]);
  const [loading,       setLoading]       = useState(true);
  const [expanded,      setExpanded]      = useState<Set<string>>(new Set());
  const [expandedEx,    setExpandedEx]    = useState<Set<string>>(new Set());
  const [expandedWeeks, setExpandedWeeks] = useState<Set<string>>(new Set());
  const [noAccess,      setNoAccess]      = useState(false);
  const [exerciseDemos, setExerciseDemos] = useState<Array<{ id: string; exercise_name: string; media_type: string; file_path: string; url_link: string | null }>>([]);
  const [demoSignedUrls, setDemoSignedUrls] = useState<Record<string, string>>({});
  const [viewDemo,      setViewDemo]      = useState<{ url: string; type: 'photo' | 'video'; name: string } | null>(null);

  // Email modal state
  const [emailOpen,    setEmailOpen]    = useState(false);
  const [emailSubject, setEmailSubject] = useState('');
  const [emailBody,    setEmailBody]    = useState('');
  const [sending,      setSending]      = useState(false);
  const [sendResult,   setSendResult]   = useState<'ok' | 'error' | null>(null);

  useEffect(() => {
    if (!patientId) return;
    const sb = getSupabase();

    sb.auth.getSession().then(async ({ data }) => {
      if (!data.session) { router.push('/login'); return; }

      const uid = data.session.user.id;
      const { data: prof } = await sb.from('profiles').select('role, is_gym_owner, display_name').eq('id', uid).single();
      if (prof?.role !== 'practitioner' && !prof?.is_gym_owner) { router.push('/profile'); return; }
      setPractName(prof?.display_name ?? 'Your Practitioner');

      // Verify this patient is linked to the practitioner
      const { data: link } = await sb
        .from('patient_links')
        .select('patient_id')
        .eq('practitioner_id', uid)
        .eq('patient_id', patientId)
        .single();

      if (!link) { setNoAccess(true); setLoading(false); return; }

      // Load patient profile
      const { data: patProf } = await sb.from('profiles').select('display_name, email').eq('id', patientId).single();
      setPatientName(patProf?.display_name ?? 'Patient');
      setPatientEmail(patProf?.email ?? '');

      // Load workouts
      const { data: rows } = await sb
        .from('synced_workouts')
        .select('data, date')
        .eq('user_id', patientId)
        .order('date', { ascending: false })
        .limit(100);

      const logs: WorkoutLog[] = (rows ?? [])
        .map((r: any) => r.data as WorkoutLog)
        .filter(Boolean);

      setWorkouts(logs);
      const allWeekKeys = new Set(logs.map(w => getWeekStartDate(w.date)));
      const storedCollapsed = localStorage.getItem(`patient-weeks-collapsed-${patientId}`);
      const collapsed: Set<string> = storedCollapsed ? new Set(JSON.parse(storedCollapsed)) : new Set();
      setExpandedWeeks(new Set([...allWeekKeys].filter(k => !collapsed.has(k))));

      // Load exercise demos for this patient's plans
      const { data: plans } = await sb
        .from('workout_plans')
        .select('exercises')
        .eq('patient_id', patientId)
        .eq('practitioner_id', uid);

      const exerciseNames = new Set<string>();
      for (const plan of (plans ?? [])) {
        if (Array.isArray(plan.exercises)) {
          for (const ex of plan.exercises as Record<string, unknown>[]) {
            const name = (ex?.exercise as Record<string, unknown> | undefined)?.name ?? ex?.name;
            if (typeof name === 'string') exerciseNames.add(name);
          }
        }
      }

      if (exerciseNames.size > 0) {
        const { data: media } = await sb
          .from('exercise_media')
          .select('id, exercise_name, media_type, file_path, url_link')
          .eq('practitioner_id', uid)
          .in('exercise_name', [...exerciseNames])
          .order('exercise_name', { ascending: true });

        const demoItems = media ?? [];
        const signedDemoUrls: Record<string, string> = {};
        await Promise.all(
          demoItems
            .filter(m => m.media_type !== 'link' && m.file_path)
            .map(async m => {
              const { data: su } = await sb.storage.from('exercise-media').createSignedUrl(m.file_path, 3600);
              if (su?.signedUrl) signedDemoUrls[m.id] = su.signedUrl;
            }),
        );
        setExerciseDemos(demoItems);
        setDemoSignedUrls(signedDemoUrls);
      }

      setAuthed(true);
      setLoading(false);
    });
  }, [patientId, router]);

  const handleSendEmail = async () => {
    if (!emailSubject.trim() || !emailBody.trim()) return;
    setSending(true);
    setSendResult(null);
    try {
      const res = await fetch('/api/send-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to:       patientEmail,
          toName:   patientName,
          fromName: practName,
          subject:  emailSubject,
          body:     emailBody,
        }),
      });
      const json = await res.json();
      setSendResult(json.ok ? 'ok' : 'error');
      if (json.ok) { setEmailSubject(''); setEmailBody(''); }
    } catch {
      setSendResult('error');
    }
    setSending(false);
  };

  const toggleWorkout = (id: string) =>
    setExpanded(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const toggleEx = (id: string) =>
    setExpandedEx(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const toggleWeek = (key: string) =>
    setExpandedWeeks(prev => {
      const n = new Set(prev);
      n.has(key) ? n.delete(key) : n.add(key);
      const storedCollapsed: string[] = JSON.parse(localStorage.getItem(`patient-weeks-collapsed-${patientId}`) ?? '[]');
      const updated = n.has(key)
        ? storedCollapsed.filter(k => k !== key)
        : [...new Set([...storedCollapsed, key])];
      localStorage.setItem(`patient-weeks-collapsed-${patientId}`, JSON.stringify(updated));
      return n;
    });

  /* ── Week groups ── */
  const weekMap = new Map<string, WorkoutLog[]>();
  for (const w of workouts) {
    const key = getWeekStartDate(w.date);
    if (!weekMap.has(key)) weekMap.set(key, []);
    weekMap.get(key)!.push(w);
  }
  const sortedWeekKeys = [...weekMap.keys()].sort().reverse();
  const chronoWeekKeys = [...sortedWeekKeys].reverse(); // oldest → newest

  /* ── Progress chart data ── */
  const weekTrends = chronoWeekKeys.map(key => {
    const ws  = weekMap.get(key)!;
    const exs = ws.flatMap(w => w.exercises ?? []);
    const withT = exs.filter(e => (e.targetSets ?? []).length > 0);
    const done  = withT.filter(e => exStatus(e) === 'completed').length;
    const rate  = withT.length > 0 ? Math.round((done / withT.length) * 100) : null;
    const totalSets = exs.reduce((a, e) => a + e.sets.length, 0);
    const { badge } = weekLabel(key);
    const shortLabel = new Date(key + 'T12:00:00').toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });
    return { key, shortLabel, badge, rate, totalSets };
  });

  // Trend summary
  const recentRates = weekTrends.slice(-3).map(wt => wt.rate).filter((r): r is number => r !== null);
  const rateChange = recentRates.length >= 2 ? recentRates[recentRates.length - 1] - recentRates[recentRates.length - 2] : null;
  const trendSummaryText = rateChange === null ? null : rateChange > 5 ? 'Completion trending up ↑' : rateChange < -5 ? 'Completion trending down ↓' : 'Completion stable →';
  const trendSummaryColor = rateChange === null ? 'rgba(255,255,255,0.35)' : rateChange > 5 ? TEAL : rateChange < -5 ? '#EF4444' : 'rgba(255,255,255,0.45)';

  // Best weight / duration per exercise per week
  const exProgressMap: Record<string, { weekKey: string; best: number; unit?: string; type: string }[]> = {};
  for (const key of chronoWeekKeys) {
    const bestPerEx: Record<string, { best: number; unit?: string; type: string }> = {};
    for (const w of weekMap.get(key)!) {
      for (const ex of w.exercises ?? []) {
        const name = ex.exercise.name;
        const type = ex.exercise.type;
        if (type === 'weighted') {
          const maxW = Math.max(0, ...ex.sets.map(s => s.weight ?? 0));
          if (maxW > 0) {
            const unit = ex.sets.find(s => s.weight)?.unit ?? 'kg';
            if (!bestPerEx[name] || maxW > bestPerEx[name].best) bestPerEx[name] = { best: maxW, unit, type };
          }
        } else if (type === 'duration') {
          const maxD = Math.max(0, ...ex.sets.map(s => s.duration ?? 0));
          if (maxD > 0) {
            if (!bestPerEx[name] || maxD > bestPerEx[name].best) bestPerEx[name] = { best: maxD, type };
          }
        }
      }
    }
    for (const [name, data] of Object.entries(bestPerEx)) {
      if (!exProgressMap[name]) exProgressMap[name] = [];
      exProgressMap[name].push({ weekKey: key, ...data });
    }
  }
  const progressExercises = Object.entries(exProgressMap)
    .filter(([, e]) => e.length >= 2)
    .sort(([, a], [, b]) => b.length - a.length)
    .slice(0, 8);

  /* ── Stats ── */
  const totalWorkouts  = workouts.length;
  const withPlan       = workouts.filter(w => w.planId);
  const allExercises   = workouts.flatMap(w => w.exercises ?? []);
  const withTargets    = allExercises.filter(e => (e.targetSets ?? []).length > 0);
  const completedCount = withTargets.filter(e => exStatus(e) === 'completed').length;
  const completionRate = withTargets.length > 0 ? Math.round((completedCount / withTargets.length) * 100) : null;
  const ratings        = workouts.map(w => w.satisfactionRating).filter((r): r is 1|2|3|4|5 => !!r);
  const avgRating      = ratings.length ? (ratings.reduce((a: number, b: number) => a + b, 0) / ratings.length).toFixed(1) : null;

  /* ── Loading / error ── */
  if (loading || !authed) {
    if (noAccess) return (
      <div style={{ minHeight: '100vh', background: '#0f1117', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p style={{ color: 'rgba(255,255,255,0.5)' }}>You don't have access to this patient's data.</p>
      </div>
    );
    return (
      <SkPage>
        <SkSubHeader />
        <main style={{ maxWidth: 900, margin: '0 auto', padding: '32px 24px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 14, marginBottom: 28 }}>
            {[0,1,2,3].map(i => (
              <div key={i} style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 16, padding: '18px 20px' }}>
                <Sk width={90} height={11} radius={3} style={{ marginBottom: 12 }} />
                <Sk width={60} height={26} radius={6} />
              </div>
            ))}
          </div>
          <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 20, padding: '24px', marginBottom: 16 }}>
            <Sk width={140} height={16} style={{ marginBottom: 20 }} />
            <Sk width="100%" height={110} radius={12} />
          </div>
          {[0,1,2].map(i => (
            <div key={i} style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 16, padding: '18px 24px', marginBottom: 10 }}>
              <Sk width={100} height={13} style={{ marginBottom: 14 }} />
              {[0,1].map(j => (
                <div key={j} style={{ display: 'flex', gap: 10, marginBottom: 8 }}>
                  <Sk width={50} height={32} radius={8} />
                  <Sk width={80} height={32} radius={8} />
                  <Sk width={80} height={32} radius={8} />
                </div>
              ))}
            </div>
          ))}
        </main>
      </SkPage>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: '#0f1117', color: '#fff', fontFamily: 'sans-serif' }}>

      {/* Email modal */}
      {emailOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div style={{ width: '100%', maxWidth: 520, background: '#1a1d26', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 20, padding: 32 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
              <h2 style={{ margin: 0, fontWeight: 700, fontSize: 18 }}>Email {patientName}</h2>
              <button onClick={() => { setEmailOpen(false); setSendResult(null); }} style={{ background: 'transparent', border: 'none', color: 'rgba(255,255,255,0.4)', fontSize: 20, cursor: 'pointer', lineHeight: 1 }}>✕</button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>To</label>
                <div style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, padding: '10px 14px', fontSize: 14, color: 'rgba(255,255,255,0.5)' }}>
                  {patientName} &lt;{patientEmail}&gt;
                </div>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Subject</label>
                <input
                  value={emailSubject}
                  onChange={e => setEmailSubject(e.target.value)}
                  placeholder="e.g. Great progress this week!"
                  style={{ width: '100%', background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 10, padding: '10px 14px', color: '#fff', fontSize: 14, outline: 'none', boxSizing: 'border-box' }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Message</label>
                <textarea
                  value={emailBody}
                  onChange={e => setEmailBody(e.target.value)}
                  placeholder="Write your message here…"
                  rows={7}
                  style={{ width: '100%', background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 10, padding: '10px 14px', color: '#fff', fontSize: 14, outline: 'none', boxSizing: 'border-box', resize: 'vertical', fontFamily: 'sans-serif' }}
                />
              </div>
              {sendResult === 'ok' && (
                <p style={{ color: TEAL, fontSize: 13, margin: 0 }}>Email sent successfully.</p>
              )}
              {sendResult === 'error' && (
                <p style={{ color: '#EF4444', fontSize: 13, margin: 0 }}>Failed to send. Please try again.</p>
              )}
              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                <button onClick={() => { setEmailOpen(false); setSendResult(null); }} style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.2)', color: 'rgba(255,255,255,0.5)', borderRadius: 10, padding: '10px 20px', fontSize: 14, cursor: 'pointer' }}>
                  Cancel
                </button>
                <button
                  onClick={handleSendEmail}
                  disabled={sending || !emailSubject.trim() || !emailBody.trim()}
                  style={{ background: TEAL, color: '#0f1117', borderRadius: 10, padding: '10px 24px', fontWeight: 700, fontSize: 14, border: 'none', cursor: sending ? 'not-allowed' : 'pointer', opacity: sending ? 0.7 : 1 }}
                >
                  {sending ? 'Sending…' : 'Send Email'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Sub-header */}
      <div style={{ borderBottom: '1px solid rgba(255,255,255,0.08)', padding: '12px 32px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13 }}>
          <a href="/plans" style={{ color: 'rgba(255,255,255,0.5)', textDecoration: 'none' }}>Plans</a>
          {' / '}{patientName}
        </span>
        <div style={{ display: 'flex', gap: 10 }}>
          {patientEmail && (
            <button
              onClick={() => { setEmailOpen(true); setSendResult(null); }}
              style={{ background: `${PURPLE}20`, border: `1px solid ${PURPLE}50`, color: PURPLE, borderRadius: 10, padding: '8px 18px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
            >
              ✉ Email Patient
            </button>
          )}
          <button
            onClick={() => router.push('/plans')}
            style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.15)', color: 'rgba(255,255,255,0.6)', borderRadius: 10, padding: '8px 16px', fontSize: 13, cursor: 'pointer' }}
          >
            ← Plans
          </button>
        </div>
      </div>

      <main style={{ maxWidth: 1100, margin: '0 auto', padding: '40px 32px' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 20, marginBottom: 32 }}>
          <div style={{ width: 56, height: 56, borderRadius: '50%', background: `${PURPLE}30`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, flexShrink: 0 }}>
            🏋️
          </div>
          <div>
            <h1 style={{ fontSize: 26, fontWeight: 800, margin: 0 }}>{patientName}</h1>
            <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 14, margin: '4px 0 0' }}>Workout Progress</p>
          </div>
        </div>

        {/* Stats row */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12, marginBottom: 36 }}>
          {[
            { label: 'Total Workouts',   value: String(totalWorkouts),                    color: TEAL   },
            { label: 'Plan Workouts',    value: String(withPlan.length),                  color: PURPLE },
            { label: 'Completion Rate',  value: completionRate !== null ? `${completionRate}%` : '—', color: YELLOW },
            { label: 'Avg Satisfaction', value: avgRating ? `${renderStars(Number(avgRating))} ${avgRating}/5` : '—', color: TEAL },
          ].map(s => (
            <div key={s.label} style={{ background: 'rgba(255,255,255,0.04)', border: `1px solid rgba(255,255,255,0.08)`, borderRadius: 14, padding: '18px 20px' }}>
              <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 6px' }}>{s.label}</p>
              <p style={{ fontSize: 22, fontWeight: 800, color: s.color, margin: 0 }}>{s.value}</p>
            </div>
          ))}
        </div>

        {/* ── Progress section ── */}
        {weekTrends.length >= 2 && (
          <div style={{ marginBottom: 36 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 14, flexWrap: 'wrap' }}>
              <p style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.08em', margin: 0 }}>Progress Over Time</p>
              <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.3)' }}>{weekTrends.length} week{weekTrends.length !== 1 ? 's' : ''} tracked</span>
              {trendSummaryText && <span style={{ fontSize: 12, fontWeight: 700, color: trendSummaryColor, marginLeft: 'auto' }}>{trendSummaryText}</span>}
            </div>

            {/* Trend charts row */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>

              {/* Completion rate */}
              <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 14, padding: '16px 18px' }}>
                <p style={{ margin: '0 0 14px', fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Completion Rate</p>
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: 5, height: 72 }}>
                  {weekTrends.map(wt => {
                    const h = wt.rate !== null ? Math.max(4, (wt.rate / 100) * 64) : 4;
                    const col = wt.rate === null ? 'rgba(255,255,255,0.08)' : wt.rate >= 80 ? TEAL : wt.rate >= 50 ? YELLOW : '#EF4444';
                    return (
                      <div key={wt.key} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', height: '100%' }}>
                        {wt.rate !== null && <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.4)', marginBottom: 3 }}>{wt.rate}%</span>}
                        <div title={`${wt.shortLabel}: ${wt.rate ?? '—'}%`} style={{ width: '100%', height: h, background: col, borderRadius: 3, opacity: wt.badge ? 1 : 0.55 }} />
                      </div>
                    );
                  })}
                </div>
                <div style={{ display: 'flex', gap: 5, marginTop: 6 }}>
                  {weekTrends.map((wt, i) => {
                    const showLabel = weekTrends.length <= 5 || wt.badge !== null || i === 0;
                    return (
                      <div key={wt.key} style={{ flex: 1, textAlign: 'center' }}>
                        <span style={{ fontSize: 9, color: wt.badge ? TEAL : 'rgba(255,255,255,0.25)' }}>
                          {showLabel ? (wt.badge ?? wt.shortLabel) : ''}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Volume */}
              <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 14, padding: '16px 18px' }}>
                <p style={{ margin: '0 0 14px', fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Sets per Week</p>
                {(() => {
                  const max = Math.max(...weekTrends.map(wt => wt.totalSets), 1);
                  return (
                    <>
                      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 5, height: 72 }}>
                        {weekTrends.map(wt => {
                          const h = Math.max(4, (wt.totalSets / max) * 64);
                          const isCurrent = wt.badge === 'This Week';
                          return (
                            <div key={wt.key} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', height: '100%' }}>
                              <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.4)', marginBottom: 3 }}>{wt.totalSets}</span>
                              <div
                                title={`${wt.shortLabel}: ${wt.totalSets} sets${isCurrent ? ' (week in progress)' : ''}`}
                                style={{ width: '100%', height: h, background: isCurrent ? `${PURPLE}35` : PURPLE, borderRadius: 3, opacity: isCurrent ? 1 : wt.badge ? 1 : 0.55, border: isCurrent ? `1.5px dashed ${PURPLE}` : 'none', boxSizing: 'border-box' }}
                              />
                            </div>
                          );
                        })}
                      </div>
                      <div style={{ display: 'flex', gap: 5, marginTop: 6 }}>
                        {weekTrends.map((wt, i) => {
                          const showLabel = weekTrends.length <= 5 || wt.badge !== null || i === 0;
                          return (
                            <div key={wt.key} style={{ flex: 1, textAlign: 'center' }}>
                              {showLabel && (
                                <>
                                  <span style={{ fontSize: 9, color: wt.badge ? PURPLE : 'rgba(255,255,255,0.25)', display: 'block' }}>{wt.badge ?? wt.shortLabel}</span>
                                  {wt.badge === 'This Week' && <span style={{ fontSize: 8, color: 'rgba(255,255,255,0.28)', display: 'block' }}>so far</span>}
                                </>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </>
                  );
                })()}
              </div>
            </div>

            {/* Exercise progression */}
            {progressExercises.length > 0 && (
              <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 14, padding: '16px 18px' }}>
                <p style={{ margin: '0 0 16px', fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Exercise Progression</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  {progressExercises.map(([name, entries]) => {
                    const latest    = entries[entries.length - 1];
                    const prev      = entries[entries.length - 2];
                    const isW       = latest.type === 'weighted';
                    const fmt       = (e: typeof entries[0]) => isW ? `${e.best} ${e.unit ?? 'kg'}` : `${e.best}s`;
                    const delta     = prev.best > 0 ? ((latest.best - prev.best) / prev.best) * 100 : 0;
                    const trend     = delta > 1 ? '↑' : delta < -1 ? '↓' : '→';
                    const trendCol  = delta > 1 ? TEAL : delta < -30 ? '#EF4444' : delta < -1 ? YELLOW : 'rgba(255,255,255,0.3)';
                    const maxVal    = Math.max(...entries.map(e => e.best), 1);
                    return (
                      <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</p>
                          <p style={{ margin: '3px 0 0', fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>
                            {fmt(prev)} → <span style={{ color: '#fff', fontWeight: 600 }}>{fmt(latest)}</span>
                            {Math.abs(delta) >= 1 && (
                              <span style={{ marginLeft: 8, color: trendCol, fontWeight: 700 }}>
                                {delta > 0 ? '+' : ''}{Math.round(delta)}%
                              </span>
                            )}
                          </p>
                        </div>
                        {/* Sparkline */}
                        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 32, flexShrink: 0 }}>
                          {entries.map((e, i) => (
                            <div key={i} style={{ width: 7, height: Math.max(3, (e.best / maxVal) * 28), background: i === entries.length - 1 ? TEAL : 'rgba(255,255,255,0.18)', borderRadius: 2 }} />
                          ))}
                        </div>
                        <div style={{ width: 26, textAlign: 'center', fontSize: 20, fontWeight: 800, color: trendCol, flexShrink: 0 }}>{trend}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Exercise Demos */}
        {exerciseDemos.length > 0 && (
          <div style={{ marginBottom: 36 }}>
            <p style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 14px' }}>
              Exercise Demos · {exerciseDemos.length}
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 12 }}>
              {exerciseDemos.map(demo => {
                const signedUrl = demoSignedUrls[demo.id];
                return (
                  <div key={demo.id} style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 14, overflow: 'hidden' }}>
                    {demo.media_type === 'photo' && signedUrl ? (
                      <img
                        src={signedUrl}
                        alt={demo.exercise_name}
                        onClick={() => setViewDemo({ url: signedUrl, type: 'photo', name: demo.exercise_name })}
                        style={{ width: '100%', height: 120, objectFit: 'cover', display: 'block', cursor: 'pointer' }}
                      />
                    ) : demo.media_type === 'video' && signedUrl ? (
                      <div
                        onClick={() => setViewDemo({ url: signedUrl, type: 'video', name: demo.exercise_name })}
                        style={{ width: '100%', height: 120, background: '#1a1a2e', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 32, color: '#fff' }}
                      >▶</div>
                    ) : (
                      <div style={{ width: '100%', height: 120, background: '#0f2a1a', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 32 }}>🔗</div>
                    )}
                    <div style={{ padding: '12px 14px' }}>
                      <p style={{ fontWeight: 700, fontSize: 13, margin: '0 0 8px', color: '#fff' }}>{demo.exercise_name}</p>
                      {demo.media_type === 'link' && demo.url_link ? (
                        <a href={demo.url_link} target="_blank" rel="noopener noreferrer" style={{ color: TEAL, fontSize: 12, fontWeight: 700, textDecoration: 'none' }}>
                          Watch video ↗
                        </a>
                      ) : (
                        <button
                          onClick={() => signedUrl && setViewDemo({ url: signedUrl, type: demo.media_type as 'photo' | 'video', name: demo.exercise_name })}
                          style={{ background: 'none', border: 'none', color: TEAL, fontSize: 12, fontWeight: 700, cursor: 'pointer', padding: 0 }}
                        >
                          {demo.media_type === 'photo' ? 'View photo' : 'Play video'}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Workout list — grouped by week */}
        {workouts.length === 0 ? (
          <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 20, padding: 60, textAlign: 'center' }}>
            <p style={{ fontSize: 36, marginBottom: 12 }}>📭</p>
            <p style={{ color: 'rgba(255,255,255,0.4)' }}>No workouts synced yet for this patient.</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            {sortedWeekKeys.map(weekKey => {
              const weekWorkouts  = weekMap.get(weekKey)!;
              const { range, badge } = weekLabel(weekKey);
              const weekOpen      = expandedWeeks.has(weekKey);

              // Week-level aggregate stats
              const weekExercises   = weekWorkouts.flatMap(w => w.exercises ?? []);
              const weekWithTargets = weekExercises.filter(e => (e.targetSets ?? []).length > 0);
              const weekDone        = weekWithTargets.filter(e => exStatus(e) === 'completed').length;
              const weekRate        = weekWithTargets.length > 0 ? Math.round((weekDone / weekWithTargets.length) * 100) : null;
              const weekRatings     = weekWorkouts.map(w => w.satisfactionRating).filter((r): r is 1|2|3|4|5 => !!r);
              const weekAvgRating   = weekRatings.length ? (weekRatings.reduce((a, b) => a + b, 0) / weekRatings.length).toFixed(1) : null;
              const weekAllStatuses = weekExercises.map(exStatus);
              const weekOverall: ExStatus =
                weekAllStatuses.length === 0 ? 'none'
                : weekAllStatuses.every(s => s === 'completed') ? 'completed'
                : weekAllStatuses.some(s => s === 'completed' || s === 'partial') ? 'partial'
                : 'none';

              return (
                <div key={weekKey}>
                  {/* Week header */}
                  <button
                    onClick={() => toggleWeek(weekKey)}
                    style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: weekOpen ? '12px 12px 0 0' : 12, cursor: 'pointer', textAlign: 'left', borderBottom: weekOpen ? '1px solid rgba(255,255,255,0.06)' : undefined }}
                  >
                    <div style={{ width: 10, height: 10, borderRadius: '50%', background: STATUS_COLOR[weekOverall], flexShrink: 0 }} />
                    <span style={{ fontWeight: 700, fontSize: 15, color: '#fff' }}>{range}</span>
                    {badge && (
                      <span style={{ background: `${TEAL}25`, color: TEAL, fontSize: 11, fontWeight: 700, padding: '2px 9px', borderRadius: 999 }}>{badge}</span>
                    )}
                    <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)' }}>
                      {weekWorkouts.length} workout{weekWorkouts.length !== 1 ? 's' : ''}
                      {weekRate !== null ? ` · ${weekRate}% completion` : ''}
                      {weekAvgRating ? ` · ★ ${weekAvgRating}` : ''}
                    </span>
                    <span style={{ marginLeft: 'auto', color: 'rgba(255,255,255,0.3)', fontSize: 14, transform: weekOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s', display: 'inline-block' }}>▾</span>
                  </button>

                  {/* Week body */}
                  {weekOpen && (
                    <div style={{ border: '1px solid rgba(255,255,255,0.1)', borderTop: 'none', borderRadius: '0 0 12px 12px', overflow: 'hidden', display: 'flex', flexDirection: 'column', gap: 0 }}>
                      {weekWorkouts.map((w, wi) => {
                        const isOpen       = expanded.has(w.id);
                        const statuses     = (w.exercises ?? []).map(exStatus);
                        const doneCount    = statuses.filter(s => s === 'completed').length;
                        const partialCount = statuses.filter(s => s === 'partial').length;
                        const total        = statuses.length;
                        const overallStatus: ExStatus =
                          total === 0 ? 'none'
                          : doneCount === total ? 'completed'
                          : doneCount + partialCount > 0 ? 'partial'
                          : 'none';

                        return (
                          <div key={w.id} style={{ borderTop: wi > 0 ? '1px solid rgba(255,255,255,0.06)' : undefined }}>

                            {/* Workout row */}
                            <button
                              onClick={() => toggleWorkout(w.id)}
                              style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 16, padding: '14px 22px', background: isOpen ? `${PURPLE}0d` : 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left' }}
                            >
                              <div style={{ width: 9, height: 9, borderRadius: '50%', background: STATUS_COLOR[overallStatus], flexShrink: 0 }} />
                              <span style={{ fontWeight: 700, fontSize: 14, minWidth: 110 }}>
                                {new Date(w.date + 'T12:00:00').toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric' })}
                              </span>
                              {w.duration > 0 && (
                                <span style={{ background: 'rgba(255,255,255,0.07)', borderRadius: 6, padding: '2px 8px', fontSize: 12, color: 'rgba(255,255,255,0.45)' }}>{w.duration} min</span>
                              )}
                              {w.satisfactionRating && (
                                <span style={{ fontSize: 12, color: YELLOW, fontWeight: 600 }}>{renderStars(w.satisfactionRating)} {w.satisfactionRating}/5</span>
                              )}
                              {total > 0 && (
                                <div style={{ display: 'flex', gap: 4 }}>
                                  {(w.exercises ?? []).map((ex, i) => (
                                    <div key={i} title={`${ex.exercise.name}: ${STATUS_LABEL[statuses[i]]}`} style={{ width: 8, height: 8, borderRadius: 2, background: STATUS_COLOR[statuses[i]], flexShrink: 0 }} />
                                  ))}
                                </div>
                              )}
                              <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.3)', whiteSpace: 'nowrap', marginLeft: 'auto' }}>
                                {total > 0 ? `${doneCount}/${total} done${partialCount > 0 ? `, ${partialCount} partial` : ''}` : 'No exercises'}
                              </span>
                              <span style={{ color: 'rgba(255,255,255,0.25)', fontSize: 13, transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s', display: 'inline-block', flexShrink: 0 }}>▾</span>
                            </button>

                            {/* Workout detail */}
                            {isOpen && (
                              <div style={{ borderTop: '1px solid rgba(255,255,255,0.07)', padding: '18px 22px', background: 'rgba(0,0,0,0.15)' }}>
                                {w.notes?.trim() && (
                                  <div style={{ background: `${TEAL}10`, border: `1px solid ${TEAL}30`, borderRadius: 10, padding: '10px 14px', marginBottom: 16, display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                                    <span style={{ fontSize: 14 }}>💬</span>
                                    <p style={{ margin: 0, fontSize: 14, color: 'rgba(255,255,255,0.75)', fontStyle: 'italic' }}>"{w.notes}"</p>
                                  </div>
                                )}
                                {(w.exercises ?? []).length === 0 ? (
                                  <p style={{ color: 'rgba(255,255,255,0.3)', fontSize: 14 }}>No exercises recorded.</p>
                                ) : (
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                    {(w.exercises ?? []).map(ex => {
                                      const st     = exStatus(ex);
                                      const exOpen = expandedEx.has(ex.id);
                                      const hasNote = ex.notes?.trim();
                                      const hasSets = ex.sets?.length > 0;
                                      return (
                                        <div key={ex.id} style={{ border: `1px solid ${STATUS_COLOR[st]}30`, borderRadius: 10, overflow: 'hidden' }}>
                                          <button
                                            onClick={() => toggleEx(ex.id)}
                                            style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '11px 16px', background: `${STATUS_COLOR[st]}08`, border: 'none', cursor: 'pointer', textAlign: 'left' }}
                                          >
                                            <span style={{ background: `${STATUS_COLOR[st]}25`, color: STATUS_COLOR[st], fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 999, whiteSpace: 'nowrap', flexShrink: 0 }}>{STATUS_LABEL[st]}</span>
                                            <span style={{ fontWeight: 600, fontSize: 14, flex: 1 }}>{ex.exercise.name}</span>
                                            <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)' }}>
                                              {ex.sets.length} set{ex.sets.length !== 1 ? 's' : ''}{(ex.targetSets ?? []).length > 0 ? ` / ${ex.targetSets!.length} target` : ''}
                                            </span>
                                            {hasNote && <span title="Patient note" style={{ fontSize: 13 }}>💬</span>}
                                            <span style={{ color: 'rgba(255,255,255,0.25)', fontSize: 12, transform: exOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s', display: 'inline-block', flexShrink: 0 }}>▾</span>
                                          </button>
                                          {exOpen && (
                                            <div style={{ borderTop: `1px solid ${STATUS_COLOR[st]}20`, padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                                              {hasSets && (
                                                <div>
                                                  <p style={{ margin: '0 0 8px', fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Sets</p>
                                                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                                    {ex.sets.map((s, si) => {
                                                      const target = ex.targetSets?.[si];
                                                      const actual = setLabel(s, ex.exercise.type);
                                                      const tLabel = target ? setLabel(target, ex.exercise.type) : null;
                                                      let setMet: boolean | null = null;
                                                      if (target) {
                                                        if (target.reps !== undefined) setMet = (s.reps ?? 0) >= target.reps && (s.weight ?? 0) >= (target.weight ?? 0);
                                                        else if (target.duration !== undefined) setMet = (s.duration ?? 0) >= target.duration;
                                                        else if (target.cardioduration !== undefined) setMet = (s.cardioduration ?? 0) >= target.cardioduration;
                                                      }
                                                      return (
                                                        <div key={si} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13 }}>
                                                          <span style={{ width: 18, color: 'rgba(255,255,255,0.3)', flexShrink: 0, textAlign: 'right' }}>{si + 1}</span>
                                                          <span style={{ color: '#fff', minWidth: 100 }}>{actual}</span>
                                                          {tLabel && (
                                                            <>
                                                              <span style={{ color: 'rgba(255,255,255,0.25)', fontSize: 12 }}>target: {tLabel}</span>
                                                              {setMet !== null && <span style={{ color: setMet ? TEAL : '#EF4444', fontSize: 12 }}>{setMet ? '✓' : '✗'}</span>}
                                                            </>
                                                          )}
                                                        </div>
                                                      );
                                                    })}
                                                  </div>
                                                </div>
                                              )}
                                              {hasNote && (
                                                <div style={{ background: `${TEAL}0d`, border: `1px solid ${TEAL}25`, borderRadius: 8, padding: '8px 12px', display: 'flex', gap: 8 }}>
                                                  <span style={{ fontSize: 13 }}>💬</span>
                                                  <p style={{ margin: 0, fontSize: 13, color: 'rgba(255,255,255,0.7)', fontStyle: 'italic' }}>"{ex.notes}"</p>
                                                </div>
                                              )}
                                            </div>
                                          )}
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </main>

      {/* Demo viewer */}
      {viewDemo && (
        <div
          onClick={() => setViewDemo(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.92)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', zIndex: 300, padding: 24 }}
        >
          <div onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 860 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <p style={{ color: '#fff', fontWeight: 700, fontSize: 17, margin: 0 }}>{viewDemo.name}</p>
              <button onClick={() => setViewDemo(null)} style={{ background: 'rgba(255,255,255,0.1)', border: 'none', color: '#fff', borderRadius: 8, width: 36, height: 36, fontSize: 20, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
            </div>
            {viewDemo.type === 'photo' ? (
              <img src={viewDemo.url} alt={viewDemo.name} style={{ width: '100%', borderRadius: 12, maxHeight: '80vh', objectFit: 'contain' }} />
            ) : (
              <video src={viewDemo.url} controls autoPlay style={{ width: '100%', borderRadius: 12, maxHeight: '80vh', background: '#000' }} />
            )}
            <p style={{ color: 'rgba(255,255,255,0.3)', fontSize: 12, textAlign: 'center', marginTop: 12 }}>Click outside to close</p>
          </div>
        </div>
      )}
    </div>
  );
}
