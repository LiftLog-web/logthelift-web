import React from 'react';

export const SHIMMER_CSS = `@keyframes shimmer{0%{background-position:-600px 0}100%{background-position:600px 0}}`;

/** A single shimmer block. Uses CSS class sk-block (defined in globals.css) for theme-aware shimmer. */
export function Sk({
  width,
  height,
  radius = 6,
  style,
}: {
  width?: number | string;
  height: number;
  radius?: number;
  style?: React.CSSProperties;
}) {
  return (
    <div
      className="sk-block"
      style={{ width: width ?? '100%', height, borderRadius: radius, flexShrink: 0, ...style }}
    />
  );
}

/** Wraps a full-page skeleton — uses theme CSS variables so it matches current mode. */
export function SkPage({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', color: 'var(--text)', fontFamily: 'sans-serif' }}>
      {children}
    </div>
  );
}

/** Standard top nav skeleton (logo left, 3 button placeholders right). */
export function SkNav() {
  return (
    <nav style={{ borderBottom: '1px solid var(--border)', padding: '16px 32px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ color: '#5fcfbf', fontWeight: 800, fontSize: 20 }}>LiftLog</span>
        <Sk width={120} height={14} radius={4} />
      </div>
      <div style={{ display: 'flex', gap: 10 }}>
        <Sk width={72} height={30} radius={8} />
        <Sk width={84} height={30} radius={8} />
        <Sk width={76} height={30} radius={8} />
      </div>
    </nav>
  );
}

/** Sub-header skeleton (back arrow + title, used in editor pages). */
export function SkSubHeader() {
  return (
    <div style={{ borderBottom: '1px solid var(--border)', padding: '14px 32px', display: 'flex', alignItems: 'center', gap: 16 }}>
      <Sk width={28} height={28} radius={8} />
      <Sk width={180} height={18} radius={5} />
      <div style={{ marginLeft: 'auto', display: 'flex', gap: 10 }}>
        <Sk width={80} height={32} radius={8} />
        <Sk width={80} height={32} radius={8} />
      </div>
    </div>
  );
}

/** A generic card shell. */
export function SkCard({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 20, overflow: 'hidden', ...style }}>
      {children}
    </div>
  );
}
