'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { getSupabase } from '@/lib/supabase';
import { checkPractitionerAccess } from '@/lib/checkPractitionerAccess';
import { MUSCLE_GROUPS } from '@/data/exercises';
import { Sk, SkPage, SkSubHeader } from '@/components/Skeleton';
import { MessageSquare } from 'lucide-react';

function getInitials(name: string): string {
  return (name || '?').trim().split(/\s+/).filter(Boolean).map(w => w[0]).join('').toUpperCase().slice(0, 2) || '?';
}

const TEAL   = '#5fcfbf';
const PURPLE = '#C471ED';
const YELLOW = '#F9F295';

function fmtRating(n: number): string {
  return Number.isInteger(n) ? String(n) : String(parseFloat(n.toFixed(2)));
}

function deriveExerciseWeeks(raw: any): number[] {
  const list: any[] = Array.isArray(raw) ? raw :
    (raw?.days ? (raw.days as any[]).flatMap((d: any) => d.exercises ?? []) : []);
  if (list.length === 0) return [];
  const s = new Set<number>();
  for (const ex of list) {
    if (ex.weeks?.length > 0) {
      for (const w of ex.weeks) { if (typeof w.week === 'number') s.add(w.week); }
      if (!s.has(1) && Array.isArray(ex.sets) && ex.sets.length > 0) s.add(1);
    } else { s.add(1); }
  }
  return Array.from(s).sort((a, b) => a - b);
}

function deriveWeekList(raw: any): number[] {
  if (Array.isArray(raw?.selectedWeeks) && raw.selectedWeeks.length > 0) {
    return [...raw.selectedWeeks].sort((a: number, b: number) => a - b);
  }
  return deriveExerciseWeeks(raw);
}

function filterByWeeks(raw: any, sel: number[]): any {
  const ws = new Set(sel);
  const keep = (ex: any) => {
    if (!ex.weeks?.length) return ws.has(1) ? ex : null;
    const filtered = ex.weeks.filter((w: any) => ws.has(w.week));
    return filtered.length ? { ...ex, weeks: filtered } : null;
  };
  if (Array.isArray(raw)) return (raw.map(keep).filter(Boolean) as any[]);
  if (raw?.days) return { ...raw, days: raw.days.map((d: any) => ({ ...d, exercises: (d.exercises ?? []).map(keep).filter(Boolean) })) };
  return raw;
}

/* ── Types matching GymTracker's WorkoutLog ─────────────────────── */
interface WorkoutSet {
  id?: string;
  reps?: number;
  weight?: number;
  unit?: 'kg' | 'lbs';
  duration?: number;
  cardioduration?: number;
  speed?: number;
  incline?: number;
  isSplit?: boolean;
  leftReps?: number;
  rightReps?: number;
  leftWeight?: number;
  rightWeight?: number;
  leftDuration?: number;
  rightDuration?: number;
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
  satisfactionRating?: number; // legacy
  effectivenessRating?: number;
  enjoymentRating?: number;
}

type ExStatus = 'completed' | 'partial' | 'none';

/* ── Completion logic (mirrors GymTracker/src/lib/completion.ts) ── */
function exStatus(ex: LoggedExercise): ExStatus {
  const targets = ex.targetSets ?? [];
  if (targets.length === 0) return ex.sets.length > 0 ? 'completed' : 'none';
  if (ex.sets.length === 0) return 'none';

  let met = 0;
  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    const a = ex.sets[i];
    if (!a) break;
    if (t.reps !== undefined) {
      const actualReps   = a.isSplit ? Math.min(a.leftReps   ?? 0, a.rightReps   ?? 0) : (a.reps   ?? 0);
      const actualWeight = a.isSplit ? Math.min(a.leftWeight ?? 0, a.rightWeight ?? 0) : (a.weight ?? 0);
      if (actualReps >= t.reps && actualWeight >= (t.weight ?? 0)) met++;
    } else if ((t.duration ?? (t as any).seconds) !== undefined) {
      const tDuration = t.duration ?? (t as any).seconds;
      const actualDuration = a.isSplit ? Math.min(a.leftDuration ?? 0, a.rightDuration ?? 0) : (a.duration ?? 0);
      if (actualDuration >= tDuration) met++;
    } else if (t.cardioduration !== undefined) {
      if ((a.cardioduration ?? 0) >= t.cardioduration) met++;
    } else {
      met++;
    }
  }

  if (met >= targets.length) return 'completed';
  return 'partial';
}

function Star({ fill, color, size = 18, uid }: { fill: number; color: string; size?: number; uid: string }) {
  const clipId = `sc-${uid}`;
  const pts = '10,1 12.9,7 19.5,7.6 14.75,11.9 16.18,18.4 10,14.9 3.82,18.4 5.25,11.9 0.5,7.6 7.1,7';
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" style={{ flexShrink: 0 }}>
      <defs>
        <clipPath id={clipId}>
          <rect x="0" y="0" width={fill * 20} height="20" />
        </clipPath>
      </defs>
      <polygon points={pts} fill="var(--border-strong)" />
      <polygon points={pts} fill={color} clipPath={`url(#${clipId})`} />
    </svg>
  );
}

function StarRating({ rating, color, ratingKey }: { rating: number; color: string; ratingKey: string }) {
  return (
    <div>
      <div style={{ display: 'flex', gap: 2, marginBottom: 4 }}>
        {[1, 2, 3, 4, 5].map(i => (
          <Star key={i} fill={Math.min(1, Math.max(0, rating - (i - 1)))} color={color} uid={`${ratingKey}-${i}`} />
        ))}
      </div>
      <p style={{ fontSize: 20, fontWeight: 800, color, margin: 0 }}>{fmtRating(rating)} / 5</p>
    </div>
  );
}
const STATUS_COLOR: Record<ExStatus, string> = {
  completed: TEAL,
  partial:   PURPLE,
  none:      '#EF4444',
};
const STATUS_BG_CSS: Record<ExStatus, string> = {
  completed: 'var(--badge-teal-bg)',
  partial:   'var(--badge-yellow-bg)',
  none:      'var(--badge-red-bg)',
};
const STATUS_TEXT_CSS: Record<ExStatus, string> = {
  completed: 'var(--badge-teal-text)',
  partial:   'var(--badge-yellow-text)',
  none:      'var(--badge-red-text)',
};
const STATUS_LABEL: Record<ExStatus, string> = {
  completed: 'Completed',
  partial:   'Partial',
  none:      'Skipped',
};

function setLabel(s: WorkoutSet, type: string): string {
  if (type === 'cardio') return s.cardioduration ? `${s.cardioduration} min` : '—';
  if (type === 'duration') {
    if (s.isSplit) return `L ${s.leftDuration ?? 0}s / R ${s.rightDuration ?? 0}s`;
    return s.duration ? `${s.duration}s` : '—';
  }
  if (s.isSplit) {
    const lw = s.leftWeight  ? ` × ${s.leftWeight}${s.unit ?? 'lbs'}`  : '';
    const rw = s.rightWeight ? ` × ${s.rightWeight}${s.unit ?? 'lbs'}` : '';
    return `L ${s.leftReps ?? 0} reps${lw} / R ${s.rightReps ?? 0} reps${rw}`;
  }
  const w = s.weight !== undefined ? `${s.weight}${s.unit ?? 'kg'}` : '';
  const r = s.reps   !== undefined ? `${s.reps} reps` : '';
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

/* ── Activity calendar ──────────────────────────────────────────── */
const PERSONAL_COLOR = '#64748b';
const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function ActivityGrid({
  dates, planDates, workouts, planNameById, isEmployer,
}: {
  dates: string[];
  planDates: string[];
  workouts: WorkoutLog[];
  planNameById: Record<string, string>;
  isEmployer?: boolean;
}) {
  const [tooltip,   setTooltip]   = useState<{ date: string; rect: DOMRect } | null>(null);
  const [modalDate, setModalDate] = useState<string | null>(null);
  const [calPage,   setCalPage]   = useState(0);

  useEffect(() => {
    if (!modalDate) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setModalDate(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [modalDate]);

  const allSet  = new Set(dates);
  const planSet = new Set(planDates);
  const today   = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr      = today.toISOString().slice(0, 10);
  const todayDow      = (today.getDay() + 6) % 7;
  const currentMonday = new Date(today.getTime() - todayDow * 86400000);
  const thisMonday    = new Date(currentMonday.getTime() - calPage * 5 * 7 * 86400000);

  const minMondayMs = workouts.length > 0
    ? (() => {
        const minDate = new Date(
          workouts.reduce((min, w) => w.date < min ? w.date : min, workouts[0].date) + 'T12:00:00'
        );
        const dow = (minDate.getDay() + 6) % 7;
        return minDate.getTime() - dow * 86400000;
      })()
    : null;
  const olderDisabled = minMondayMs !== null && thisMonday.getTime() <= minMondayMs;

  const dateMap = new Map<string, WorkoutLog[]>();
  for (const w of workouts) {
    if (!dateMap.has(w.date)) dateMap.set(w.date, []);
    dateMap.get(w.date)!.push(w);
  }

  type DayInfo = {
    date: string; dayNum: number;
    isFuture: boolean; isToday: boolean;
    hasPlan: boolean; hasPersonal: boolean;
  };
  const weeks: DayInfo[][] = [];
  for (let wk = 4; wk >= 0; wk--) {
    const week: DayInfo[] = [];
    for (let d = 0; d < 7; d++) {
      const dt = new Date(thisMonday.getTime() - wk * 7 * 86400000 + d * 86400000);
      const s  = dt.toISOString().slice(0, 10);
      week.push({
        date: s, dayNum: dt.getDate(),
        isFuture: dt > today, isToday: s === todayStr,
        hasPlan:     planSet.has(s),
        hasPersonal: allSet.has(s) && !planSet.has(s),
      });
    }
    weeks.push(week);
  }

  const fmtShort = (ds: string) => {
    const d = new Date(ds + 'T12:00:00');
    return `${MONTHS_SHORT[d.getMonth()]} ${d.getDate()}`;
  };
  const rangeLabel = `${fmtShort(weeks[0][0].date)} – ${fmtShort(weeks[4][6].date)}`;

  const wkLabel = (wi: number) => {
    if (calPage === 0 && wi === 4) return 'This week';
    if (calPage === 0 && wi === 3) return 'Last week';
    return fmtShort(weeks[wi][0].date);
  };

  const DAY_COLS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  const fmtModalDate = (ds: string) =>
    new Date(ds + 'T12:00:00').toLocaleDateString('en-CA', { weekday: 'long', month: 'long', day: 'numeric' });
  const fmtTipDate = (ds: string) =>
    new Date(ds + 'T12:00:00').toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric' });

  const modalWorkouts = modalDate ? (dateMap.get(modalDate) ?? []) : [];

  const navBtn = (disabled: boolean): React.CSSProperties => ({
    background: 'transparent',
    border: '1px solid var(--border)',
    color: 'var(--text-muted)',
    borderRadius: 8,
    padding: '4px 10px',
    fontSize: 12,
    fontWeight: 600,
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.35 : 1,
  });

  return (
    <>
      <div>
        {/* Header with pagination */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase' }}>Activity</div>
            <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>{rangeLabel}</div>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={() => setCalPage(p => p + 1)} disabled={olderDisabled} style={navBtn(olderDisabled)}>← Older</button>
            <button onClick={() => setCalPage(p => p - 1)} disabled={calPage === 0} style={navBtn(calPage === 0)}>Newer →</button>
          </div>
        </div>

        {/* Day-of-week header */}
        <div style={{ display: 'grid', gridTemplateColumns: '96px repeat(7, 1fr)', gap: '4px 6px', marginBottom: 6 }}>
          <div />
          {DAY_COLS.map(d => (
            <div key={d} style={{ textAlign: 'center', fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.03em' }}>{d}</div>
          ))}
        </div>

        {/* Week rows */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          {weeks.map((week, wi) => {
            const weekWs   = week.flatMap(day => dateMap.get(day.date) ?? []);
            const count    = weekWs.length;
            const allExs   = weekWs.flatMap(w => w.exercises ?? []);
            const withTgts = allExs.filter(ex => (ex.targetSets ?? []).length > 0);
            const done     = withTgts.filter(ex => exStatus(ex) === 'completed').length;
            const rate     = withTgts.length > 0 ? Math.round(done / withTgts.length * 100) : null;
            const ratings  = weekWs.flatMap(w =>
              [w.effectivenessRating ?? w.satisfactionRating, w.enjoymentRating]
                .filter((r): r is number => r != null && r > 0)
            );
            const avgRating = ratings.length > 0 ? ratings.reduce((a, b) => a + b, 0) / ratings.length : null;
            const parts: string[] = [];
            if (count > 0) parts.push(`${count} workout${count !== 1 ? 's' : ''}`);
            if (rate !== null) parts.push(`✓ ${rate}%`);
            if (!isEmployer && avgRating !== null) parts.push(`★ ${fmtRating(avgRating)}`);
            const statLine = parts.join(' · ');

            return (
              <div key={wi} style={{ display: 'grid', gridTemplateColumns: '96px repeat(7, 1fr)', gap: '0 6px', alignItems: 'center' }}>
                <div style={{ textAlign: 'right', paddingRight: 10 }}>
                  <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{wkLabel(wi)}</div>
                  {statLine && <div style={{ fontSize: 9, fontWeight: 500, color: 'var(--text-dim)', marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{statLine}</div>}
                </div>
                {week.map(day => {
                  const hasWorkout = !day.isFuture && dateMap.has(day.date);
                  const bg      = day.isFuture ? 'var(--border)' : day.hasPlan ? TEAL : day.hasPersonal ? PERSONAL_COLOR : 'var(--border)';
                  const opacity = day.isFuture ? 0.12 : (day.hasPlan || day.hasPersonal) ? 1 : 0.28;
                  const color   = (day.hasPlan || day.hasPersonal) && !day.isFuture ? '#fff' : 'var(--text-muted)';
                  return (
                    <div
                      key={day.date}
                      style={{
                        borderRadius: 6, padding: '7px 0',
                        background: bg, opacity,
                        textAlign: 'center', fontSize: 12, fontWeight: day.isToday ? 800 : 500,
                        color,
                        outline: day.isToday ? `2px solid ${TEAL}` : 'none',
                        outlineOffset: 1,
                        transition: 'opacity 0.12s',
                        cursor: hasWorkout ? 'pointer' : 'default',
                      }}
                      onMouseEnter={e => {
                        if (hasWorkout) setTooltip({ date: day.date, rect: (e.currentTarget as HTMLElement).getBoundingClientRect() });
                      }}
                      onMouseLeave={() => setTooltip(null)}
                      onClick={() => {
                        if (hasWorkout) { setTooltip(null); setModalDate(day.date); }
                      }}
                    >
                      {day.isFuture ? '' : day.dayNum}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>

        {/* Legend */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 16, fontSize: 11, color: 'var(--text-muted)', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <div style={{ width: 12, height: 12, borderRadius: 2, background: 'var(--border)', opacity: 0.28 }} />
            <span>No workout</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <div style={{ width: 12, height: 12, borderRadius: 2, background: PERSONAL_COLOR }} />
            <span>Personal workout</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <div style={{ width: 12, height: 12, borderRadius: 2, background: TEAL }} />
            <span>Plan workout</span>
          </div>
        </div>
      </div>

      {/* Hover tooltip */}
      {tooltip && (() => {
        const ws       = dateMap.get(tooltip.date) ?? [];
        const allExs   = ws.flatMap(w => w.exercises ?? []);
        const shown    = allExs.slice(0, 4);
        const extra    = allExs.length - shown.length;
        const { rect } = tooltip;
        return (
          <div
            style={{
              position: 'fixed',
              left: rect.left + rect.width / 2,
              top: rect.top - 10,
              transform: 'translate(-50%, -100%)',
              background: 'var(--modal-bg)',
              border: '1px solid var(--border)',
              borderRadius: 10,
              padding: '10px 14px',
              zIndex: 1000,
              pointerEvents: 'none',
              minWidth: 170,
              maxWidth: 240,
              boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
            }}
          >
            <p style={{ margin: '0 0 8px', fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>
              {fmtTipDate(tooltip.date)}
            </p>
            {shown.map((ex, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 4 }}>
                <div style={{ width: 6, height: 6, borderRadius: '50%', background: STATUS_COLOR[exStatus(ex)], flexShrink: 0 }} />
                <span style={{ fontSize: 12, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                  {ex.exercise.name}
                </span>
                <span style={{ fontSize: 11, color: 'var(--text-dim)', flexShrink: 0 }}>
                  {ex.sets.length} set{ex.sets.length !== 1 ? 's' : ''}
                </span>
              </div>
            ))}
            {extra > 0 && (
              <p style={{ margin: '2px 0 0', fontSize: 11, color: 'var(--text-dim)' }}>+{extra} more</p>
            )}
            <p style={{ margin: '8px 0 0', fontSize: 11, color: 'var(--text-dim)', borderTop: '1px solid var(--border-subtle)', paddingTop: 6 }}>
              Click to view full details
            </p>
          </div>
        );
      })()}

      {/* Workout detail modal */}
      {modalDate && (
        <div
          onMouseDown={() => setModalDate(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 400, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
        >
          <div
            onMouseDown={e => e.stopPropagation()}
            style={{ width: '100%', maxWidth: 560, maxHeight: 'calc(100vh - 80px)', background: 'var(--modal-bg)', border: '1px solid var(--border)', borderRadius: 20, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
          >
            {/* Header */}
            <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexShrink: 0 }}>
              <div>
                <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>{fmtModalDate(modalDate)}</h2>
                {modalWorkouts[0]?.duration > 0 && (
                  <p style={{ margin: '3px 0 0', fontSize: 13, color: 'var(--text-muted)' }}>{modalWorkouts[0].duration} min</p>
                )}
              </div>
              <button
                onMouseDown={e => { e.stopPropagation(); setModalDate(null); }}
                style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', fontSize: 20, cursor: 'pointer', lineHeight: 1, padding: 4, marginTop: -2 }}
              >
                ✕
              </button>
            </div>

            {/* Body */}
            <div style={{ overflowY: 'auto', padding: '20px 24px', flex: 1 }}>
              {modalWorkouts.map((w, wi) => (
                <div key={w.id} style={{ marginBottom: wi < modalWorkouts.length - 1 ? 28 : 0 }}>
                  {/* Plan badge */}
                  {w.planId && planNameById[w.planId] && (
                    <div style={{ marginBottom: 14 }}>
                      <span style={{ background: 'var(--badge-purple-bg)', color: 'var(--badge-purple-text)', fontSize: 12, fontWeight: 700, padding: '3px 10px', borderRadius: 6 }}>
                        {planNameById[w.planId]}
                      </span>
                    </div>
                  )}

                  {/* Patient notes */}
                  {w.notes?.trim() && (
                    <div style={{ background: `${TEAL}10`, border: `1px solid ${TEAL}28`, borderRadius: 10, padding: '10px 14px', marginBottom: 14, display: 'flex', gap: 8 }}>
                      <MessageSquare size={14} style={{ flexShrink: 0 }} />
                      <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)', fontStyle: 'italic' }}>"{w.notes}"</p>
                    </div>
                  )}

                  {/* Exercises */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {(w.exercises ?? []).map((ex, ei) => {
                      const st = exStatus(ex);
                      return (
                        <div key={`${ex.exercise.id}-${ei}`} style={{ border: `1px solid ${STATUS_COLOR[st]}30`, borderRadius: 10, overflow: 'hidden' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: `${STATUS_COLOR[st]}08` }}>
                            <span style={{ background: STATUS_BG_CSS[st], color: STATUS_TEXT_CSS[st], fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 999, whiteSpace: 'nowrap', flexShrink: 0 }}>
                              {STATUS_LABEL[st]}
                            </span>
                            <span style={{ fontWeight: 600, fontSize: 14, flex: 1 }}>{ex.exercise.name}</span>
                            <span style={{ fontSize: 12, color: 'var(--text-dim)', flexShrink: 0 }}>
                              {ex.sets.length} set{ex.sets.length !== 1 ? 's' : ''}
                            </span>
                          </div>
                          {ex.sets.length > 0 && (
                            <div style={{ padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 4 }}>
                              {ex.sets.map((s, si) => {
                                const target = ex.targetSets?.[si];
                                const actual = setLabel(s, ex.exercise.type);
                                const tLabel = target ? setLabel(target, ex.exercise.type) : null;
                                return (
                                  <div key={si} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13 }}>
                                    <span style={{ width: 18, color: 'var(--text-dim)', flexShrink: 0, textAlign: 'right' }}>{si + 1}</span>
                                    <span style={{ color: 'var(--text)', minWidth: 90 }}>{actual}</span>
                                    {tLabel && (
                                      <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>target: {tLabel}</span>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                          {ex.notes?.trim() && (
                            <div style={{ borderTop: `1px solid ${STATUS_COLOR[st]}20`, padding: '8px 14px', display: 'flex', gap: 6 }}>
                              <MessageSquare size={12} style={{ color: TEAL, flexShrink: 0 }} />
                              <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic' }}>"{ex.notes}"</p>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* Ratings */}
                  {(w.effectivenessRating || w.satisfactionRating || w.enjoymentRating) && (
                    <div style={{ marginTop: 16, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                      {(w.effectivenessRating ?? w.satisfactionRating) != null && (
                        <div style={{ background: `${PURPLE}15`, border: `1px solid ${PURPLE}30`, borderRadius: 10, padding: '10px 16px', flex: 1, minWidth: 130 }}>
                          <p style={{ margin: '0 0 4px', fontSize: 11, fontWeight: 700, color: PURPLE, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Effectiveness</p>
                          <p style={{ margin: 0, fontSize: 22, fontWeight: 800, color: PURPLE }}>
                            {fmtRating(w.effectivenessRating ?? w.satisfactionRating!)}
                            <span style={{ fontSize: 13, fontWeight: 400, color: 'var(--text-muted)' }}> / 5</span>
                          </p>
                        </div>
                      )}
                      {w.enjoymentRating != null && (
                        <div style={{ background: `${TEAL}15`, border: `1px solid ${TEAL}30`, borderRadius: 10, padding: '10px 16px', flex: 1, minWidth: 130 }}>
                          <p style={{ margin: '0 0 4px', fontSize: 11, fontWeight: 700, color: TEAL, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Enjoyment</p>
                          <p style={{ margin: 0, fontSize: 22, fontWeight: 800, color: TEAL }}>
                            {fmtRating(w.enjoymentRating)}
                            <span style={{ fontSize: 13, fontWeight: 400, color: 'var(--text-muted)' }}> / 5</span>
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
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

  const [practId,          setPractId]          = useState('');
  const [accessToken,      setAccessToken]      = useState('');
  const [isEmployer,       setIsEmployer]       = useState(false);

  // Assigned plans + week editing
  const [assignedPlans,    setAssignedPlans]    = useState<Array<{ id: string; name: string; weeks: number[]; allWeeks: number[]; exercisesRaw: any }>>([]);
  const [editingPlan,      setEditingPlan]      = useState<{ id: string; name: string; weeks: number[]; allWeeks: number[]; exercisesRaw: any } | null>(null);
  const [editingPlanWeeks, setEditingPlanWeeks] = useState<number[]>([]);
  const [savingPlanWeeks,  setSavingPlanWeeks]  = useState(false);

  const [showCustomEx,     setShowCustomEx]     = useState(false);
  const [showDemos,        setShowDemos]        = useState(false);
  const [showAllEx,        setShowAllEx]        = useState(false);
  const [customExName,     setCustomExName]     = useState('');
  const [customExMuscle,   setCustomExMuscle]   = useState('');
  const [customExEquip,    setCustomExEquip]    = useState('Bodyweight');
  const [customExType,     setCustomExType]     = useState<'weighted' | 'duration' | 'cardio'>('weighted');
  const [creatingCustomEx, setCreatingCustomEx] = useState(false);

  useEffect(() => {
    if (!patientId) return;
    const sb = getSupabase();

    sb.auth.getSession().then(async ({ data }) => {
      if (!data.session) { router.push('/login'); return; }

      const uid = data.session.user.id;
      setAccessToken(data.session.access_token);
      const { data: prof } = await sb.from('profiles').select('role, is_gym_owner, is_employer, display_name').eq('id', uid).single();
      if (prof?.role !== 'practitioner' && !prof?.is_gym_owner) { router.push('/profile'); return; }
      if (prof?.role === 'practitioner') {
        const hasAccess = await checkPractitionerAccess(sb, uid);
        if (!hasAccess) { router.push('/profile?subscription=expired'); return; }
      }
      setPractName(prof?.display_name ?? 'Your Practitioner');
      setPractId(uid);
      const employerFlag = !!(prof as any)?.is_employer;
      setIsEmployer(employerFlag);

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
      setPatientName(patProf?.display_name ?? (employerFlag ? 'Employee' : 'Patient'));
      setPatientEmail(patProf?.email ?? '');

      // Load workouts + plans in parallel; employers only see their assigned-plan workouts
      const [workoutResult, plansResult] = await Promise.all([
        sb.from('synced_workouts').select('data, date').eq('user_id', patientId).order('date', { ascending: false }).limit(200),
        sb.from('workout_plans').select('id, name, exercises').eq('patient_id', patientId).eq('practitioner_id', uid),
      ]);

      const rawPlans = (plansResult.data ?? []) as Array<{ id: string; name: string; exercises: any }>;
      const assignedPlanIds = new Set(rawPlans.map(p => p.id));

      let logs: WorkoutLog[] = (workoutResult.data ?? [])
        .map((r: any) => r.data as WorkoutLog)
        .filter(Boolean);

      if (employerFlag) {
        logs = logs.filter(w => w.planId && assignedPlanIds.has(w.planId));
      }

      setWorkouts(logs);

      // Store assigned plans for week editing
      setAssignedPlans(rawPlans.map((p) => ({
        id: p.id,
        name: p.name ?? 'Untitled Plan',
        weeks: deriveWeekList(p.exercises),
        allWeeks: deriveExerciseWeeks(p.exercises),
        exercisesRaw: p.exercises,
      })));

      const exerciseNames = new Set<string>();
      for (const plan of rawPlans) {
        const exList: any[] = Array.isArray(plan.exercises)
          ? plan.exercises
          : (plan.exercises?.days ?? []).flatMap((d: any) => d.exercises ?? []);
        for (const ex of exList) {
          const name = (ex?.exercise as Record<string, unknown> | undefined)?.name ?? ex?.name;
          if (typeof name === 'string') exerciseNames.add(name);
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

  const handleSavePlanWeeks = async () => {
    if (!editingPlan || editingPlanWeeks.length === 0) return;
    setSavingPlanWeeks(true);
    const raw = editingPlan.exercisesRaw;
    const newRaw = Array.isArray(raw) ? raw : { ...raw, selectedWeeks: editingPlanWeeks };
    const { error } = await getSupabase()
      .from('workout_plans')
      .update({ exercises: newRaw })
      .eq('id', editingPlan.id);
    if (!error) {
      setAssignedPlans(prev => prev.map(p =>
        p.id === editingPlan.id ? { ...p, weeks: editingPlanWeeks, exercisesRaw: newRaw } : p
      ));
      setEditingPlan(null);
    }
    setSavingPlanWeeks(false);
  };

  const handleSendEmail = async () => {
    if (!emailSubject.trim() || !emailBody.trim()) return;
    setSending(true);
    setSendResult(null);
    try {
      const res = await fetch('/api/send-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` },
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

  const handleCreateCustomExercise = async () => {
    if (!customExName.trim()) return;
    setCreatingCustomEx(true);
    const exId = `custom_${Date.now()}`;
    const exercises = {
      days: [{ id: 'day-1', label: 'Day 1', exercises: [{
        id: exId,
        exercise: { id: exId, name: customExName.trim(), muscleGroup: customExMuscle, equipment: customExEquip || 'Bodyweight', type: customExType },
        sets: [{ reps: 10 }, { reps: 10 }, { reps: 10 }],
        weeks: [],
        unit: 'kg',
        rest: 60,
      }] }],
      frequencyPerWeek: 1,
    };
    const { data, error } = await getSupabase()
      .from('plan_templates')
      .insert({ practitioner_id: practId, name: customExName.trim(), description: null, exercises })
      .select()
      .single();
    setCreatingCustomEx(false);
    if (!error && data) {
      setShowCustomEx(false);
      setCustomExName('');
      setCustomExMuscle('');
      setCustomExEquip('Bodyweight');
      setCustomExType('weighted');
      router.push(`/plans/library/${data.id}`);
    }
  };

  /* ── Plan ID set (needed for both charts and calendar) ── */
  const assignedPlanIdSet = new Set(assignedPlans.map(p => p.id));
  // Only workouts belonging to plans this practitioner assigned
  const planWorkouts = workouts.filter(w => w.planId && assignedPlanIdSet.has(w.planId));

  /* ── Week groups ── */
  const weekMap = new Map<string, WorkoutLog[]>();
  for (const w of workouts) {
    const key = getWeekStartDate(w.date);
    if (!weekMap.has(key)) weekMap.set(key, []);
    weekMap.get(key)!.push(w);
  }
  const sortedWeekKeys = [...weekMap.keys()].sort().reverse();
  const chronoWeekKeys = [...sortedWeekKeys].reverse(); // oldest → newest

  /* ── Progress chart data (plan workouts only) ── */
  const weekTrends = chronoWeekKeys.map(key => {
    const ws  = weekMap.get(key)!;
    // Completion rate counts only this PT's assigned plan workouts
    const planWs = ws.filter(w => w.planId && assignedPlanIdSet.has(w.planId));
    const exs = planWs.flatMap(w => w.exercises ?? []);
    const withT = exs.filter(e => (e.targetSets ?? []).length > 0);
    const done  = withT.filter(e => exStatus(e) === 'completed').length;
    // Show 0% (not blank) when plans are assigned but none were completed that week
    const rate  = withT.length > 0 ? Math.round((done / withT.length) * 100) : (assignedPlanIdSet.size > 0 ? 0 : null);
    // Sets per week still counts all workouts (personal + plan) for volume context
    const totalSets = ws.flatMap(w => w.exercises ?? []).reduce((a, e) => a + e.sets.length, 0);
    const { badge } = weekLabel(key);
    const shortLabel = new Date(key + 'T12:00:00').toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });
    return { key, shortLabel, badge, rate, totalSets };
  });

  // Trend summary
  const recentRates = weekTrends.slice(-3).map(wt => wt.rate).filter((r): r is number => r !== null);
  const rateChange = recentRates.length >= 2 ? recentRates[recentRates.length - 1] - recentRates[recentRates.length - 2] : null;
  const trendSummaryText = rateChange === null ? null : rateChange > 5 ? 'Completion trending up ↑' : rateChange < -5 ? 'Completion trending down ↓' : 'Completion stable →';
  const trendSummaryColor = rateChange === null ? 'var(--text-dim)' : rateChange > 5 ? TEAL : rateChange < -5 ? '#EF4444' : 'var(--text-muted)';

  /* ── Plan exercise names (for filtering progression) ── */
  const planExerciseNames = new Set<string>();
  for (const plan of assignedPlans) {
    const raw = plan.exercisesRaw;
    const exList: any[] = Array.isArray(raw)
      ? raw
      : (raw?.days ?? []).flatMap((d: any) => d.exercises ?? []);
    for (const ex of exList) {
      const name = (ex?.exercise as any)?.name ?? ex?.name;
      if (typeof name === 'string') planExerciseNames.add(name);
    }
  }

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
    .filter(([name, e]) => e.length >= 2 && (planExerciseNames.size === 0 || planExerciseNames.has(name)))
    .sort(([, a], [, b]) => b.length - a.length)
    .slice(0, 8);

  /* ── Plan lookup ── */
  const planNameById = Object.fromEntries(assignedPlans.map(p => [p.id, p.name]));

  /* ── Activity calendar data ── */
  const allDates  = workouts.map(w => w.date);
  const planDates = workouts.filter(w => w.planId && assignedPlanIdSet.has(w.planId)).map(w => w.date);

  /* ── Stats (all scoped to this PT's assigned plan workouts) ── */
  const totalWorkouts  = workouts.length;
  const withPlan       = planWorkouts;
  const allPlanExercises = planWorkouts.flatMap(w => w.exercises ?? []);
  const withTargets    = allPlanExercises.filter(e => (e.targetSets ?? []).length > 0);
  const completedCount = withTargets.filter(e => exStatus(e) === 'completed').length;
  const completionRate = withTargets.length > 0 ? Math.round((completedCount / withTargets.length) * 100) : null;
  const effectivenessRatings = planWorkouts.map(w => w.effectivenessRating ?? w.satisfactionRating).filter((r): r is number => typeof r === 'number' && r > 0);
  const enjoymentRatings     = planWorkouts.map(w => w.enjoymentRating).filter((r): r is number => typeof r === 'number' && r > 0);
  const avgEffectiveness     = effectivenessRatings.length ? effectivenessRatings.reduce((a, b) => a + b, 0) / effectivenessRatings.length : null;
  const avgEnjoyment         = enjoymentRatings.length ? enjoymentRatings.reduce((a, b) => a + b, 0) / enjoymentRatings.length : null;

  /* ── Loading / error ── */
  if (loading || !authed) {
    if (noAccess) return (
      <div style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p style={{ color: 'var(--text-muted)' }}>You don't have access to this {isEmployer ? 'employee' : 'patient'}'s data.</p>
      </div>
    );
    return (
      <SkPage>
        <SkSubHeader />
        <main style={{ maxWidth: 900, margin: '0 auto', padding: '32px 24px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 14, marginBottom: 28 }}>
            {[0,1,2,3,4].map(i => (
              <div key={i} style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16, padding: '18px 20px' }}>
                <Sk width={90} height={11} radius={3} style={{ marginBottom: 12 }} />
                <Sk width={60} height={26} radius={6} />
              </div>
            ))}
          </div>
          <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 20, padding: '24px', marginBottom: 16 }}>
            <Sk width={140} height={16} style={{ marginBottom: 20 }} />
            <Sk width="100%" height={110} radius={12} />
          </div>
          {[0,1,2].map(i => (
            <div key={i} style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16, padding: '18px 24px', marginBottom: 10 }}>
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
    <div style={{ minHeight: '100vh', background: 'var(--bg)', color: 'var(--text)', fontFamily: 'sans-serif' }}>

      {/* Email modal */}
      {emailOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div style={{ width: '100%', maxWidth: 520, background: 'var(--modal-bg)', border: '1px solid var(--border)', borderRadius: 20, padding: 32 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
              <h2 style={{ margin: 0, fontWeight: 700, fontSize: 18 }}>Email {patientName}</h2>
              <button onClick={() => { setEmailOpen(false); setSendResult(null); }} style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', fontSize: 20, cursor: 'pointer', lineHeight: 1 }}>✕</button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>To</label>
                <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 14px', fontSize: 14, color: 'var(--text-muted)' }}>
                  {patientName} &lt;{patientEmail}&gt;
                </div>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Subject</label>
                <input
                  value={emailSubject}
                  onChange={e => setEmailSubject(e.target.value)}
                  placeholder="e.g. Great progress this week!"
                  style={{ width: '100%', background: 'var(--card-alt)', border: '1px solid var(--border-strong)', borderRadius: 10, padding: '10px 14px', color: 'var(--text)', fontSize: 14, outline: 'none', boxSizing: 'border-box' }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Message</label>
                <textarea
                  value={emailBody}
                  onChange={e => setEmailBody(e.target.value)}
                  placeholder="Write your message here…"
                  rows={7}
                  style={{ width: '100%', background: 'var(--card-alt)', border: '1px solid var(--border-strong)', borderRadius: 10, padding: '10px 14px', color: 'var(--text)', fontSize: 14, outline: 'none', boxSizing: 'border-box', resize: 'vertical', fontFamily: 'sans-serif' }}
                />
              </div>
              {sendResult === 'ok' && (
                <p style={{ color: TEAL, fontSize: 13, margin: 0 }}>Email sent successfully.</p>
              )}
              {sendResult === 'error' && (
                <p style={{ color: '#EF4444', fontSize: 13, margin: 0 }}>Failed to send. Please try again.</p>
              )}
              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                <button onClick={() => { setEmailOpen(false); setSendResult(null); }} style={{ background: 'transparent', border: '1px solid var(--border-strong)', color: 'var(--text-muted)', borderRadius: 10, padding: '10px 20px', fontSize: 14, cursor: 'pointer' }}>
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
      <div style={{ borderBottom: '1px solid var(--border-subtle)', padding: '12px 32px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>
          <a href="/plans" style={{ color: 'var(--text-muted)', textDecoration: 'none' }}>Plans</a>
          {' / '}{patientName}
        </span>
        <div style={{ display: 'flex', gap: 10 }}>
          {patientEmail && (
            <button
              onClick={() => { setEmailOpen(true); setSendResult(null); }}
              style={{ background: 'var(--btn-purple-bg)', border: '1px solid var(--btn-purple-border)', color: 'var(--btn-purple-text)', borderRadius: 10, padding: '8px 18px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
            >
              ✉ Email {isEmployer ? 'Employee' : 'Patient'}
            </button>
          )}
          <button
            onClick={() => setShowCustomEx(true)}
            style={{ background: 'rgba(95,207,191,0.1)', border: `1px solid ${TEAL}`, color: TEAL, borderRadius: 10, padding: '8px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
          >
            + Create Custom Exercise
          </button>
          <button
            onClick={() => router.push('/plans')}
            style={{ background: 'var(--card-alt)', border: '1px solid var(--border-strong)', color: 'var(--text-muted)', borderRadius: 10, padding: '8px 16px', fontSize: 13, cursor: 'pointer' }}
          >
            ← Plans
          </button>
        </div>
      </div>

      <main style={{ maxWidth: 1100, margin: '0 auto', padding: '40px 32px' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 20, marginBottom: 32 }}>
          <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'var(--badge-purple-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, fontWeight: 700, color: 'var(--badge-purple-text)', flexShrink: 0 }}>
            {getInitials(patientName)}
          </div>
          <div>
            <h1 style={{ fontSize: 26, fontWeight: 800, margin: 0 }}>{patientName}</h1>
            <p style={{ color: 'var(--text-muted)', fontSize: 14, margin: '4px 0 0' }}>Workout Progress</p>
          </div>
        </div>

        {/* Stats row */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12, marginBottom: 36 }}>
          {[
            { label: 'Total Workouts',    value: String(totalWorkouts),                                                       color: TEAL   },
            { label: 'Assigned Workouts',     value: String(withPlan.length),                                                     color: PURPLE },
            { label: 'Completion Rate',   value: completionRate !== null ? `${completionRate}%` : '—',                        color: PURPLE },
            ...(!isEmployer ? [
              { label: 'Avg Effectiveness', value: '—', color: PURPLE, node: avgEffectiveness !== null ? <StarRating rating={avgEffectiveness} color={PURPLE} ratingKey="eff" /> : null },
              { label: 'Avg Enjoyment',     value: '—', color: TEAL,   node: avgEnjoyment !== null ? <StarRating rating={avgEnjoyment} color={TEAL} ratingKey="enj" /> : null },
            ] : []),
          ].map(s => (
            <div key={s.label} style={{ background: 'var(--card)', border: `1px solid var(--input-bg)`, borderRadius: 14, padding: '18px 20px' }}>
              <p style={{ color: 'var(--text-muted)', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 6px' }}>{s.label}</p>
              {'node' in s && s.node != null ? s.node : <p style={{ fontSize: 22, fontWeight: 800, color: s.color, margin: 0 }}>{s.value}</p>}
            </div>
          ))}
        </div>

        {/* ── Activity Calendar ── */}
        {workouts.length > 0 && (
          <div style={{ background: 'var(--card)', border: '1px solid var(--border-subtle)', borderRadius: 16, padding: '20px 22px', marginBottom: 24 }}>
            <ActivityGrid dates={allDates} planDates={planDates} workouts={workouts} planNameById={planNameById} isEmployer={isEmployer} />
          </div>
        )}

        {/* ── Assigned Plans ── */}
        {assignedPlans.length > 0 && (
          <div style={{ marginBottom: 36 }}>
            <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 14px' }}>
              Assigned Plans · {assignedPlans.length}
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {assignedPlans.map(plan => (
                <div key={plan.id} onClick={() => router.push(`/plans/new?edit=${plan.id}`)} style={{ background: 'var(--card)', border: '1px solid var(--border-subtle)', borderRadius: 14, padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', cursor: 'pointer' }}>
                  <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--text)', flex: 1, minWidth: 0 }}>{plan.name}</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    {plan.weeks.map(w => (
                      <span key={w} style={{ background: `${PURPLE}25`, color: PURPLE, fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 999 }}>W{w}</span>
                    ))}
                    {plan.allWeeks.length > 1 && (
                      <button
                        onClick={e => { e.stopPropagation(); setEditingPlan(plan); setEditingPlanWeeks([...plan.weeks]); }}
                        style={{ background: `${PURPLE}20`, border: `1px solid ${PURPLE}50`, color: PURPLE, borderRadius: 8, padding: '3px 10px', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}
                      >
                        Edit Weeks
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Progress section ── */}
        {weekTrends.length >= 2 && (
          <div style={{ marginBottom: 36 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 14, flexWrap: 'wrap' }}>
              <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', margin: 0 }}>Progress Over Time</p>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{weekTrends.length} week{weekTrends.length !== 1 ? 's' : ''} tracked</span>
              {trendSummaryText && <span style={{ fontSize: 12, fontWeight: 700, color: trendSummaryColor, marginLeft: 'auto' }}>{trendSummaryText}</span>}
            </div>

            {/* Trend charts row */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>

              {/* Completion rate */}
              <div style={{ background: 'var(--card)', border: '1px solid var(--border-subtle)', borderRadius: 14, padding: '16px 18px' }}>
                <p style={{ margin: '0 0 14px', fontSize: 11, fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Completion Rate</p>
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: 5, height: 72 }}>
                  {weekTrends.map(wt => {
                    const h = wt.rate !== null ? Math.max(4, (wt.rate / 100) * 64) : 4;
                    const col = wt.rate === null ? 'var(--input-bg)' : wt.rate >= 80 ? TEAL : wt.rate >= 50 ? PURPLE : '#EF4444';
                    return (
                      <div key={wt.key} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', height: '100%' }}>
                        {wt.rate !== null && <span style={{ fontSize: 9, color: 'var(--text-muted)', marginBottom: 3 }}>{wt.rate}%</span>}
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
                        <span style={{ fontSize: 9, color: wt.badge ? TEAL : 'var(--text-faint)' }}>
                          {showLabel ? (wt.badge ?? wt.shortLabel) : ''}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Volume */}
              <div style={{ background: 'var(--card)', border: '1px solid var(--border-subtle)', borderRadius: 14, padding: '16px 18px' }}>
                <p style={{ margin: '0 0 14px', fontSize: 11, fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Sets per Week</p>
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
                              <span style={{ fontSize: 9, color: 'var(--text-muted)', marginBottom: 3 }}>{wt.totalSets}</span>
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
                                  <span style={{ fontSize: 9, color: wt.badge ? PURPLE : 'var(--text-faint)', display: 'block' }}>{wt.badge ?? wt.shortLabel}</span>
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
              <div style={{ background: 'var(--card)', border: '1px solid var(--border-subtle)', borderRadius: 14, padding: '16px 18px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                  <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Exercise Progression</p>
                  {progressExercises.length > 5 && (
                    <button onClick={() => setShowAllEx(v => !v)} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 12, color: TEAL, fontWeight: 600 }}>
                      {showAllEx ? 'Show less' : `View all ${progressExercises.length}`}
                    </button>
                  )}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  {(showAllEx ? progressExercises : progressExercises.slice(0, 5)).map(([name, entries]) => {
                    const latest   = entries[entries.length - 1];
                    const prev     = entries[entries.length - 2];
                    const isW      = latest.type === 'weighted';
                    const fmt      = (e: typeof entries[0]) => isW ? `${e.best} ${e.unit ?? 'kg'}` : `${e.best}s`;
                    const delta    = prev.best > 0 ? ((latest.best - prev.best) / prev.best) * 100 : 0;
                    const trend    = delta > 1 ? '↑' : delta < -1 ? '↓' : '→';
                    const trendCol = delta > 1 ? TEAL : delta < -30 ? '#EF4444' : delta < -1 ? PURPLE : 'var(--text-dim)';
                    const maxVal   = Math.max(...entries.map(e => e.best), 1);
                    const W = 120, H = 32, pad = 4;
                    const pts = entries.map((e, i) => {
                      const x = pad + (i / Math.max(entries.length - 1, 1)) * (W - pad * 2);
                      const y = H - pad - ((e.best / maxVal) * (H - pad * 2));
                      return [x, y] as [number, number];
                    });
                    const polyline = pts.map(([x, y]) => `${x},${y}`).join(' ');
                    const area = `${pts[0][0]},${H} ` + pts.map(([x, y]) => `${x},${y}`).join(' ') + ` ${pts[pts.length - 1][0]},${H}`;
                    const [ex, ey] = pts[pts.length - 1];
                    const gradId = `sg-${name.replace(/\s+/g, '-')}`;
                    return (
                      <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</p>
                          <p style={{ margin: '3px 0 0', fontSize: 12, color: 'var(--text-muted)' }}>
                            {fmt(prev)} → <span style={{ color: 'var(--text)', fontWeight: 600 }}>{fmt(latest)}</span>
                            {Math.abs(delta) >= 1 && (
                              <span style={{ marginLeft: 8, color: trendCol, fontWeight: 700 }}>
                                {delta > 0 ? '+' : ''}{Math.round(delta)}%
                              </span>
                            )}
                          </p>
                        </div>
                        {/* SVG sparkline */}
                        <svg width={W} height={H} style={{ flexShrink: 0, overflow: 'visible' }}>
                          <defs>
                            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%" stopColor={TEAL} stopOpacity={0.25} />
                              <stop offset="100%" stopColor={TEAL} stopOpacity={0} />
                            </linearGradient>
                          </defs>
                          <polygon points={area} fill={`url(#${gradId})`} />
                          <polyline points={polyline} fill="none" stroke={TEAL} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
                          <circle cx={ex} cy={ey} r={3} fill={TEAL} />
                        </svg>
                        <div style={{ width: 20, textAlign: 'center', fontSize: 18, fontWeight: 800, color: trendCol, flexShrink: 0 }}>{trend}</div>
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
          <div style={{ background: 'var(--card)', border: '1px solid var(--border-subtle)', borderRadius: 14, marginBottom: 36, overflow: 'hidden' }}>
            <button
              onClick={() => setShowDemos(v => !v)}
              style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, background: 'none', border: 'none', cursor: 'pointer', padding: '16px 18px', borderBottom: showDemos ? '1px solid var(--border-subtle)' : 'none' }}
            >
              <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', margin: 0, flex: 1, textAlign: 'left' }}>
                Exercise Demos · {exerciseDemos.length}
              </p>
              <span style={{ fontSize: 11, color: 'var(--text-dim)', transform: showDemos ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s', display: 'inline-block' }}>▾</span>
            </button>
            {showDemos && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 12, padding: 16 }}>
              {exerciseDemos.map(demo => {
                const signedUrl = demoSignedUrls[demo.id];
                return (
                  <div key={demo.id} style={{ background: 'var(--card-alt)', border: '1px solid var(--border-subtle)', borderRadius: 14, overflow: 'hidden' }}>
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
                        style={{ width: '100%', height: 120, background: '#1a1a2e', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 32, color: 'var(--text)' }}
                      >▶</div>
                    ) : (
                      <div style={{ width: '100%', height: 120, background: '#0f2a1a', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 32 }}>🔗</div>
                    )}
                    <div style={{ padding: '12px 14px' }}>
                      <p style={{ fontWeight: 700, fontSize: 13, margin: '0 0 8px', color: 'var(--text)' }}>{demo.exercise_name}</p>
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
            )}
          </div>
        )}

        {/* No-workout empty state */}
        {workouts.length === 0 && (
          <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 20, padding: 60, textAlign: 'center' }}>
            <p style={{ fontSize: 36, marginBottom: 12 }}>📭</p>
            <p style={{ color: 'var(--text-muted)' }}>No workouts synced yet for this {isEmployer ? 'employee' : 'patient'}.</p>
          </div>
        )}
      </main>

      {/* Create Custom Exercise modal */}
      {showCustomEx && (
        <div onClick={() => setShowCustomEx(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200, padding: 24 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'var(--modal-bg)', border: '1px solid var(--border)', borderRadius: 20, padding: 32, width: '100%', maxWidth: 480, maxHeight: 'calc(100vh - 80px)', overflowY: 'auto' }}>
            <h2 style={{ fontWeight: 700, fontSize: 18, margin: '0 0 4px' }}>Create Custom Exercise</h2>
            <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 20 }}>Creates a new plan with this exercise pre-added. You can edit details after.</p>

            <label style={{ display: 'block', color: 'var(--text-muted)', fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Exercise Name</label>
            <input
              autoFocus
              value={customExName}
              onChange={e => setCustomExName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleCreateCustomExercise(); if (e.key === 'Escape') setShowCustomEx(false); }}
              placeholder="e.g. Bulgarian Split Squat"
              style={{ width: '100%', boxSizing: 'border-box', background: 'var(--card-alt)', border: `1px solid ${TEAL}`, borderRadius: 10, padding: '10px 14px', color: 'var(--text)', fontSize: 14, outline: 'none', marginBottom: 16 }}
            />

            <label style={{ display: 'block', color: 'var(--text-muted)', fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Muscle Group</label>
            <div style={{ marginBottom: 16 }}>
              {[
                { label: 'Upper', members: ['Chest','Shoulders','Back','Biceps','Triceps','Forearms'] },
                { label: 'Lower', members: ['Quadriceps','Hamstrings','Glutes','Calves','Adductors'] },
                { label: 'Core', members: ['Core'] },
                { label: 'Activity', members: ['Cardio','Plyometrics','Balance','Isometrics','Pilates','Yoga'] },
                { label: 'Rehab', members: ['Hip Flexors','Rotator Cuff','Lumbar','Cervical','Ankle & Foot'] },
              ].map(sec => (
                <div key={sec.label} style={{ marginBottom: 8 }}>
                  <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: 4 }}>{sec.label}</span>
                  <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                    {sec.members.map(mg => (
                      <button key={mg} onClick={() => setCustomExMuscle(mg)} style={{ padding: '4px 10px', borderRadius: 16, fontSize: 11, fontWeight: 600, border: 'none', cursor: 'pointer', background: customExMuscle === mg ? TEAL : 'var(--input-bg)', color: customExMuscle === mg ? '#0f1117' : 'var(--text-muted)' }}>{mg}</button>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <label style={{ display: 'block', color: 'var(--text-muted)', fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Equipment</label>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
              {['Barbell','Dumbbell','Kettlebell','Cable','Machine','Bodyweight','Other'].map(eq => (
                <button key={eq} onClick={() => setCustomExEquip(eq)} style={{ padding: '4px 10px', borderRadius: 16, fontSize: 11, fontWeight: 600, border: 'none', cursor: 'pointer', background: customExEquip === eq ? TEAL : 'var(--input-bg)', color: customExEquip === eq ? '#0f1117' : 'var(--text-muted)' }}>{eq}</button>
              ))}
            </div>

            <label style={{ display: 'block', color: 'var(--text-muted)', fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Tracking Type</label>
            <div style={{ display: 'flex', gap: 6, marginBottom: 24 }}>
              {([['weighted','Weight + Reps'],['duration','Duration'],['cardio','Cardio']] as const).map(([val, label]) => (
                <button key={val} onClick={() => setCustomExType(val)} style={{ padding: '6px 14px', borderRadius: 16, fontSize: 12, fontWeight: 600, border: 'none', cursor: 'pointer', background: customExType === val ? TEAL : 'var(--input-bg)', color: customExType === val ? '#0f1117' : 'var(--text-muted)' }}>{label}</button>
              ))}
            </div>

            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setShowCustomEx(false)} style={{ flex: 1, background: 'var(--card-alt)', border: '1px solid var(--border-strong)', color: 'var(--text-muted)', borderRadius: 10, padding: '11px 0', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>Cancel</button>
              <button
                onClick={handleCreateCustomExercise}
                disabled={!customExName.trim() || creatingCustomEx}
                style={{ flex: 2, background: customExName.trim() ? TEAL : 'var(--input-bg)', color: customExName.trim() ? '#0f1117' : 'var(--text-dim)', borderRadius: 10, padding: '11px 0', fontWeight: 700, fontSize: 14, border: 'none', cursor: customExName.trim() ? 'pointer' : 'not-allowed' }}
              >
                {creatingCustomEx ? 'Creating…' : `Create "${customExName.trim() || 'exercise'}"`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Plan Weeks modal */}
      {editingPlan && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div style={{ background: 'var(--modal-bg)', border: '1px solid var(--border)', borderRadius: 20, padding: 32, width: '100%', maxWidth: 420 }}>
            <h2 style={{ margin: '0 0 6px', fontWeight: 700, fontSize: 18 }}>Edit Weeks</h2>
            <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: '0 0 22px' }}>{editingPlan.name}</p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20 }}>
              {editingPlan.allWeeks.map(w => {
                const on = editingPlanWeeks.includes(w);
                return (
                  <button
                    key={w}
                    onClick={() => setEditingPlanWeeks(prev => on ? prev.filter(x => x !== w) : [...prev, w].sort((a, b) => a - b))}
                    style={{ padding: '8px 18px', borderRadius: 10, fontWeight: 700, fontSize: 14, cursor: 'pointer', border: `1.5px solid ${on ? PURPLE : 'var(--border-strong)'}`, background: on ? `${PURPLE}25` : 'var(--card-alt)', color: on ? PURPLE : 'var(--text-muted)' }}
                  >
                    Week {w}
                  </button>
                );
              })}
            </div>
            {editingPlanWeeks.length < editingPlan.allWeeks.length && (
              <p style={{ color: PURPLE, fontSize: 12, margin: '0 0 18px' }}>
                Deselected weeks will be removed from this {isEmployer ? 'employee' : 'patient'}'s plan.
              </p>
            )}
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={() => setEditingPlan(null)} style={{ background: 'transparent', border: '1px solid var(--border-strong)', color: 'var(--text-muted)', borderRadius: 10, padding: '10px 20px', fontSize: 14, cursor: 'pointer' }}>
                Cancel
              </button>
              <button
                onClick={handleSavePlanWeeks}
                disabled={savingPlanWeeks || editingPlanWeeks.length === 0}
                style={{ background: editingPlanWeeks.length > 0 ? PURPLE : 'var(--input-bg)', color: editingPlanWeeks.length > 0 ? '#fff' : 'var(--text-dim)', borderRadius: 10, padding: '10px 24px', fontWeight: 700, fontSize: 14, border: 'none', cursor: savingPlanWeeks || editingPlanWeeks.length === 0 ? 'not-allowed' : 'pointer', opacity: savingPlanWeeks ? 0.7 : 1 }}
              >
                {savingPlanWeeks ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Demo viewer */}
      {viewDemo && (
        <div
          onClick={() => setViewDemo(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.92)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', zIndex: 300, padding: 24 }}
        >
          <div onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 860 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <p style={{ color: 'var(--text)', fontWeight: 700, fontSize: 17, margin: 0 }}>{viewDemo.name}</p>
              <button onClick={() => setViewDemo(null)} style={{ background: 'var(--border)', border: 'none', color: 'var(--text)', borderRadius: 8, width: 36, height: 36, fontSize: 20, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
            </div>
            {viewDemo.type === 'photo' ? (
              <img src={viewDemo.url} alt={viewDemo.name} style={{ width: '100%', borderRadius: 12, maxHeight: '80vh', objectFit: 'contain' }} />
            ) : (
              <video src={viewDemo.url} controls autoPlay style={{ width: '100%', borderRadius: 12, maxHeight: '80vh', background: '#000' }} />
            )}
            <p style={{ color: 'var(--text-dim)', fontSize: 12, textAlign: 'center', marginTop: 12 }}>Click outside to close</p>
          </div>
        </div>
      )}
    </div>
  );
}
