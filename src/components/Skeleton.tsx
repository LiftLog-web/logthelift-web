import React from 'react';

export const SHIMMER_CSS = `@keyframes shimmer{0%{background-position:-600px 0}100%{background-position:600px 0}}`;

const BASE: React.CSSProperties = {
  background: 'rgba(255,255,255,0.07)',
  backgroundImage: 'linear-gradient(90deg,rgba(255,255,255,0) 0%,rgba(255,255,255,0.08) 50%,rgba(255,255,255,0) 100%)',
  backgroundSize: '600px 100%',
  animation: 'shimmer 1.4s ease-in-out infinite',
  flexShrink: 0,
};

/** A single shimmer block. width defaults to 100%, height is required. */
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
  return <div style={{ ...BASE, width: width ?? '100%', height, borderRadius: radius, ...style }} />;
}

/** Wraps a full-page skeleton — injects the shimmer keyframe once. */
export function SkPage({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: '100vh', background: '#0f1117', color: '#fff', fontFamily: 'sans-serif' }}>
      <style>{SHIMMER_CSS}</style>
      {children}
    </div>
  );
}

/** Standard top nav skeleton (logo left, 3 button placeholders right). */
export function SkNav() {
  return (
    <nav style={{ borderBottom: '1px solid rgba(255,255,255,0.1)', padding: '16px 32px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
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
    <div style={{ borderBottom: '1px solid rgba(255,255,255,0.1)', padding: '14px 32px', display: 'flex', alignItems: 'center', gap: 16 }}>
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
    <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 20, overflow: 'hidden', ...style }}>
      {children}
    </div>
  );
}
