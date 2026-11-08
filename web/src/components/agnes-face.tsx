export function AgnesFace({ size = 32, mood = "normal" }: { size?: number; mood?: string }) {
  const mouth =
    mood === "happy" || mood === "excited" || mood === "love" || mood === "playful"
      ? "M11 15c1.4 1.6 4.6 1.6 6 0"
      : mood === "sad" || mood === "concerned"
        ? "M11 17c1.4-1.6 4.6-1.6 6 0"
        : mood === "surprised"
          ? "M14 16.4a1.1 1.1 0 1 0 0 .01"
          : "M11.5 16h5";

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 28 28"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <rect x="1.2" y="1.2" width="25.6" height="25.6" rx="8.5" stroke="rgba(94,234,212,0.55)" strokeWidth="1.2" />
      <rect x="5.4" y="6.6" width="17.2" height="14.8" rx="4.6" fill="#08131f" stroke="rgba(94,234,212,0.28)" />
      <circle cx="10.4" cy="12" r="1.05" fill="#5eead4" />
      <circle cx="17.6" cy="12" r="1.05" fill="#5eead4" />
      <path d={mouth} stroke="#5eead4" strokeWidth="1.1" strokeLinecap="round" />
      <path d="M9 24.5v1.1M19 24.5v1.1" stroke="rgba(167,139,250,0.6)" strokeWidth="1.1" strokeLinecap="round" />
      <path d="M14 1.6v2.2" stroke="rgba(167,139,250,0.6)" strokeWidth="1.1" strokeLinecap="round" />
    </svg>
  );
}
