export default function VideoLibraryIcon({ size = 56, className = '' }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 56 56" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
      <rect width="56" height="56" rx="14" fill="#e6faf5" />
      <rect x="7" y="14" width="42" height="30" rx="5" stroke="#1EDBA8" strokeWidth="2" />
      <path d="M22 22 L35 29 L22 36 Z" fill="url(#tealGradVideo)" />
      <rect x="7" y="11" width="6" height="3" rx="1" fill="#1EDBA8" opacity="0.5" />
      <rect x="17" y="11" width="6" height="3" rx="1" fill="#1EDBA8" opacity="0.5" />
      <rect x="27" y="11" width="6" height="3" rx="1" fill="#1EDBA8" opacity="0.5" />
      <rect x="37" y="11" width="6" height="3" rx="1" fill="#1EDBA8" opacity="0.5" />
      <rect x="7" y="44" width="6" height="3" rx="1" fill="#1EDBA8" opacity="0.5" />
      <rect x="17" y="44" width="6" height="3" rx="1" fill="#1EDBA8" opacity="0.5" />
      <rect x="27" y="44" width="6" height="3" rx="1" fill="#1EDBA8" opacity="0.5" />
      <rect x="37" y="44" width="6" height="3" rx="1" fill="#1EDBA8" opacity="0.5" />
      <defs>
        <linearGradient id="tealGradVideo" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#1EDBA8" />
          <stop offset="100%" stopColor="#0da87e" />
        </linearGradient>
      </defs>
    </svg>
  );
}
