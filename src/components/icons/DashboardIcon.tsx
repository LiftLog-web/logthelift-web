export default function DashboardIcon({ size = 56, className = '' }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 56 56" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
      <rect width="56" height="56" rx="14" className="liftlog-icon-pill" />
      {/* 4 stat bars rising left to right */}
      <rect x="11" y="34" width="7" height="10" rx="2" fill="#1EDBA8" opacity="0.5" />
      <rect x="22" y="27" width="7" height="17" rx="2" fill="#1EDBA8" opacity="0.7" />
      <rect x="33" y="21" width="7" height="23" rx="2" fill="#1EDBA8" />
      {/* baseline */}
      <line x1="9" y1="44" x2="47" y2="44" stroke="#1EDBA8" strokeWidth="1.5" strokeLinecap="round" opacity="0.4" />
      {/* small dot above tallest bar */}
      <circle cx="36.5" cy="18" r="2.5" fill="#1EDBA8" />
    </svg>
  );
}
