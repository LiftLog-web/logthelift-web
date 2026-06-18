export default function ProgramsIcon({ size = 56, className = '' }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 56 56" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
      <rect width="56" height="56" rx="14" className="liftlog-icon-pill" />
      {/* 2×2 grid of squares */}
      <rect x="10" y="10" width="15" height="15" rx="3" stroke="#1EDBA8" strokeWidth="2" />
      <rect x="31" y="10" width="15" height="15" rx="3" stroke="#1EDBA8" strokeWidth="2" />
      <rect x="10" y="31" width="15" height="15" rx="3" stroke="#1EDBA8" strokeWidth="2" />
      <rect x="31" y="31" width="15" height="15" rx="3" stroke="#1EDBA8" strokeWidth="2" />
    </svg>
  );
}
