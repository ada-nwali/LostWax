"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useAccount, useReadContract } from "wagmi";
import { Plaque } from "@/components/Plaque";
import { CastCeremony } from "@/components/CastCeremony";
import { ConnectButton } from "@/components/Header";
import { hookAbi, RULE_LABEL, Rule, Stage, type StrategyView } from "@/lib/contracts";
import { useNow, useStrategies, useTx } from "@/lib/hooks";
import { alphaOf, fmtBps, fmtDuration, fmtPrice, price01, quotePerBase, ticksFromPrices, trialProgress } from "@/lib/market";
import { chain } from "@/lib/wagmi";
import { baseIsToken0, HOOK, IS_DEPLOYED, POOLS, poolForKey, poolId, poolKey, TRIAL_DURATION } from "@/config/pools";

const ALPHA_FEE_BPS = 2000;

export default function Studio() {
  const { address, isConnected, chainId } = useAccount();
  const { strategies } = useStrategies();
  const { send, pending } = useTx();

  const [name, setName] = useState("");
  const [poolId, setPoolId] = useState(POOLS[0].id);
  const [low, setLow] = useState("");
  const [high, setHigh] = useState("");
  const [rule, setRule] = useState<Rule>(Rule.OutOfRange);
  const [cooldown, setCooldown] = useState("10"); // minutes, like the seeded demo trials

  const pool = POOLS.find((p) => p.id === poolId)!;
  const b0 = baseIsToken0(pool);
  const key = poolKey(pool);

  const slot = useReadContract({
    address: HOOK,
    abi: hookAbi,
    functionName: "trackedIds",
    args: [key],
    query: { enabled: IS_DEPLOYED },
  });
  // price comes from any strategy on the pool, else from a fresh read below
  const spot = useSpot(strategies, poolId);

  // seed a ±5% range once per pool, never over what the user typed
  const [seeded, setSeeded] = useState<string | null>(null);
  useEffect(() => {
    if (spot && seeded !== poolId) {
      setLow(fmtPrice(spot * 0.95).replace(/,/g, ""));
      setHigh(fmtPrice(spot * 1.05).replace(/,/g, ""));
      setSeeded(poolId);
    }
  }, [poolId, spot, seeded]);

  const lo = Number(low);
  const hi = Number(high);
  const bar = useMemo(() => {
    if (!spot || !lo || !hi || hi <= lo) return null;
    const min = Math.min(lo, spot) * 0.8;
    const max = Math.max(hi, spot) * 1.2;
    const at = (v: number) => ((v - min) / (max - min)) * 100;
    return { left: at(lo), width: at(hi) - at(lo), now: at(spot) };
  }, [spot, lo, hi]);

  const full = ((slot.data as bigint[] | undefined)?.length ?? 0) >= 16;
  const ready = isConnected && chainId === chain.id;
  const valid = name.trim().length > 0 && name.length <= 32 && lo > 0 && hi > lo && Number(cooldown) >= 0;

  const sculpt = async () => {
    const t = ticksFromPrices(lo, hi, b0, pool.spacing);
    await send("Start wax trial", {
      address: HOOK,
      abi: hookAbi,
      functionName: "sculpt",
      args: [key, name.trim(), t.lo, t.hi, { rule, cooldown: Math.round(Number(cooldown) * 60), maxTickMove: pool.maxTickMove, alphaFeeBps: ALPHA_FEE_BPS }],
    });
    setName("");
  };

  const mine = strategies.filter((s) => address && s.curator.toLowerCase() === address.toLowerCase() && s.stage === Stage.Wax);

  return (
    <div className="container stack" style={{ padding: "64px 32px 96px", gap: 40 }}>
      <div className="stack" style={{ gap: 12, maxWidth: 660 }}>
        <h1 className="h1">The Studio</h1>
        <p className="lede">
          Sculpt a strategy in wax. It runs against real swaps with no funds at risk. When it beats the lazy LP for the full trial, you can cast it.
        </p>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 28, alignItems: "flex-start" }}>
        <div className="card stack" style={{ flex: "999 1 520px", minWidth: 0, padding: 32, gap: 28 }}>
          <h2 className="serif" style={{ margin: 0, fontSize: 34 }}>New wax model</h2>

          <div className="field">
            <label htmlFor="s-name">Strategy name</label>
            <input id="s-name" className="input" maxLength={32} placeholder="For example: Ember Narrow" value={name} onChange={(e) => setName(e.target.value)} />
          </div>

          <div className="field">
            <label htmlFor="s-pool">Pool</label>
            <select id="s-pool" className="select" value={poolId} onChange={(e) => setPoolId(e.target.value)}>
              {POOLS.map((p) => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
            </select>
          </div>

          <div className="stack" style={{ gap: 12 }}>
            <div style={{ fontSize: 13, color: "var(--muted)" }}>Price range</div>
            <div className="row" style={{ gap: 16 }}>
              <div className="field" style={{ flex: "1 1 180px" }}>
                <label htmlFor="s-low" className="faint" style={{ fontSize: 12 }}>Lower price ({pool.quoteLabel} per {pool.baseLabel})</label>
                <input id="s-low" className="input" inputMode="decimal" value={low} onChange={(e) => setLow(e.target.value)} />
              </div>
              <div className="field" style={{ flex: "1 1 180px" }}>
                <label htmlFor="s-high" className="faint" style={{ fontSize: 12 }}>Upper price ({pool.quoteLabel} per {pool.baseLabel})</label>
                <input id="s-high" className="input" inputMode="decimal" value={high} onChange={(e) => setHigh(e.target.value)} />
              </div>
            </div>
            <div className="stack" style={{ gap: 8 }}>
              <div className="rangebar">
                {bar && <div className="fill" style={{ left: `${bar.left}%`, width: `${bar.width}%` }} />}
                {bar && <div className="now" style={{ left: `${bar.now}%` }} />}
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--faint)" }}>
                <span>Your range in wax</span>
                <span>Gold line: current price {spot ? fmtPrice(spot) : "–"}</span>
              </div>
            </div>
          </div>

          <div className="row" style={{ gap: 16 }}>
            <div className="field" style={{ flex: "1 1 240px" }}>
              <label htmlFor="s-rule">Rebalance rule</label>
              <select id="s-rule" className="select" value={rule} onChange={(e) => setRule(Number(e.target.value) as Rule)}>
                {[Rule.OutOfRange, Rule.Edge80, Rule.Manual].map((r) => (
                  <option key={r} value={r}>{RULE_LABEL[r]}</option>
                ))}
              </select>
            </div>
            <div className="field" style={{ flex: "1 1 160px" }}>
              <label htmlFor="s-cool">Cooldown (minutes)</label>
              <input id="s-cool" className="input" inputMode="decimal" value={cooldown} onChange={(e) => setCooldown(e.target.value)} />
            </div>
          </div>

          <div className="faint" style={{ fontSize: 13, lineHeight: 1.6 }}>
            Mandate: moves of up to {pool.maxTickMove} ticks per rebalance, {ALPHA_FEE_BPS / 100}% of outperformance as your fee. Both are fixed once the trial starts.
          </div>

          <div className="row" style={{ alignItems: "center", gap: 16 }}>
            {ready ? (
              <button className="btn btn-wax btn-lg" disabled={!valid || !!pending || full} onClick={sculpt}>
                {pending ?? (full ? "Pool is full" : "Start wax trial")}
              </button>
            ) : (
              <ConnectButton />
            )}
            <span className="faint" style={{ fontSize: 14 }}>Costs gas only. The trial lasts {fmtDuration(TRIAL_DURATION)}.</span>
          </div>
        </div>

        <div className="stack" style={{ flex: "1 1 360px", minWidth: 0, gap: 20 }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600, color: "var(--ink)" }}>Your wax models</h2>
          {mine.length === 0 && (
            <div className="card" style={{ padding: 24, fontSize: 14, lineHeight: 1.6, color: "var(--faint)" }}>
              {address ? "No wax models yet. Start one on the left." : "Connect your wallet to see your wax models."}
            </div>
          )}
          {mine.map((s) => (
            <WaxCard key={s.id.toString()} s={s} />
          ))}
          <div style={{ border: "1px dashed var(--line-2)", borderRadius: 6, padding: 20, fontSize: 14, lineHeight: 1.6, color: "var(--faint)" }}>
            On testnet the trial is {fmtDuration(TRIAL_DURATION)} so a cast can happen live during a demo.
          </div>
        </div>
      </div>
    </div>
  );
}

function WaxCard({ s }: { s: StrategyView }) {
  const now = useNow();
  const { send, pending } = useTx();
  const [ceremony, setCeremony] = useState(false);
  const trial = trialProgress(Number(s.createdAt), Number(s.trialEndsAt), now);
  const pool = poolForKey(s.key);
  const alpha = alphaOf(s);

  const cast = async () => {
    await send("Cast in bronze", { address: HOOK, abi: hookAbi, functionName: "cast", args: [s.id] });
    setCeremony(true);
  };

  return (
    <div className={`card stack${s.qualified ? " card-hot" : ""}`} style={{ padding: 24, gap: 18 }}>
      {ceremony && <CastCeremony name={s.name} onDone={() => setCeremony(false)} />}
      <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
        <Plaque variant="wax" width={60} height={76} />
        <div className="stack" style={{ gap: 4, minWidth: 0 }}>
          <Link href={`/strategy/${s.id}`} className="serif" style={{ fontSize: 26 }}>{s.name}</Link>
          <div className="faint" style={{ fontSize: 14 }}>{pool?.label} · {trial.done ? "trial complete" : "in trial"}</div>
        </div>
      </div>
      <div className="stack" style={{ gap: 8 }}>
        <div className="bar"><div style={{ width: `${trial.pct}%`, background: trial.done ? "var(--gold)" : "var(--wax)" }} /></div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "var(--muted)" }}>
          <span>{trial.label}</span>
          <span className={alpha >= 0 ? "up" : "down"}>{fmtBps(alpha)} vs lazy LP</span>
        </div>
      </div>
      {s.qualified ? (
        <>
          <div style={{ fontSize: 14, color: "var(--text)" }}>Qualified. This model can be cast into a live vault.</div>
          <button className="btn btn-primary" disabled={!!pending} onClick={cast}>{pending ? "Pouring…" : "Cast in bronze"}</button>
        </>
      ) : trial.done ? (
        <>
          <div className="muted" style={{ fontSize: 14 }}>Trial over and behind the lazy LP. Retire it and sculpt again.</div>
          <button className="btn btn-ghost" disabled={!!pending} onClick={() => send("Retire", { address: HOOK, abi: hookAbi, functionName: "retire", args: [s.id] })}>Retire model</button>
        </>
      ) : (
        <>
          <div className="muted" style={{ fontSize: 14 }}>Needs to stay ahead of the lazy LP until the trial ends.</div>
          <button className="btn btn-ghost" disabled>Cast available in {trial.remaining}</button>
        </>
      )}
    </div>
  );
}

/** current price for a pool: read through any tracked strategy, else the hook's pool state via a view */
function useSpot(strategies: StrategyView[], id: string) {
  const s = strategies.find((x) => poolForKey(x.key)?.id === id);
  const pool = POOLS.find((p) => p.id === id)!;
  const fallback = useReadContract({
    address: HOOK,
    abi: hookAbi,
    functionName: "pools",
    args: [poolId(pool)],
    query: { enabled: IS_DEPLOYED && !s },
  });
  if (s) return quotePerBase(price01(s.sqrtPriceX96), baseIsToken0(pool));
  const tick = (fallback.data as readonly [boolean, number, bigint, bigint] | undefined)?.[1];
  if (tick === undefined) return undefined;
  return quotePerBase(Math.pow(1.0001, tick), baseIsToken0(pool));
}
