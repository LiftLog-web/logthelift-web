export default function TeamMembersIcon({ size = 56, className = '' }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 56 56" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
      <rect width="56" height="56" rx="14" className="liftlog-icon-pill" />
      {/* Left person (foreground) */}
      <circle cx="19" cy="19" r="6" stroke="#1EDBA8" strokeWidth="2" />
      <path d="M9 44a10 10 0 0 1 20 0" stroke="#1EDBA8" strokeWidth="2" strokeLinecap="round" />
      {/* Right person (slightly behind) */}
      <circle cx="37" cy="19" r="6" stroke="#1EDBA8" strokeWidth="2" opacity="0.55" />
      <path d="M27 44a10 10 0 0 1 20 0" stroke="#1EDBA8" strokeWidth="2" strokeLinecap="round" opacity="0.55" />
    </svg>
  );
}
