export default function LogWorkoutIcon({ size = 56, className = '' }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 56 56" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
      <rect width="56" height="56" rx="14" className="liftlog-icon-pill" />
      {/* Bar */}
      <rect x="16" y="26" width="24" height="4" rx="2" fill="#1EDBA8" />
      {/* Left weight plate */}
      <rect x="7" y="20" width="10" height="16" rx="3" stroke="#1EDBA8" strokeWidth="2" />
      {/* Right weight plate */}
      <rect x="39" y="20" width="10" height="16" rx="3" stroke="#1EDBA8" strokeWidth="2" />
      {/* Left collar */}
      <rect x="15" y="23" width="3" height="10" rx="1" fill="#1EDBA8" opacity="0.6" />
      {/* Right collar */}
      <rect x="38" y="23" width="3" height="10" rx="1" fill="#1EDBA8" opacity="0.6" />
    </svg>
  );
}
