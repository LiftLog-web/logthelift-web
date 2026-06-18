export default function ClientsIcon({ size = 56, className = '' }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 56 56" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
      <rect width="56" height="56" rx="14" className="liftlog-icon-pill" />
      {/* Building / office block */}
      <rect x="12" y="18" width="32" height="26" rx="2" stroke="#1EDBA8" strokeWidth="2" />
      {/* Roof ridge */}
      <line x1="12" y1="18" x2="28" y2="10" stroke="#1EDBA8" strokeWidth="2" strokeLinecap="round" />
      <line x1="44" y1="18" x2="28" y2="10" stroke="#1EDBA8" strokeWidth="2" strokeLinecap="round" />
      {/* Windows */}
      <rect x="17" y="24" width="6" height="6" rx="1" fill="#1EDBA8" opacity="0.6" />
      <rect x="27" y="24" width="6" height="6" rx="1" fill="#1EDBA8" opacity="0.6" />
      <rect x="37" y="24" width="0" height="0" />
      {/* Door */}
      <rect x="23" y="34" width="10" height="10" rx="1" stroke="#1EDBA8" strokeWidth="1.5" />
    </svg>
  );
}
