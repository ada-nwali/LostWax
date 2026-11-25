import Link from "next/link";
import { Medallion, Plaque, PourArrow } from "@/components/Plaque";

const STEPS = [
  { n: "01", title: "Sculpt in wax", body: "A curator picks a pool, a price range and a rebalance rule. No deposit is needed.", gold: false },
  { n: "02", title: "Prove it", body: "The hook scores the wax model on real swaps and compares it with a lazy LP that never moves.", gold: false },
  { n: "03", title: "Cast in bronze", body: "A model that beats the lazy LP becomes a live vault. Depositors can now commission it.", gold: true },
  { n: "04", title: "Paid for alpha only", body: "The curator's fee is a share of the outperformance. No outperformance, no fee.", gold: true },
];

export default function Landing() {
  return (
    <>
      <section className="container" style={{ padding: "96px 32px 88px", display: "flex", flexWrap: "wrap", alignItems: "center", gap: 64 }}>
        <div className="stack reveal" style={{ flex: "1 1 480px", minWidth: 0, gap: 28 }}>
          <div className="eyebrow">A Uniswap v4 hook on Unichain</div>
          <h1 className="serif hero-title" style={{ margin: 0, fontSize: 76, lineHeight: 1.02 }}>
            Modelled in wax. Proven. Then cast in bronze.
          </h1>
          <p className="lede" style={{ fontSize: 19, maxWidth: 540, color: "#C9BBA1" }}>
            Curators test a liquidity strategy with no capital at risk. Only strategies that beat a passive LP are cast into
            live vaults, and curators are paid only for the amount they outperform.
          </p>
          <div className="row" style={{ gap: 14 }}>
            <Link href="/foundry" className="btn btn-primary btn-lg">Enter the Foundry</Link>
            <Link href="/studio" className="btn btn-outline btn-lg">Sculpt a strategy</Link>
          </div>
        </div>

        <div style={{ flex: "1 1 420px", minWidth: 0, display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "center", gap: 24 }}>
          <figure className="stack" style={{ alignItems: "center", gap: 14, margin: 0 }}>
            <Plaque variant="wax" width={200} height={260} float />
            <figcaption className="label" style={{ fontSize: 13, letterSpacing: "0.12em", color: "var(--wax)" }}>Wax · in trial</figcaption>
          </figure>
          <PourArrow />
          <figure className="stack" style={{ alignItems: "center", gap: 14, margin: 0 }}>
            <Plaque variant="bronze" width={200} height={260} float />
            <figcaption className="label" style={{ fontSize: 13, letterSpacing: "0.12em", color: "var(--gold)" }}>Bronze · live vault</figcaption>
          </figure>
        </div>
      </section>

      <section className="band">
        <div className="container section stack" style={{ gap: 48 }}>
          <div className="stack" style={{ gap: 12, maxWidth: 640 }}>
            <div className="eyebrow">The process</div>
            <h2 className="h2">Four steps from idea to live liquidity</h2>
          </div>
          <div className="row">
            {STEPS.map((s) => (
              <div key={s.n} className="card stack" style={{ flex: "1 1 240px", minWidth: 0, padding: 28, gap: 14 }}>
                <div className="serif" style={{ fontSize: 40, color: s.gold ? "var(--gold)" : "var(--wax)" }}>{s.n}</div>
                <h3 style={{ margin: 0, fontSize: 19, fontWeight: 600, color: "var(--ink)" }}>{s.title}</h3>
                <p style={{ margin: 0, fontSize: 15, lineHeight: 1.6, color: "var(--muted)" }}>{s.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="container section row" style={{ gap: 24 }}>
        <div className="card stack" style={{ flex: "1 1 420px", minWidth: 0, padding: 40, gap: 18 }}>
          <div className="eyebrow">For depositors</div>
          <h2 className="serif" style={{ margin: 0, fontSize: 38, lineHeight: 1.1 }}>Commission a proven strategy</h2>
          <p style={{ margin: 0, fontSize: 16, lineHeight: 1.65, color: "var(--muted)" }}>
            Every bronze strategy shows its record against the lazy LP. The hook holds your funds, the curator can only move
            the range inside published limits, and you can withdraw at any time.
          </p>
          <Link href="/foundry" style={{ alignSelf: "flex-start", minHeight: 44, display: "inline-flex", alignItems: "center", fontWeight: 600 }}>Browse the Foundry →</Link>
        </div>
        <div className="card stack" style={{ flex: "1 1 420px", minWidth: 0, padding: 40, gap: 18 }}>
          <div className="eyebrow">For curators</div>
          <h2 className="serif" style={{ margin: 0, fontSize: 38, lineHeight: 1.1 }}>Earn a record before you earn deposits</h2>
          <p style={{ margin: 0, fontSize: 16, lineHeight: 1.65, color: "var(--muted)" }}>
            You need skill, not capital or connections. Run a wax model, let the hook score it, and cast it when it
            qualifies. Your track record is on-chain from the first swap.
          </p>
          <Link href="/studio" style={{ alignSelf: "flex-start", minHeight: 44, display: "inline-flex", alignItems: "center", fontWeight: 600 }}>Open the Studio →</Link>
        </div>
      </section>

      <section className="band">
        <div className="container section" style={{ display: "flex", flexWrap: "wrap", gap: 56, alignItems: "center" }}>
          <div style={{ flex: "0 1 260px", display: "flex", justifyContent: "center" }}>
            <Medallion />
          </div>
          <div className="stack" style={{ flex: "1 1 520px", minWidth: 0, gap: 18 }}>
            <div className="eyebrow">The craft behind the name</div>
            <h2 className="serif" style={{ margin: 0, fontSize: 44, lineHeight: 1.1 }}>Nothing is poured until the model is right</h2>
            <p style={{ margin: 0, fontSize: 17, lineHeight: 1.7, color: "var(--muted)", maxWidth: 640 }}>
              For centuries the bronze casters&apos; guild of Benin City has worked the same way: sculpt the piece in wax,
              encase it in clay, melt the wax out, then pour the metal in. The wax is where mistakes are cheap. LostWax brings
              that discipline to liquidity management.
            </p>
          </div>
        </div>
      </section>

      <section className="container section stack" style={{ gap: 48 }}>
        <div className="stack" style={{ gap: 12, maxWidth: 640 }}>
          <div className="eyebrow">Roadmap</div>
          <h2 className="h2">From testnet foundry to mainnet vaults</h2>
        </div>
        <div className="row">
          {ROADMAP.map((r) => (
            <div key={r.phase} className={`card stack${r.now ? " card-hot" : ""}`} style={{ flex: "1 1 240px", minWidth: 0, padding: 28, gap: 14 }}>
              <div className="label" style={{ color: r.now ? "var(--gold)" : "var(--wax)" }}>{r.phase} · {r.when}</div>
              <h3 style={{ margin: 0, fontSize: 19, fontWeight: 600, color: "var(--ink)" }}>{r.title}</h3>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 15, lineHeight: 1.7, color: "var(--muted)" }}>
                {r.items.map((i) => <li key={i}>{i}</li>)}
              </ul>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

const ROADMAP = [
  { phase: "Phase 1", when: "Live now", now: true, title: "Testnet foundry", items: ["Wax trials scored on real swaps", "Bronze vaults with deposits and withdrawals", "Alpha-only curator fee"] },
  { phase: "Phase 2", when: "Next", now: false, title: "Harden the hook", items: ["TWAP pricing for valuation", "Vault shares as ERC-20 tokens", "Independent security audit"] },
  { phase: "Phase 3", when: "Then", now: false, title: "Mainnet launch", items: ["Unichain mainnet with real pools", "Curator profiles with full on-chain records", "More rebalance rules"] },
  { phase: "Phase 4", when: "Later", now: false, title: "Open the market", items: ["Vault shares usable across DeFi", "Curator leaderboards and discovery", "Any v4 pool, any chain with v4"] },
];
