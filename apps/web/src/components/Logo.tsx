/** The Qrono mark (the "Night glow" app icon) with an optional wordmark. */
export function Logo({ size = 28, wordmark = true }: { size?: number; wordmark?: boolean }) {
  return (
    <span className="logo">
      <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
        <defs>
          <linearGradient id="qrono-logo-bg" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#17112B" />
            <stop offset="1" stopColor="#050409" />
          </linearGradient>
        </defs>
        <rect width="100" height="100" rx="23" fill="url(#qrono-logo-bg)" />
        <g transform="translate(50 50) scale(1.08) translate(-51 -49)">
          <circle cx="49" cy="47" r="27" fill="none" stroke="#A97BFF" strokeWidth="10" />
          <ellipse cx="41" cy="45" rx="5.5" ry="7.5" fill="#FFFFFF" />
          <ellipse cx="57" cy="45" rx="5.5" ry="7.5" fill="#FFFFFF" />
          <line x1="68" y1="66" x2="80" y2="78" stroke="#A97BFF" strokeWidth="11" strokeLinecap="round" />
        </g>
      </svg>
      {wordmark ? <span className="logo-word">Qrono</span> : <span className="visually-hidden">Qrono</span>}
    </span>
  );
}
