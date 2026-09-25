import { clsx } from "clsx";

/**
 * A clock face with its good window lit, the hand just past twelve: now-ish.
 * Keep in sync with `src/app/icon.svg`.
 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg className={clsx("mark", className)} viewBox="0 0 40 40" aria-hidden="true">
      <rect width="40" height="40" rx="11" fill="#14201e" />
      <circle cx="20" cy="20" r="13" fill="#f9fbfa" />
      <path d="M20 20L11.3 10.34A13 13 0 0 1 28.7 10.34Z" fill="#2a78d6" />
      <path d="M20 20L22.42 10.3" stroke="#14201e" strokeWidth="3" strokeLinecap="round" />
      <circle cx="20" cy="20" r="2.6" fill="#14201e" />
    </svg>
  );
}
