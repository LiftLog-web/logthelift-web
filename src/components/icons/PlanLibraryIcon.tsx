export default function PlanLibraryIcon({ size = 56, className = '' }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 56 56" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
      <rect width="56" height="56" rx="14" className="liftlog-icon-pill" />
      <rect x="5" y="44" width="46" height="4" rx="1.5" fill="#1EDBA8" opacity="0.5" />
      <rect x="8" y="18" width="9" height="26" rx="2" stroke="#1EDBA8" strokeWidth="2" />
      <line x1="12" y1="18" x2="12" y2="44" stroke="#1EDBA8" strokeWidth="1.2" opacity="0.4" />
      <rect x="19" y="24" width="7" height="20" rx="2" stroke="#1EDBA8" strokeWidth="2" opacity="0.75" />
      <rect x="28" y="15" width="6" height="29" rx="2" stroke="#1EDBA8" strokeWidth="2" />
      <line x1="30" y1="15" x2="30" y2="44" stroke="#1EDBA8" strokeWidth="1" opacity="0.35" />
      <rect x="36" y="21" width="8" height="23" rx="2" stroke="#1EDBA8" strokeWidth="2" opacity="0.65" />
      <rect x="9" y="38" width="5" height="2" rx="1" fill="#1EDBA8" opacity="0.5" />
      <rect x="29" y="36" width="2" height="2" rx="1" fill="#1EDBA8" opacity="0.5" />
    </svg>
  );
}
