// Icons shared by the safety UI (call stage, chat, request card).

// A closed eye: the veil over both cameras.
export function VeilIcon({ className = "size-5" }: { className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 9.5c2.4 3 5.5 4.5 9 4.5s6.6-1.5 9-4.5M12 14v3M7.2 13l-1.4 2.5M16.8 13l1.4 2.5M3.9 11.1 2.2 13M20.1 11.1l1.7 1.9" />
    </svg>
  );
}

// Guardian, and the safety menu.
export function ShieldIcon({ className = "size-3.5" }: { className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 16 16"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
    >
      <path d="M8 1.75 2.75 3.6v4.1c0 3.2 2.2 5.6 5.25 6.55 3.05-.95 5.25-3.35 5.25-6.55V3.6L8 1.75Z" />
    </svg>
  );
}
