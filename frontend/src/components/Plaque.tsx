"use client";

import { useRef, useState, type PointerEvent } from "react";

type Variant = "wax" | "bronze";

/** Relief plaque with mouse-follow tilt. Bronze gets a moving sheen, wax slowly drips. */
export function Plaque({
  variant,
  width,
  height,
  float = false,
  tilt = true,
}: {
  variant: Variant;
  width: number;
  height: number;
  float?: boolean;
  tilt?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [rot, setRot] = useState<{ x: number; y: number } | null>(null);

  const onMove = (e: PointerEvent) => {
    if (!tilt || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width - 0.5;
    const py = (e.clientY - r.top) / r.height - 0.5;
    setRot({ x: -py * 18, y: px * 22 });
  };

  const style = rot
    ? { width, height, transform: `rotateX(${rot.x}deg) rotateY(${rot.y}deg) scale(1.03)` }
    : { width, height };

  const glare = rot
    ? { background: `radial-gradient(circle at ${50 + rot.y * 2}% ${50 - rot.x * 2}%, rgba(255,240,210,0.22), transparent 55%)` }
    : undefined;

  const relief = Math.round(Math.min(width, height * 0.75) * 0.8);

  return (
    <div className="plaque-scene" onPointerMove={onMove} onPointerLeave={() => setRot(null)}>
      <div ref={ref} className={`plaque ${variant}${float && !rot ? " float" : ""}`} style={style}>
        <div className="plaque-face">
          {variant === "bronze" && <div className="sheen" />}
        </div>
        <div className="plaque-face plaque-relief">
          <Relief variant={variant} size={relief} />
        </div>
        <div className="plaque-glare" style={glare} />
        {variant === "wax" && (
          <>
            <span className="drip" style={{ left: "22%", animationDelay: "0.4s" }} />
            <span className="drip" style={{ left: "64%", animationDelay: "2.1s" }} />
          </>
        )}
      </div>
    </div>
  );
}

function Relief({ variant, size }: { variant: Variant; size: number }) {
  const stroke = variant === "bronze" ? "#2A1A0C" : "#6B5B3E";
  return (
    <svg aria-hidden="true" viewBox="0 0 120 150" width={size} height={size * 1.25} fill="none" stroke={stroke} strokeOpacity={variant === "bronze" ? 0.72 : 1} strokeWidth={variant === "bronze" ? 2 : 1.6}>
      <rect x="6" y="6" width="108" height="138" rx="3" />
      <path d="M60 22 100 75 60 128 20 75z" />
      <circle cx="60" cy="75" r="24" />
      <circle cx="60" cy="75" r="11" />
      <circle cx="18" cy="18" r="4" />
      <circle cx="102" cy="18" r="4" />
      <circle cx="18" cy="132" r="4" />
      <circle cx="102" cy="132" r="4" />
    </svg>
  );
}

export function Medallion() {
  return (
    <div style={{ perspective: 1000 }}>
      <div className="medallion">
        <div className="sheen" />
        <svg aria-hidden="true" viewBox="0 0 120 120" width="170" height="170" fill="none" stroke="#2A1A0C" strokeOpacity="0.7" strokeWidth="2">
          <circle cx="60" cy="60" r="52" />
          <circle cx="60" cy="60" r="38" />
          <path d="M60 22 98 60 60 98 22 60z" />
          <circle cx="60" cy="60" r="12" />
        </svg>
      </div>
    </div>
  );
}

/** Molten beads running from wax to bronze */
export function PourArrow() {
  return (
    <svg className="pour" aria-hidden="true" width="56" height="24" viewBox="0 0 56 24" fill="none" stroke="#D9A441" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path className="flow" d="M2 12h50" />
      <path d="M42 3l10 9-10 9" />
      <circle cx="4" cy="12" r="2.5" fill="#F0C469" stroke="none" />
      <circle cx="4" cy="12" r="2" fill="#F0C469" stroke="none" style={{ animationDelay: "1.2s" }} />
    </svg>
  );
}
