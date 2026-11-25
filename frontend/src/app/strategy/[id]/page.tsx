"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useMemo, useState } from "react";
import { useAccount, useReadContracts } from "wagmi";
import { parseUnits } from "viem";
import { Plaque } from "@/components/Plaque";
import { ValueChart } from "@/components/ValueChart";
import { CastCeremony } from "@/components/CastCeremony";
import { ConnectButton } from "@/components/Header";
import { erc20Abi, hookAbi, RULE_LABEL, Rule, Stage, type StrategyView } from "@/lib/contracts";
import { useApprove, useHistory, useMarket, useNow, usePositions, useStrategy, useTx } from "@/lib/hooks";
import { alphaOf, ago, fmt, fmtBps, fmtDuration, fmtPrice, rangeInQuote, shortAddr, ticksFromPrices, trialProgress, unitAmounts, wei } from "@/lib/market";
import { chain } from "@/lib/wagmi";
import { HOOK, tokenAddress, type PoolConfig } from "@/config/pools";

type Market = NonNullable<ReturnType<typeof useMarket>>;

export default function StrategyPage() {
  const params = useParams<{ id: string }>();
  const id = BigInt(params.id ?? "0");
  const { strategy: s, isLoading } = useStrategy(id);
  const history = useHistory(id);
  const m = useMarket(s);
  const now = useNow();

  if (!s || !m) {
    return (
      <div className="container" style={{ padding: "64px 32px" }}>
        <p className="muted">{isLoading ? "Reading strategy…" : "Strategy not found."}</p>
      </div>
    );
  }

  const bronze = s.stage === Stage.Bronze;
  const [lowP, highP] = rangeInQuote(s.tickLower, s.tickUpper, m.baseIs0);
  const trial = trialProgress(Number(s.createdAt), Number(s.trialEndsAt), now);
  const stateLine = bronze
    ? `Bronze · live · cast ${ago(Number(s.castAt), now)}`
    : s.stage === Stage.Wax
      ? `Wax · in trial · ${trial.done ? "trial complete" : `${trial.remaining} left`}`
      : "Retired";
  const alpha = alphaOf(s);

  return (
    <div className="container stack" style={{ padding: "40px 32px 96px", gap: 36 }}>
      <Link href="/foundry" style={{ alignSelf: "flex-start", display: "inline-flex", alignItems: "center", minHeight: 44, fontSize: 14, color: "var(--muted)" }}>
        ← Back to the Foundry
      </Link>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 32, alignItems: "center" }}>
        <Plaque variant={bronze ? "bronze" : "wax"} width={132} height={172} float />
        <div className="stack" style={{ flex: "1 1 420px", minWidth: 0, gap: 10 }}>
          <div className="label" style={{ color: bronze ? "var(--gold)" : "var(--wax)" }}>{stateLine}</div>
          <h1 className="serif" style={{ margin: 0, fontSize: 64, lineHeight: 1.02 }}>{s.name}</h1>
          <div className="muted" style={{ fontSize: 16 }}>{m.pool.label} · curated by {shortAddr(s.curator)}</div>
        </div>
        {bronze && Number(s.trialAlphaBps) > 0 && <span className="note">Cast with {fmtBps(s.trialAlphaBps)} in trial</span>}
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 28, alignItems: "flex-start" }}>
        <div className="stack" style={{ flex: "999 1 560px", minWidth: 0, gap: 24 }}>
          <div className="row" style={{ gap: 16 }}>
            <div className="card stat">
              <div className="stat-k">vs lazy LP</div>
              <div className={`stat-v ${alpha >= 0 ? "up" : "down"}`}>{s.benchIndex > 0n ? fmtBps(alpha) : "–"}</div>
            </div>
            <div className="card stat">
              <div className="stat-k">{bronze ? "Deposits" : "Trial"}</div>
              <div className="stat-v">{bronze ? fmt(m.toQuote(s.tvl)) : trial.label}</div>
            </div>
            <div className="card stat">
              <div className="stat-k">Current range</div>
              <div className="stat-v">{fmtPrice(lowP)}–{fmtPrice(highP)}</div>
            </div>
            <div className="card stat">
              <div className="stat-k">Curator fee</div>
              <div className="stat-v">{s.mandate.alphaFeeBps / 100}% of alpha</div>
            </div>
          </div>

          <div className="card card-pad stack" style={{ gap: 20 }}>
            <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600, color: "var(--ink)" }}>
                {bronze ? "Share value against the lazy LP" : "Wax model against the lazy LP"}
              </h2>
              <div className="row" style={{ gap: 20, fontSize: 13, color: "var(--muted)" }}>
                <span style={{ display: "flex", alignItems: "center", gap: 8 }}><span style={{ width: 18, height: 3, background: "var(--gold)" }} />{s.name}</span>
                <span style={{ display: "flex", alignItems: "center", gap: 8 }}><span style={{ width: 18, borderTop: "2px dashed var(--faint)" }} />Lazy LP (full range, never moved)</span>
              </div>
            </div>
            <ValueChart history={history} label={s.name} />
            <div className="faint" style={{ fontSize: 13 }}>
              Ringed points mark rebalances. Price now: {fmtPrice(m.baseIs0 ? m.p01 : 1 / m.p01)} {m.pool.quoteLabel} per {m.pool.baseLabel}.
            </div>
          </div>

          <Mandate s={s} m={m} />
          <CuratorTools s={s} m={m} />
        </div>

        <div className="card card-pad card-bronze stack" style={{ flex: "1 1 340px", minWidth: 0, gap: 20 }}>
          {bronze ? <DepositPanel s={s} m={m} /> : <WaxPanel s={s} trial={trial} />}
        </div>
      </div>
    </div>
  );
}

function Mandate({ s, m }: { s: StrategyView; m: Market }) {
  const { send, pending } = useTx();
  const pct = ((Math.pow(1.0001, s.mandate.maxTickMove) - 1) * 100).toFixed(1);
  return (
    <div className="card card-pad stack" style={{ gap: 18 }}>
      <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600, color: "var(--ink)" }}>Mandate enforced by the hook</h2>
      <div className="stack">
        <div className="kv"><span>Pool</span><span>{m.pool.label} only</span></div>
        <div className="kv"><span>Rebalance rule</span><span>{RULE_LABEL[s.mandate.rule as Rule]}</span></div>
        <div className="kv"><span>Largest range move per rebalance</span><span>{s.mandate.maxTickMove} ticks (~{pct}%)</span></div>
        <div className="kv"><span>Cooldown between rebalances</span><span>{fmtDuration(s.mandate.cooldown)}</span></div>
        <div className="kv"><span>Curator can withdraw depositor funds</span><span>Never</span></div>
        <div className="kv"><span>Depositor exit</span><span>Any time</span></div>
      </div>
      {s.canRecenter && (
        <div className="card" style={{ padding: 20, display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 14, borderColor: "var(--gold)", background: "#1b140c" }}>
          <span style={{ fontSize: 14, color: "var(--text)" }}>The rebalance rule has fired. Anyone can trigger the recenter.</span>
          <button className="btn btn-primary" disabled={!!pending} onClick={() => send("Recenter", { address: HOOK, abi: hookAbi, functionName: "recenter", args: [s.id] })}>
            {pending ? <span className="spinner" /> : null} Recenter now
          </button>
        </div>
      )}
    </div>
  );
}

function CuratorTools({ s, m }: { s: StrategyView; m: Market }) {
  const { address } = useAccount();
  const { send, pending } = useTx();
  const [lo, setLo] = useState("");
  const [hi, setHi] = useState("");
  if (!address || address.toLowerCase() !== s.curator.toLowerCase() || (s.stage !== Stage.Wax && s.stage !== Stage.Bronze)) return null;

  const move = () => {
    const t = ticksFromPrices(Number(lo), Number(hi), m.baseIs0, m.pool.spacing);
    send("Rebalance", { address: HOOK, abi: hookAbi, functionName: "rebalance", args: [s.id, t.lo, t.hi] });
  };

  return (
    <div className="card card-pad stack" style={{ gap: 16 }}>
      <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600, color: "var(--ink)" }}>Curator controls</h2>
      <div className="row" style={{ gap: 16 }}>
        <div className="field" style={{ flex: "1 1 180px" }}>
          <label htmlFor="c-lo">New lower price ({m.pool.quoteLabel} per {m.pool.baseLabel})</label>
          <input id="c-lo" className="input" inputMode="decimal" value={lo} onChange={(e) => setLo(e.target.value)} />
        </div>
        <div className="field" style={{ flex: "1 1 180px" }}>
          <label htmlFor="c-hi">New upper price</label>
          <input id="c-hi" className="input" inputMode="decimal" value={hi} onChange={(e) => setHi(e.target.value)} />
        </div>
      </div>
      <button className="btn btn-outline" style={{ alignSelf: "flex-start" }} disabled={!lo || !hi || !!pending} onClick={move}>
        Move range within mandate
      </button>
    </div>
  );
}

function WaxPanel({ s, trial }: { s: StrategyView; trial: ReturnType<typeof trialProgress> }) {
  const { address } = useAccount();
  const { send, pending } = useTx();
  const [ceremony, setCeremony] = useState(false);
  const isCurator = !!address && address.toLowerCase() === s.curator.toLowerCase();
  const alpha = alphaOf(s);

  const cast = async () => {
    await send("Cast in bronze", { address: HOOK, abi: hookAbi, functionName: "cast", args: [s.id] });
    setCeremony(true);
  };

  if (s.stage === Stage.Retired) {
    return <p className="muted" style={{ margin: 0 }}>This wax model was retired. It never held funds.</p>;
  }

  return (
    <>
      {ceremony && <CastCeremony name={s.name} onDone={() => setCeremony(false)} />}
      <h2 className="serif" style={{ margin: 0, fontSize: 32 }}>Still in wax</h2>
      <div className="stack" style={{ gap: 8 }}>
        <div className="bar"><div style={{ width: `${trial.pct}%`, background: trial.done ? "var(--gold)" : "var(--wax)" }} /></div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "var(--muted)" }}>
          <span>{trial.label}</span>
          <span className={alpha >= 0 ? "up" : "down"}>{fmtBps(alpha)} vs lazy LP</span>
        </div>
      </div>
      <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6, color: "var(--muted)" }}>
        This strategy holds no funds yet. Deposits open once it beats the lazy LP for the whole trial and the curator casts it in bronze.
      </p>
      {isCurator && s.qualified && (
        <button className="btn btn-primary btn-lg" disabled={!!pending} onClick={cast}>{pending ? "Pouring…" : "Cast in bronze"}</button>
      )}
      {isCurator && trial.done && !s.qualified && (
        <button className="btn btn-ghost" disabled={!!pending} onClick={() => send("Retire", { address: HOOK, abi: hookAbi, functionName: "retire", args: [s.id] })}>
          Retire this model
        </button>
      )}
      {!isCurator && <div className="faint" style={{ fontSize: 13 }}>Only the curator can cast. Check back when the trial ends.</div>}
    </>
  );
}

function DepositPanel({ s, m }: { s: StrategyView; m: Market }) {
  const { address, isConnected, chainId } = useAccount();
  const { send, pending } = useTx();
  const approve = useApprove();
  const [tab, setTab] = useState<"deposit" | "withdraw">("deposit");
  const [baseAmt, setBaseAmt] = useState("");
  const [quoteAmt, setQuoteAmt] = useState("");
  const [pct, setPct] = useState(100);
  const ids = useMemo(() => [s.id], [s.id]);
  const { positions, refetch } = usePositions(ids);
  const pos = positions.get(s.id.toString()) ?? { shares: 0n, cost: 0n };
  const pool: PoolConfig = m.pool;
  const baseToken = tokenAddress(pool.base);
  const quoteToken = tokenAddress(pool.quote);

  const balances = useReadContracts({
    contracts: address
      ? [
          { address: baseToken, abi: erc20Abi, functionName: "balanceOf", args: [address] },
          { address: quoteToken, abi: erc20Abi, functionName: "balanceOf", args: [address] },
        ]
      : [],
    query: { enabled: !!address, refetchInterval: 8000 },
  });
  const baseBal = wei((balances.data?.[0]?.result as bigint | undefined) ?? 0n);
  const quoteBal = wei((balances.data?.[1]?.result as bigint | undefined) ?? 0n);

  // base/quote per unit liquidity at the current price
  const unit = unitAmounts(s.sqrtPriceX96, s.tickLower, s.tickUpper);
  const perBase = m.baseIs0 ? unit.a0 : unit.a1;
  const perQuote = m.baseIs0 ? unit.a1 : unit.a0;

  const onBase = (v: string) => {
    setBaseAmt(v);
    const x = Number(v);
    if (perBase > 0 && x > 0) setQuoteAmt(perQuote > 0 ? String(+((x / perBase) * perQuote).toPrecision(8)) : "0");
  };
  const onQuote = (v: string) => {
    setQuoteAmt(v);
    const x = Number(v);
    if (perQuote > 0 && x > 0) setBaseAmt(perBase > 0 ? String(+((x / perQuote) * perBase).toPrecision(8)) : "0");
  };

  /** Expected shares at the current price, minus 3% tolerance. The hook reverts below this. */
  const minSharesFor = (a0: bigint, a1: bigint) => {
    // the range takes the limiting side; value what is actually used, in token1 wei
    const liq = Math.min(unit.a0 > 0 ? Number(a0) / unit.a0 : Infinity, unit.a1 > 0 ? Number(a1) / unit.a1 : Infinity);
    const value = liq * unit.a0 * m.p01 + liq * unit.a1;
    const expected = s.totalShares > 0n && s.tvl > 0n ? (value * Number(s.totalShares)) / Number(s.tvl) : value;
    return Number.isFinite(expected) && expected > 0 ? BigInt(Math.floor(expected * 0.97)) : 0n;
  };

  const shareValue = s.totalShares > 0n ? (m.toQuote(s.tvl) * Number(pos.shares)) / Number(s.totalShares) : 0;
  const withdrawShares = (pos.shares * BigInt(pct)) / 100n;
  const ready = isConnected && chainId === chain.id;

  const deposit = async () => {
    const b = parseUnits(baseAmt || "0", 18);
    const q = parseUnits(quoteAmt || "0", 18);
    await approve(baseToken, HOOK, b, pool.baseLabel);
    await approve(quoteToken, HOOK, q, pool.quoteLabel);
    const [a0, a1] = m.baseIs0 ? [b, q] : [q, b];
    await send("Deposit", { address: HOOK, abi: hookAbi, functionName: "deposit", args: [s.id, a0, a1, minSharesFor(a0, a1)] });
    setBaseAmt("");
    setQuoteAmt("");
    refetch();
  };

  const withdraw = async () => {
    await send("Withdraw", { address: HOOK, abi: hookAbi, functionName: "withdraw", args: [s.id, withdrawShares, 0n, 0n] });
    refetch();
  };

  return (
    <>
      <h2 className="serif" style={{ margin: 0, fontSize: 32 }}>Commission this strategy</h2>
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === "deposit"} className={`tab${tab === "deposit" ? " on" : ""}`} onClick={() => setTab("deposit")}>Deposit</button>
        <button role="tab" aria-selected={tab === "withdraw"} className={`tab${tab === "withdraw" ? " on" : ""}`} onClick={() => setTab("withdraw")}>Withdraw</button>
      </div>

      {tab === "deposit" ? (
        <>
          <div className="field">
            <label htmlFor="amt-base">{pool.baseLabel} amount <span className="faint">· balance {fmt(baseBal)}</span></label>
            <input id="amt-base" className="input input-lg" inputMode="decimal" placeholder="0.0" value={baseAmt} disabled={perBase === 0} onChange={(e) => onBase(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="amt-quote">{pool.quoteLabel} amount <span className="faint">· balance {fmt(quoteBal)}</span></label>
            <input id="amt-quote" className="input input-lg" inputMode="decimal" placeholder="0.0" value={quoteAmt} disabled={perQuote === 0} onChange={(e) => onQuote(e.target.value)} />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 14, color: "var(--muted)" }}>
            <span>You receive</span>
            <span style={{ color: "var(--text)" }}>{s.name} shares</span>
          </div>
          {ready ? (
            <button className="btn btn-primary btn-lg" disabled={!!pending || (!Number(baseAmt) && !Number(quoteAmt))} onClick={deposit}>
              {pending ?? "Deposit"}
            </button>
          ) : (
            <ConnectButton large />
          )}
        </>
      ) : (
        <>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 15 }}>
            <span className="muted">Your shares are worth</span>
            <span className="num">{pos.shares > 0n ? `${fmt(shareValue)} ${pool.quoteLabel}` : "No shares yet"}</span>
          </div>
          <div className="row" style={{ gap: 8 }}>
            {[25, 50, 75, 100].map((p) => (
              <button key={p} className={`chip${pct === p ? " on" : ""}`} style={{ flex: "1 1 0" }} onClick={() => setPct(p)}>{p}%</button>
            ))}
          </div>
          {ready ? (
            <button className="btn btn-primary btn-lg" disabled={!!pending || withdrawShares === 0n} onClick={withdraw}>
              {pending ?? `Withdraw ${pct}%`}
            </button>
          ) : (
            <ConnectButton large />
          )}
        </>
      )}

      <p style={{ margin: 0, fontSize: 13, lineHeight: 1.6, color: "var(--faint)" }}>
        The hook holds your liquidity. The curator earns a fee only when your shares are ahead of the lazy LP.
      </p>
      <Link href="/portfolio" style={{ display: "inline-flex", alignItems: "center", minHeight: 44, fontSize: 14, fontWeight: 600 }}>
        Need test tokens? Use the faucet →
      </Link>
    </>
  );
}
