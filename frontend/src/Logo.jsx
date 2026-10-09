// Fit & Aktiv logo: a gold mark with an italic "F" and a motion dash, plus the wordmark.
export function LogoMark({ size = 40 }) {
  return (
    <svg
      className="logo-mark"
      width={size}
      height={size}
      viewBox="0 0 40 40"
      aria-hidden="true"
    >
      <rect width="40" height="40" rx="9" fill="#C8A96A" />
      <path
        d="M10 31H15L17.2 22.5H25L26.1 18.5H18.3L19.6 13.5H29L30.2 9H16Z"
        fill="#0E0E0E"
      />
      <path d="M23.5 31H32L33.1 27H24.6Z" fill="#0E0E0E" opacity="0.55" />
    </svg>
  );
}

export default function Logo({ tone = "dark", size = 40 }) {
  return (
    <span className={`logo logo-${tone}`}>
      <LogoMark size={size} />
      <span className="logo-word">
        Fit <span className="logo-amp">&amp;</span> Aktiv
      </span>
    </span>
  );
}
