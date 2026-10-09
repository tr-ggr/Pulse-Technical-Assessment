import type { CSSProperties } from "react";
import type { Stranger } from "@/lib/identity";

// A stranger's colour as a small glowing planet: the same hue as their dot,
// so the card you're looking at and the dot on the globe read as one person.
// With `countdownMs`, a ring drains around it over that time.
export default function StrangerOrb({
  stranger,
  size = 40,
  countdownMs,
}: {
  stranger: Pick<Stranger, "color" | "glow">;
  size?: number;
  countdownMs?: number;
}) {
  const ring = countdownMs !== undefined;
  const style = {
    width: size,
    height: size,
    "--dot": stranger.color,
    "--dot-glow": stranger.glow,
  } as CSSProperties;

  return (
    <span
      aria-hidden
      className="relative inline-grid shrink-0 place-items-center"
      style={style}
    >
      {ring && (
        <svg viewBox="0 0 40 40" className="absolute inset-0 -rotate-90">
          <circle
            cx="20"
            cy="20"
            r="18.5"
            fill="none"
            stroke="rgb(255 255 255 / 0.1)"
            strokeWidth="1.5"
          />
          <circle
            cx="20"
            cy="20"
            r="18.5"
            fill="none"
            stroke="var(--dot)"
            strokeWidth="1.5"
            strokeLinecap="round"
            pathLength={100}
            strokeDasharray="100"
            className="countdown-ring"
            style={{ animationDuration: `${countdownMs}ms` }}
          />
        </svg>
      )}
      <span
        className={`orb absolute rounded-full ${ring ? "inset-[18%]" : "inset-0"}`}
      />
    </span>
  );
}
