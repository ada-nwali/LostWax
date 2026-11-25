"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useAccount } from "wagmi";
import { parseUnits } from "viem";
import { ConnectButton } from "@/components/Header";
import { faucetAbi, hookAbi, Stage, swapRouterAbi, type StrategyView } from "@/lib/contracts";
import { useApprove, usePositions, useStrategies, useTx } from "@/lib/hooks";
import { alphaOf, fmt, fmtBps, price01, token1ToQuote, wei } from "@/lib/market";
import { chain } from "@/lib/wagmi";
import { baseIsToken0, FAUCET, HOOK, POOLS, poolForKey, poolKey, SWAP_ROUTER, tokenAddress } from "@/config/pools";

const MIN_SQRT = 4295128740n;
const MAX_SQRT = 1461446703485210103287273052203988822378723970341n;

function quoteOf(s: StrategyView, v1: bigint) {
  const pool = poolForKey(s.key);
  if (!pool) return 0;
  return token1ToQuote(wei(v1), price01(s.sqrtPriceX96), baseIsToken0(pool));
}

export default function Portfolio() {
  const { address, isConnected, chainId } = useAccount();
  const { strategies } = useStrategies();
  const { send, pending } = useTx();
  const bronze = useMemo(() => strategies.filter((s) => s.stage === Stage.Bronze), [strategies]);
  const ids = useMemo(() => bronze.map((s) => s.id), [bronze]);
  const { positions, refetch } = usePositions(ids);

  const rows = bronze
    .map((s) => {
      const p = positions.get(s.id.toString()) ?? { shares: 0n, cost: 0n };
      const value = s.totalShares > 0n ? (quoteOf(s, s.tvl) * Number(p.shares)) / Number(s.totalShares) : 0;
      return { s, shares: p.shares, value, cost: quoteOf(s, p.cost) };
    })
    .filter((r) => r.shares > 0n);

  const total = rows.reduce((a, r) => a + r.value, 0);
  const cost = rows.reduce((a, r) => a + r.cost, 0);
  const ahead = total > 0 ? rows.reduce((a, r) => a + alphaOf(r.s) * r.value, 0) / total : 0;

  const mineAsCurator = bronze.filter((s) => address && s.curator.toLowerCase() === address.toLowerCase());
  const claimable = mineAsCurator.filter((s) => s.pendingFee > 0n);
  const claimTotal = claimable.reduce((a, s) => a + quoteOf(s, s.pendingFee), 0);
  const ready = isConnected && chainId === chain.id;

  const claim = async () => {
    for (const s of claimable) {
      await send(`Claim alpha fee · ${s.name}`, { address: HOOK, abi: hookAbi, functionName: "harvest", args: [s.id] });
    }
    refetch();
  };

  return (
    <div className="container stack" style={{ padding: "64px 32px 96px", gap: 36 }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", justifyContent: "space-between", gap: 24 }}>
        <h1 className="h1">Your portfolio</h1>
        <span className="note">Values in USD stablecoins · test tokens</span>
      </div>

      {!ready ? (
        <div className="card card-pad stack" style={{ gap: 16, alignItems: "flex-start" }}>
          <p className="muted" style={{ margin: 0 }}>Connect a wallet on Unichain Sepolia to see your positions and claim test tokens.</p>
          <ConnectButton />
        </div>
      ) : (
        <>
          <div className="row" style={{ gap: 16 }}>
            <div className="card stat" style={{ flex: "1 1 240px", padding: 24 }}>
              <div className="stat-k">Value of your shares</div>
              <div className="stat-v" style={{ fontSize: 34, color: "var(--ink)" }}>{rows.length ? `${fmt(total)} USD` : "–"}</div>
            </div>
            <div className="card stat" style={{ flex: "1 1 240px", padding: 24 }}>
              <div className="stat-k">Gain since deposit</div>
              <div className={`stat-v ${total - cost >= 0 ? "" : "down"}`} style={{ fontSize: 34, color: total - cost >= 0 ? "var(--ink)" : undefined }}>
                {rows.length ? `${total - cost >= 0 ? "+" : ""}${fmt(total - cost)} USD` : "–"}
              </div>
            </div>
            <div className="card stat" style={{ flex: "1 1 240px", padding: 24 }}>
              <div className="stat-k">Ahead of the lazy LP by</div>
              <div className={`stat-v ${ahead >= 0 ? "up" : "down"}`} style={{ fontSize: 34 }}>{rows.length ? fmtBps(ahead) : "–"}</div>
            </div>
          </div>

          <div className="card card-pad stack" style={{ gap: 16 }}>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600, color: "var(--ink)" }}>Commissioned strategies</h2>
            {rows.length === 0 ? (
              <p className="muted" style={{ margin: 0 }}>
                No deposits yet. <Link href="/foundry?f=bronze">Commission a bronze strategy →</Link>
              </p>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table className="table">
                  <thead>
                    <tr><th>Strategy</th><th>Pool</th><th className="r">Value</th><th className="r">vs lazy LP</th><th className="r">Action</th></tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.s.id.toString()}>
                        <td><Link href={`/strategy/${r.s.id}`} className="serif" style={{ fontSize: 22 }}>{r.s.name}</Link></td>
                        <td className="muted">{poolForKey(r.s.key)?.label}</td>
                        <td className="r num">{fmt(r.value)} {poolForKey(r.s.key)?.quoteLabel}</td>
                        <td className={`r num ${alphaOf(r.s) >= 0 ? "up" : "down"}`}>{fmtBps(alphaOf(r.s))}</td>
                        <td className="r">
                          <button
                            className="btn btn-outline"
                            style={{ fontSize: 14, padding: "0 16px" }}
                            disabled={!!pending}
                            onClick={async () => {
                              await send(`Withdraw ${r.s.name}`, { address: HOOK, abi: hookAbi, functionName: "withdraw", args: [r.s.id, r.shares, 0n, 0n] });
                              refetch();
                            }}
                          >
                            Withdraw
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="row">
            <div className="card card-pad stack" style={{ flex: "1 1 340px", minWidth: 0, gap: 14 }}>
              <div className="eyebrow" style={{ letterSpacing: "0.14em" }}>Curator earnings</div>
              <div className="num" style={{ fontSize: 30, fontWeight: 600, color: "var(--ink)" }}>{claimTotal > 0 ? `${fmt(claimTotal)} USD claimable` : "Nothing to claim yet"}</div>
              <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6, color: "var(--muted)" }}>
                {mineAsCurator.length
                  ? `Your share of the outperformance on ${mineAsCurator.map((s) => s.name).join(", ")} since your last claim. Paid as vault shares you can withdraw.`
                  : "Cast a strategy in the Studio to earn a share of the alpha you deliver."}
              </p>
              <button className="btn btn-primary" style={{ alignSelf: "flex-start" }} disabled={!claimable.length || !!pending} onClick={claim}>
                Claim alpha fee
              </button>
            </div>
            <div className="card card-pad stack" style={{ flex: "1 1 340px", minWidth: 0, gap: 14 }}>
              <div className="eyebrow" style={{ letterSpacing: "0.14em" }}>Testnet faucet</div>
              <div style={{ fontSize: 30, fontWeight: 600, color: "var(--ink)" }}>Get test tokens</div>
              <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6, color: "var(--muted)" }}>
                Mint test WETH, WBTC, UNI, USDC and USDT to your wallet so you can try a deposit on Unichain Sepolia. Gas comes from a Unichain Sepolia ETH faucet.
              </p>
              <button className="btn btn-outline" style={{ alignSelf: "flex-start" }} disabled={!!pending} onClick={() => send("Mint test tokens", { address: FAUCET, abi: faucetAbi, functionName: "drip" })}>
                Mint test tokens
              </button>
            </div>
            <MoveMarket />
          </div>
        </>
      )}
    </div>
  );
}

/** Swap through the pool so wax shadows and vaults earn fees during a demo. */
function MoveMarket() {
  const { send, pending } = useTx();
  const approve = useApprove();
  const [poolId, setPoolId] = useState(POOLS[0].id);
  const [side, setSide] = useState<"sell" | "buy">("sell");
  const [amount, setAmount] = useState("1");
  const pool = POOLS.find((p) => p.id === poolId)!;

  const swap = async () => {
    const amt = parseUnits(amount || "0", 18);
    const tokenIn = side === "sell" ? tokenAddress(pool.base) : tokenAddress(pool.quote);
    const zeroForOne = (side === "sell") === baseIsToken0(pool);
    await approve(tokenIn, SWAP_ROUTER, amt, side === "sell" ? pool.baseLabel : pool.quoteLabel);
    await send("Swap", {
      address: SWAP_ROUTER,
      abi: swapRouterAbi,
      functionName: "swap",
      args: [poolKey(pool), { zeroForOne, amountSpecified: -amt, sqrtPriceLimitX96: zeroForOne ? MIN_SQRT : MAX_SQRT }, { takeClaims: false, settleUsingBurn: false }, "0x"],
    });
  };

  return (
    <div className="card card-pad stack" style={{ flex: "1 1 340px", minWidth: 0, gap: 14 }}>
      <div className="eyebrow" style={{ letterSpacing: "0.14em" }}>Move the market</div>
      <div style={{ fontSize: 30, fontWeight: 600, color: "var(--ink)" }}>Make a test swap</div>
      <div className="row" style={{ gap: 10 }}>
        <select aria-label="Pool" className="select" style={{ flex: "1 1 140px" }} value={poolId} onChange={(e) => setPoolId(e.target.value)}>
          {POOLS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
        <select aria-label="Direction" className="select" style={{ flex: "1 1 120px" }} value={side} onChange={(e) => setSide(e.target.value as "sell" | "buy")}>
          <option value="sell">Sell {pool.baseLabel}</option>
          <option value="buy">Spend {pool.quoteLabel}</option>
        </select>
      </div>
      <div className="field">
        <label htmlFor="mm-amt">Amount in</label>
        <input id="mm-amt" className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </div>
      <button className="btn btn-outline" style={{ alignSelf: "flex-start" }} disabled={!Number(amount) || !!pending} onClick={swap}>Swap</button>
    </div>
  );
}
