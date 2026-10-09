/** The linked M represents independent assistants working together. */
export function Logo({ className = '' }: { className?: string }) {
  return (
    <svg className={`mesh-logo ${className}`} viewBox="0 0 40 40" fill="none" aria-hidden="true">
      <path
        d="M8 30V10L20 22L32 10V30"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <rect x="4" y="6" width="8" height="8" rx="2.5" fill="currentColor" />
      <rect x="16" y="18" width="8" height="8" rx="2.5" fill="currentColor" />
      <rect x="28" y="6" width="8" height="8" rx="2.5" fill="currentColor" />
    </svg>
  );
}
