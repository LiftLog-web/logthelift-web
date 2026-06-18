export default function TeamsIcon({ size = 56, className = '' }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 56 56" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
      <rect width="56" height="56" rx="14" className="liftlog-icon-pill" />
      {/* Left person */}
      <circle cx="20" cy="19" r="6" stroke="#1EDBA8" strokeWidth="2" />
      <path d="M8 42c0-7 5-11 12-11" stroke="#1EDBA8" strokeWidth="2" strokeLinecap="round" />
      {/* Right person */}
      <circle cx="36" cy="19" r="6" stroke="#1EDBA8" strokeWidth="2" />
      <path d="M48 42c0-7-5-11-12-11" stroke="#1EDBA8" strokeWidth="2" strokeLinecap="round" />
      {/* Centre connection arc */}
      <path d="M20 31c2-2 4-3 8-3s6 1 8 3" stroke="#1EDBA8" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
