"use client";

import Link from "next/link";
import { useState } from "react";
import { Plaque } from "@/components/Plaque";
import { Stage, type StrategyView } from "@/lib/contracts";
import { useMarket, useNow, useStrategies } from "@/lib/hooks";
import { fmt, fmtBps, shortAddr, trialProgress } from "@/lib/market";
import { IS_DEPLOYED } from "@/config/pools";

type Filter = "all" | "bronze" | "wax";

export default function Foundry() {
  const { strategies, isLoading } = useStrategies();
  const [filter, setFilter] = useState<Filter>("all");

  const live = strategies.filter((s) => s.stage === Stage.Wax || s.stage === Stage.Bronze);
  const shown = live
    .filter((s) => filter === "all" || (filter === "bronze" ? s.stage === Stage.Bronze : s.stage === Stage.Wax))
    .sort((a, b) => b.stage - a.stage || Number(b.alphaBps - a.alphaBps));

  return (
    <div className="container stack" style={{ padding: "64px 32px 96px", gap: 36 }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", justifyContent: "space-between", gap: 24 }}>
        <div className="stack" style={{ gap: 12, maxWidth: 620 }}>
          <h1 className="h1">The Foundry</h1>
          <p className="lede">Bronze strategies are live and open for deposits. Wax strategies are still in trial and hold no funds.</p>
        </div>
        <span className="note">Live on Unichain Sepolia · test tokens</span>
      </div>

      <div className="row" style={{ gap: 10 }} role="group" aria-label="Filter strategies">
        {(["all", "bronze", "wax"] as const).map((f) => (
          <button key={f} className={`chip${filter === f ? " on" : ""}`} onClick={() => setFilter(f)} aria-pressed={filter === f}>
            {f === "all" ? "All strategies" : f === "bronze" ? "Bronze · live" : "Wax · in trial"}
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <div className="card card-pad muted" style={{ fontSize: 16 }}>
          {!IS_DEPLOYED ? "Deploy the contracts to see strategies here." : isLoading ? "Reading the Foundry…" : (
            <>Nothing here yet. <Link href="/studio">Sculpt the first strategy in the Studio →</Link></>
          )}
        </div>
      ) : (
        <div className="row">
          {shown.map((s) => (
            <StrategyCard key={s.id.toString()} s={s} />
          ))}
        </div>
      )}
    </div>
  );
}

function StrategyCard({ s }: { s: StrategyView }) {
  const m = useMarket(s);
  const now = useNow();
  const bronze = s.stage === Stage.Bronze;
  const trial = trialProgress(Number(s.createdAt), Number(s.trialEndsAt), now);
  const alpha = Number(s.alphaBps);

  return (
    <div className="card reveal" style={{ flex: "1 1 340px", maxWidth: 420, minWidth: 0, padding: 24, display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "flex", gap: 18, alignItems: "center" }}>
        <Plaque variant={bronze ? "bronze" : "wax"} width={76} height={96} />
        <div className="stack" style={{ gap: 6, minWidth: 0 }}>
          <div className="label" style={{ color: bronze ? "var(--gold)" : "var(--wax)" }}>{bronze ? "Bronze · live" : "Wax · in trial"}</div>
          <div className="serif" style={{ fontSize: 30, lineHeight: 1.1 }}>{s.name}</div>
          <div className="faint" style={{ fontSize: 14 }}>
            {m?.pool.label ?? "Pool"} · by {shortAddr(s.curator)}
          </div>
        </div>
      </div>
      <div style={{ display: "flex", gap: 16, borderTop: "1px solid var(--line)", paddingTop: 18 }}>
        <div className="stack" style={{ flex: "1 1 0", gap: 4 }}>
          <div className="faint" style={{ fontSize: 12 }}>vs lazy LP</div>
          <div className={`num ${alpha >= 0 ? "up" : "down"}`} style={{ fontSize: 22, fontWeight: 600 }}>{s.benchIndex > 0n ? fmtBps(alpha) : "–"}</div>
        </div>
        <div className="stack" style={{ flex: "1 1 0", gap: 4 }}>
          <div className="faint" style={{ fontSize: 12 }}>{bronze ? "Deposits" : "Trial"}</div>
          <div className="num" style={{ fontSize: 22, fontWeight: 600 }}>
            {bronze ? `${fmt(m ? m.toQuote(s.tvl) : 0)} ${m?.pool.quoteLabel ?? ""}` : trial.done ? (s.qualified ? "Qualified" : "Ended") : trial.label}
          </div>
        </div>
      </div>
      <Link href={`/strategy/${s.id}`} className="btn btn-outline">{bronze ? "View and deposit" : "View trial"}</Link>
    </div>
  );
}
