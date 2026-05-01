export function LanyardLogo({ size = 36 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 44" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="lg" x1="0" y1="0" x2="40" y2="44" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#A855F7" />
          <stop offset="50%" stopColor="#EC4899" />
          <stop offset="100%" stopColor="#F97316" />
        </linearGradient>
        <linearGradient id="cord" x1="0" y1="0" x2="40" y2="20" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#A855F7" />
          <stop offset="100%" stopColor="#EC4899" />
        </linearGradient>
      </defs>

      {/* Lanyard cord — loop from left shoulder, over top, down right */}
      <path
        d="M 9 16 L 9 9 Q 9 3 20 3 Q 31 3 31 9 L 31 16"
        stroke="url(#cord)"
        strokeWidth="3.5"
        strokeLinecap="round"
        fill="none"
      />

      {/* Badge body */}
      <rect x="3" y="16" width="34" height="26" rx="5" fill="url(#lg)" />

      {/* Clip/attachment notch at top */}
      <rect x="15" y="13" width="10" height="6" rx="2" fill="url(#lg)" />

      {/* Avatar circle on badge */}
      <circle cx="20" cy="25" r="5" fill="white" fillOpacity="0.95" />

      {/* Name line */}
      <rect x="10" y="33" width="20" height="2.5" rx="1.25" fill="white" fillOpacity="0.75" />

      {/* Sub-line */}
      <rect x="13" y="37" width="14" height="2" rx="1" fill="white" fillOpacity="0.45" />
    </svg>
  )
}

export function LanyardWordmark({ className = '' }: { className?: string }) {
  return (
    <span className={`font-black tracking-tight bg-gradient-to-r from-violet-600 via-fuchsia-500 to-orange-500 bg-clip-text text-transparent ${className}`}>
      Lanyard
    </span>
  )
}
