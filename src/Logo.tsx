/** The linked M represents independent assistants working together. */
export function Logo({ className = '' }: { className?: string }) {
  return (
    <svg className={`mesh-logo ${className}`} viewBox="0 0 40 40" fill="none" aria-hidden="true">
      <path
        d="M8 30V11L20 23L32 11V30"
        stroke="currentColor"
        strokeWidth="2.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="8" cy="10" r="3" fill="currentColor" />
      <circle cx="20" cy="23" r="3" fill="currentColor" />
      <circle cx="32" cy="10" r="3" fill="currentColor" />
    </svg>
  );
}
