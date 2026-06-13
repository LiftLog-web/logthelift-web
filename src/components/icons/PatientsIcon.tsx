export default function PatientsIcon({ size = 56, className = '' }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 56 56" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
      <rect width="56" height="56" rx="14" fill="#e6faf5" />
      <rect x="11" y="13" width="34" height="34" rx="3" stroke="#1EDBA8" strokeWidth="2" />
      <rect x="20" y="9" width="16" height="7" rx="3" stroke="#1EDBA8" strokeWidth="2" />
      <line x1="17" y1="39" x2="17" y2="22" stroke="#1EDBA8" strokeWidth="1.5" strokeLinecap="round" opacity="0.5" />
      <line x1="17" y1="39" x2="39" y2="39" stroke="#1EDBA8" strokeWidth="1.5" strokeLinecap="round" opacity="0.5" />
      <polyline points="17,36 22,32 27,34 32,27 37,23" stroke="#1EDBA8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="37" cy="23" r="2" fill="#1EDBA8" />
    </svg>
  );
}
