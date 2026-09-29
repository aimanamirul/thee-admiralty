/** Lightweight CSS-only CRT treatment: scanlines, drifting phosphor band, vignette and bloom. */
export default function CRTOverlay() {
  return (
    <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden animate-flicker" aria-hidden>
      <div className="absolute inset-0 crt-scanlines" />
      <div className="absolute inset-x-0 top-0 crt-band animate-scan" />
      <div className="absolute inset-0 crt-vignette" />
      <div className="absolute inset-0 crt-bloom" />
    </div>
  );
}
