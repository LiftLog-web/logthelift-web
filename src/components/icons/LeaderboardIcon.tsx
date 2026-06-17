export default function LeaderboardIcon({ size = 56, className = '' }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 56 56" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
      <rect width="56" height="56" rx="14" className="liftlog-icon-pill" />
      {/* Podium bars: 2nd (left), 1st (centre, tallest), 3rd (right) */}
      <rect x="8"  y="25" width="13" height="15" rx="2" stroke="#1EDBA8" strokeWidth="2" />
      <rect x="22" y="14" width="13" height="26" rx="2" stroke="#1EDBA8" strokeWidth="2" />
      <rect x="36" y="31" width="13" height="9"  rx="2" stroke="#1EDBA8" strokeWidth="2" />
      {/* Star above 1st-place bar */}
      <path d="M28.5 7l1.1 3.3h3.5l-2.8 2 1.1 3.3-2.9-2.1-2.9 2.1 1.1-3.3-2.8-2h3.5z" fill="#1EDBA8" />
    </svg>
  );
}
