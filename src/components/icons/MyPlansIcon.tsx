export default function MyPlansIcon({ size = 56, className = '' }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 56 56" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
      <rect width="56" height="56" rx="14" className="liftlog-icon-pill" />
      {/* Document body */}
      <rect x="12" y="10" width="32" height="36" rx="3" stroke="#1EDBA8" strokeWidth="2" />
      {/* List lines */}
      <line x1="19" y1="21" x2="37" y2="21" stroke="#1EDBA8" strokeWidth="2" strokeLinecap="round" />
      <line x1="19" y1="28" x2="33" y2="28" stroke="#1EDBA8" strokeWidth="2" strokeLinecap="round" />
      <line x1="19" y1="35" x2="35" y2="35" stroke="#1EDBA8" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
