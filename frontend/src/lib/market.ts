// Float maths for display and input helpers. The contract does the exact work.

const Q96 = 2 ** 96;
const LN_TICK = Math.log(1.0001);

export const price01 = (sqrtPriceX96: bigint) => {
  const s = Number(sqrtPriceX96) / Q96;
  return s * s;
};

export const tickToPrice01 = (tick: number) => Math.pow(1.0001, tick);

/** quote per base, given token1-per-token0 price */
export const quotePerBase = (p01: number, baseIs0: boolean) => (baseIs0 ? p01 : 1 / p01);

export function rangeInQuote(lo: number, hi: number, baseIs0: boolean): [number, number] {
  const a = quotePerBase(tickToPrice01(lo), baseIs0);
  const b = quotePerBase(tickToPrice01(hi), baseIs0);
  return a < b ? [a, b] : [b, a];
}

export function ticksFromPrices(lowQ: number, highQ: number, baseIs0: boolean, spacing: number) {
  const toTick = (q: number) => Math.log(baseIs0 ? q : 1 / q) / LN_TICK;
  const t1 = toTick(lowQ);
  const t2 = toTick(highQ);
  const lo = Math.floor(Math.min(t1, t2) / spacing) * spacing;
  let hi = Math.ceil(Math.max(t1, t2) / spacing) * spacing;
  if (hi <= lo) hi = lo + spacing;
  return { lo, hi };
}

/** token1-denominated value -> quote units */
export const token1ToQuote = (v1: number, p01: number, baseIs0: boolean) => (baseIs0 ? v1 : v1 / p01);

/** token amounts needed per unit liquidity at the current price */
export function unitAmounts(sqrtPriceX96: bigint, lo: number, hi: number) {
  const sp = Number(sqrtPriceX96) / Q96;
  const sa = Math.pow(1.0001, lo / 2);
  const sb = Math.pow(1.0001, hi / 2);
  if (sp <= sa) return { a0: (sb - sa) / (sa * sb), a1: 0 };
  if (sp >= sb) return { a0: 0, a1: sb - sa };
  return { a0: (sb - sp) / (sp * sb), a1: sp - sa };
}

export const wei = (v: bigint) => Number(v) / 1e18;

export function fmt(n: number, max = 2) {
  if (!Number.isFinite(n)) return "–";
  const a = Math.abs(n);
  if (a === 0) return "0";
  // below 1, keep three significant digits so small amounts never read as 0
  if (a < 1) return n.toLocaleString("en-US", { maximumSignificantDigits: 3 });
  return n.toLocaleString("en-US", { maximumFractionDigits: a >= 1000 ? 0 : max });
}

/**
 * Alpha vs the lazy LP in fractional bps, from the 1e18 indices. The contract's alphaBps
 * is a whole number, so a young vault a fraction of a bp ahead would read as 0.
 */
export function alphaOf(s: { strategyIndex: bigint; benchIndex: bigint }) {
  if (s.benchIndex === 0n) return 0;
  return Number(((s.strategyIndex - s.benchIndex) * 10n ** 10n) / s.benchIndex) / 1e6;
}

export const fmtPrice = (n: number) =>
  n.toLocaleString("en-US", { maximumFractionDigits: n >= 100 ? 0 : n >= 1 ? 2 : 6 });

export function fmtBps(bps: bigint | number) {
  const v = Number(bps) / 100;
  const a = Math.abs(v);
  if (a === 0) return "0.00%";
  if (a < 0.0001) return `${v > 0 ? "+" : "-"}<0.0001%`;
  // more decimals as the number shrinks, so early alpha is visible
  const d = a >= 10 ? 1 : a >= 0.1 ? 2 : a >= 0.001 ? 3 : 4;
  return `${v > 0 ? "+" : ""}${v.toFixed(d)}%`;
}

export const shortAddr = (a: string) => `${a.slice(0, 5)}…${a.slice(-4)}`;

function unitFor(totalSeconds: number) {
  if (totalSeconds >= 2 * 86400) return { s: 86400, one: "Day", many: "days" };
  if (totalSeconds >= 2 * 3600) return { s: 3600, one: "Hour", many: "hours" };
  return { s: 60, one: "Minute", many: "minutes" };
}

export function fmtDuration(seconds: number) {
  const u = unitFor(seconds);
  const n = Math.max(1, Math.round(seconds / u.s));
  return `${n} ${n === 1 ? u.many.slice(0, -1) : u.many}`;
}

/** "Day 9 of 14" style progress */
export function trialProgress(createdAt: number, endsAt: number, now: number) {
  const total = endsAt - createdAt;
  const u = unitFor(total);
  const totalUnits = Math.max(1, Math.round(total / u.s));
  const elapsed = Math.min(totalUnits, Math.max(1, Math.ceil((now - createdAt) / u.s)));
  return {
    pct: Math.min(100, Math.max(0, ((now - createdAt) / total) * 100)),
    label: `${u.one} ${elapsed} of ${totalUnits}`,
    done: now >= endsAt,
    remaining: fmtDuration(Math.max(0, endsAt - now)),
  };
}

export function ago(ts: number, now: number) {
  const s = Math.max(0, now - ts);
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} hours ago`;
  return `${Math.round(s / 86400)} days ago`;
}
