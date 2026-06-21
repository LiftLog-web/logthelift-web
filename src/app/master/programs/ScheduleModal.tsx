'use client';

import { useState } from 'react';
import { DayPicker } from 'react-day-picker';
import type { DateRange } from 'react-day-picker';
import 'react-day-picker/style.css';
import { addMonths, startOfMonth, endOfMonth, format } from 'date-fns';

const TEAL = '#5fcfbf';

interface Props {
  programName:  string;
  currentFrom:  string | null;
  currentUntil: string | null;
  saving:       boolean;
  onSave:       (from: string, until: string) => void;
  onClose:      () => void;
}

function getMonthOptions(): Date[] {
  const months: Date[] = [];
  const base = new Date();
  for (let i = 1; i <= 12; i++) months.push(startOfMonth(addMonths(base, i)));
  return months;
}

function initSelectedMonths(from: string | null, until: string | null): Set<string> {
  const s = new Set<string>();
  if (!from || !until) return s;
  let cur = startOfMonth(new Date(from + 'T12:00:00'));
  const end = new Date(until + 'T12:00:00');
  while (cur <= end) {
    s.add(format(cur, 'yyyy-MM'));
    cur = addMonths(cur, 1);
  }
  return s;
}

export default function ScheduleModal({ programName, currentFrom, currentUntil, saving, onSave, onClose }: Props) {
  const [tab, setTab] = useState<'month' | 'custom'>('month');

  const [selectedMonths, setSelectedMonths] = useState<Set<string>>(() =>
    initSelectedMonths(currentFrom, currentUntil)
  );

  const [range, setRange] = useState<DateRange | undefined>(() =>
    currentFrom && currentUntil
      ? { from: new Date(currentFrom + 'T12:00:00'), to: new Date(currentUntil + 'T12:00:00') }
      : undefined
  );

  const monthOptions = getMonthOptions();

  function toggleMonth(key: string) {
    setSelectedMonths(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  function getMonthRange() {
    if (selectedMonths.size === 0) return null;
    const sorted = [...selectedMonths].sort();
    return {
      from:  format(startOfMonth(new Date(sorted[0] + '-01T12:00:00')), 'yyyy-MM-dd'),
      until: format(endOfMonth(new Date(sorted[sorted.length - 1] + '-01T12:00:00')), 'yyyy-MM-dd'),
    };
  }

  function handleSave() {
    if (tab === 'month') {
      const r = getMonthRange();
      if (r) onSave(r.from, r.until);
    } else {
      if (range?.from && range?.to) onSave(format(range.from, 'yyyy-MM-dd'), format(range.to, 'yyyy-MM-dd'));
    }
  }

  const monthRange   = getMonthRange();
  const canSave      = tab === 'month' ? selectedMonths.size > 0 : !!(range?.from && range?.to);

  return (
    <div
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1001, padding: '24px' }}
    >
      <style>{`
        .liftlog-rdp {
          --rdp-accent-color: ${TEAL};
          --rdp-accent-background-color: ${TEAL}22;
          color: var(--text);
        }
        .liftlog-rdp .rdp-month_caption_label { color: var(--text); font-weight: 700; }
        .liftlog-rdp .rdp-nav button { color: var(--text-dim); }
        .liftlog-rdp .rdp-weekday { color: var(--text-dim); font-size: 11px; }
        .liftlog-rdp .rdp-day_button { color: var(--text); border-radius: 8px; }
        .liftlog-rdp .rdp-day_button:hover:not([disabled]) { background: var(--border-strong) !important; }
        .liftlog-rdp .rdp-range_middle { background: ${TEAL}18; }
        .liftlog-rdp .rdp-selected .rdp-day_button { color: ${TEAL}; }
        .liftlog-rdp .rdp-range_start .rdp-day_button,
        .liftlog-rdp .rdp-range_end .rdp-day_button { background: ${TEAL} !important; color: #0f1117 !important; font-weight: 700; }
        .liftlog-rdp .rdp-today .rdp-day_button { border: 1.5px solid ${TEAL}60; }
        .liftlog-rdp .rdp-outside { opacity: 0.3; }
      `}</style>

      <div style={{ background: 'var(--modal-bg)', border: '1px solid var(--border)', borderRadius: 24, padding: '32px', width: '100%', maxWidth: 480 }}>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
          <h2 style={{ fontSize: 18, fontWeight: 800, margin: 0 }}>Schedule Program</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-dim)', fontSize: 24, cursor: 'pointer', lineHeight: 1, padding: '0 4px' }}>×</button>
        </div>
        <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: '0 0 22px' }}>{programName}</p>

        {/* Tab switcher */}
        <div style={{ display: 'flex', background: 'var(--input-bg)', borderRadius: 10, padding: 4, marginBottom: 22, gap: 4 }}>
          {(['month', 'custom'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={{
                flex: 1, border: 'none', borderRadius: 8, padding: '8px 0',
                fontSize: 13, fontWeight: 700, cursor: 'pointer',
                background: tab === t ? 'var(--card)' : 'transparent',
                color: tab === t ? 'var(--text)' : 'var(--text-dim)',
                transition: 'background 0.15s',
              }}
            >
              {t === 'month' ? 'By Month' : 'Custom Range'}
            </button>
          ))}
        </div>

        {tab === 'month' && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 16 }}>
              {monthOptions.map(m => {
                const key = format(m, 'yyyy-MM');
                const sel = selectedMonths.has(key);
                return (
                  <button
                    key={key}
                    onClick={() => toggleMonth(key)}
                    style={{
                      border: `1.5px solid ${sel ? TEAL : 'var(--border-strong)'}`,
                      borderRadius: 10, padding: '10px 6px',
                      background: sel ? `${TEAL}18` : 'transparent',
                      color: sel ? TEAL : 'var(--text-dim)',
                      fontSize: 13, fontWeight: 700, cursor: 'pointer',
                      transition: 'all 0.15s',
                    }}
                  >
                    {format(m, 'MMM yyyy')}
                  </button>
                );
              })}
            </div>

            {monthRange ? (
              <div style={{ background: `${TEAL}12`, border: `1px solid ${TEAL}30`, borderRadius: 10, padding: '10px 14px', fontSize: 13, color: TEAL, fontWeight: 600 }}>
                {format(new Date(monthRange.from + 'T12:00:00'), 'MMM d')} → {format(new Date(monthRange.until + 'T12:00:00'), 'MMM d, yyyy')}
                {selectedMonths.size > 1 && (
                  <span style={{ color: 'var(--text-muted)', fontWeight: 400, marginLeft: 8 }}>· {selectedMonths.size} months selected</span>
                )}
              </div>
            ) : (
              <div style={{ borderRadius: 10, padding: '10px 14px', fontSize: 13, color: 'var(--text-dim)', border: '1px dashed var(--border-strong)' }}>
                Select one or more months above
              </div>
            )}
          </>
        )}

        {tab === 'custom' && (
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <DayPicker
              className="liftlog-rdp"
              mode="range"
              selected={range}
              onSelect={setRange}
            />
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, marginTop: 24 }}>
          <button
            onClick={onClose}
            style={{ flex: 1, background: 'none', border: '1px solid var(--border-strong)', borderRadius: 10, padding: '12px 0', fontWeight: 700, fontSize: 14, color: 'var(--text-muted)', cursor: 'pointer' }}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!canSave || saving}
            style={{ flex: 2, background: canSave ? TEAL : 'var(--border-strong)', color: canSave ? '#0f1117' : 'var(--text-dim)', border: 'none', borderRadius: 10, padding: '12px 0', fontWeight: 700, fontSize: 14, cursor: canSave && !saving ? 'pointer' : 'not-allowed', opacity: saving ? 0.7 : 1, transition: 'background 0.2s, color 0.2s' }}
          >
            {saving ? 'Saving…' : 'Save Schedule'}
          </button>
        </div>

      </div>
    </div>
  );
}
