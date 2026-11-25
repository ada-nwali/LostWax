"use client";

import { useEffect } from "react";

/** Full-screen pour played after a successful cast. */
export function CastCeremony({ name, onDone }: { name: string; onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 3200);
    return () => clearTimeout(t);
  }, [onDone]);

  return (
    <div className="ceremony" role="dialog" aria-label={`${name} cast in bronze`} onClick={onDone}>
      <div className="stream" />
      <div className="mould">
        <div className="metal" />
      </div>
      <div className="stack" style={{ alignItems: "center", gap: 8 }}>
        <div className="label" style={{ color: "var(--gold)" }}>Cast in bronze</div>
        <div className="serif" style={{ fontSize: 40 }}>{name}</div>
        <div className="muted" style={{ fontSize: 15 }}>Live vault. Deposits are open.</div>
      </div>
    </div>
  );
}
