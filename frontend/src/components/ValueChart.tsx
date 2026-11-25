import type { Snapshot } from "@/lib/contracts";

const W = 640;
const H = 220;
const PAD = 14;

/** Strategy vs lazy LP, both rebased to 1 at the first point. */
export function ValueChart({ history, label }: { history: Snapshot[]; label: string }) {
  if (history.length < 2) {
    return (
      <div className="faint" style={{ height: 220, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14 }}>
        The chart fills in as swaps hit the pool.
      </div>
    );
  }

  const s0 = Number(history[0].strategyIndex);
  const b0 = Number(history[0].benchIndex);
  const strat = history.map((h) => Number(h.strategyIndex) / s0);
  const bench = history.map((h) => Number(h.benchIndex) / b0);
  const t0 = history[0].time;
  const t1 = history[history.length - 1].time;
  const lo = Math.min(...strat, ...bench);
  const hi = Math.max(...strat, ...bench);
  const span = hi - lo || 1e-9;

  const x = (t: number) => (t1 === t0 ? 0 : ((t - t0) / (t1 - t0)) * W);
  const y = (v: number) => PAD + (1 - (v - lo) / span) * (H - PAD * 2);
  const line = (vals: number[]) => vals.map((v, i) => `${i ? "L" : "M"}${x(history[i].time).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");

  const end = (strat[strat.length - 1] / bench[bench.length - 1] - 1) * 100;
  const fmtT = (t: number) => new Date(t * 1000).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

  return (
    <>
      <svg role="img" aria-label={`Line chart: ${label} versus the lazy LP, ending ${end.toFixed(2)} percent ${end >= 0 ? "higher" : "lower"}`} viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", overflow: "visible" }}>
        <path d={`M0 ${H / 4}H${W}M0 ${H / 2}H${W}M0 ${(H * 3) / 4}H${W}`} stroke="#2E2317" strokeWidth="1" />
        <path d={line(bench)} fill="none" stroke="#A89880" strokeWidth="2" strokeDasharray="6 6" />
        <path d={line(strat)} fill="none" stroke="#D9A441" strokeWidth="3" style={{ strokeDasharray: 2000, strokeDashoffset: 2000, animation: "drawline 1.4s ease forwards" }} />
        {history.map((h, i) =>
          h.rebalanced ? <circle key={i} cx={x(h.time)} cy={y(strat[i])} r="5" fill="#0E0B08" stroke="#D9A441" strokeWidth="2" /> : null,
        )}
        <style>{`@keyframes drawline{to{stroke-dashoffset:0}}`}</style>
      </svg>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--faint)" }}>
        <span>{fmtT(t0)}</span>
        <span>{fmtT(t1)}</span>
      </div>
    </>
  );
}
