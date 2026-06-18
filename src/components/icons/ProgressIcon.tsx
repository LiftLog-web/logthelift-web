export default function ProgressIcon({ size = 56, className = '' }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 56 56" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
      <rect width="56" height="56" rx="14" className="liftlog-icon-pill" />
      {/* Axes */}
      <line x1="12" y1="44" x2="12" y2="13" stroke="#1EDBA8" strokeWidth="1.5" strokeLinecap="round" opacity="0.45" />
      <line x1="12" y1="44" x2="44" y2="44" stroke="#1EDBA8" strokeWidth="1.5" strokeLinecap="round" opacity="0.45" />
      {/* Upward trend line */}
      <polyline points="14,40 21,34 28,37 35,25 42,17" stroke="#1EDBA8" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      {/* Endpoint dot */}
      <circle cx="42" cy="17" r="3" fill="#1EDBA8" />
    </svg>
  );
}
