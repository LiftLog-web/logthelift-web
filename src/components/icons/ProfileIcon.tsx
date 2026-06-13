export default function ProfileIcon({ size = 56, className = '' }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 56 56" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
      <rect width="56" height="56" rx="14" className="liftlog-icon-pill" />
      <circle cx="28" cy="20" r="9" stroke="#1EDBA8" strokeWidth="2.2" />
      <path d="M10 50 C10 39 46 39 46 50" stroke="#1EDBA8" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}
