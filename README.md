# LostWax

**Proven before funded.** LostWax is a curated liquidity platform where managers must prove a strategy before anyone can fund it. Every strategy starts as a risk-free trial measured against real market activity, and only those that beat a passive position open for deposits. Depositors keep control of their funds and can exit at any time, while managers earn only when they outperform.

Built as a single Uniswap v4 hook on Unichain for the UHI11 Hookathon (Active Management & Curation).

> The name comes from lost-wax casting, the method of the Benin bronze casters: sculpt in wax, where mistakes are cheap, and only pour bronze once the model is right.

---

## How it works

| Stage | What happens | Where |
|---|---|---|
| **Wax** | A curator sculpts a strategy: pool, price range, rebalance rule, cooldown. No deposit. | `sculpt()` |
| **Prove** | On every swap the hook credits the wax shadow with the pool's real fee growth, but only while it is in range. A *lazy LP* (full range, never moves) is scored alongside it. | `afterSwap` |
| **Bronze** | After the trial, if the wax model is ahead of the lazy LP, the curator casts it into a live vault. | `cast()` |
| **Alpha fee** | Depositors get shares. The curator is paid a cut of the *excess over the lazy LP* only, as minted shares, with a high-water mark. | `harvest()` |

Guardrails are fixed at sculpt time and enforced by the hook: largest move per rebalance, cooldown, the rule itself. The curator can never withdraw depositor funds. Recenters are permissionless when the rule fires.

Full design notes: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Repo layout

```
lostwax/
├── contracts/            Foundry project
│   ├── src/
│   │   ├── LostWaxHook.sol         hook: scoring, vaults, mandate, alpha fee
│   │   ├── interfaces/ILostWax.sol types, events, errors
│   │   ├── libraries/ShadowMath.sol position valuation
│   │   └── testnet/                TestToken + one-click Faucet
│   ├── script/
│   │   ├── Deploy.s.sol            tokens, faucet, routers, hook (CREATE2-mined), 4 pools, seed trials
│   │   ├── Activity.s.sol          demo keeper: swaps, recenters, casts
│   │   └── Config.sol              shared market config
│   └── test/                       18 tests incl. full deploy + keeper run
├── frontend/             Next.js 14 app (wagmi + viem)
│   └── src/app/          /  /foundry  /strategy/[id]  /studio  /portfolio
└── docs/
    ├── ARCHITECTURE.md
    ├── DEMO_VIDEO.md               2-minute video script
    └── LostWax-Pitch-Deck.pptx
```

## Quickstart

Requirements: [Foundry](https://book.getfoundry.sh), Node 18+, git, a wallet with Unichain Sepolia ETH (see the faucets listed in the Unichain docs).

### 1. Contracts

```bash
cd contracts
make install          # pinned forge-std + v4-periphery (brings v4-core)
make build
make test             # 18 passing
cp .env.example .env  # add PRIVATE_KEY
make deploy           # Unichain Sepolia
```

`make deploy` writes the addresses to `contracts/deployments/1301.json` **and** `frontend/src/config/deployment.json`, so the app is wired up as soon as it finishes.

What it deploys:
- five 18-decimal test tokens (tWETH, tUSDC, tUSDT, tWBTC, tUNI) and a faucet
- `PoolSwapTest` and `PoolModifyLiquidityTest` routers on the official PoolManager `0x00B0…62AC`
- the LostWax hook at a mined address with `afterInitialize | afterSwap` flags
- four pools (ETH/USDC, WBTC/USDC, UNI/USDC, USDC/USDT) with ~$2M full-range depth each
- four seeded wax trials (turn off with `SEED_TRIALS=false`)

Trial length defaults to 30 minutes on testnet (`TRIAL_DURATION`), so a cast can happen during a live demo.

To keep the demo moving, run the keeper every few minutes. It round-trips swaps on every pool, recenters strategies whose rule fired and casts qualified trials you own:

```bash
make activity         # ROUNDS=5 make activity for more volume
```

### 2. Frontend

```bash
cd frontend
npm install
npm run dev           # http://localhost:3000
```

Deploy to Vercel: import the repo, set the root directory to `frontend`, no env vars needed (`NEXT_PUBLIC_RPC_URL` is optional). Commit `src/config/deployment.json` after `make deploy` so the hosted app points at your contracts.

## Try it

1. **Connect** a wallet on Unichain Sepolia. The app offers to switch or add the network.
2. **Portfolio → Mint test tokens** for a drip of all five tokens.
3. **Foundry** lists every strategy. Bronze cards are open for deposits, wax cards are in trial.
4. **Strategy page**: deposit both tokens (the second amount fills itself at the vault's ratio), follow share value against the lazy LP, and read the mandate.
5. **Studio**: sculpt your own wax model, watch its score, and cast it when it qualifies.
6. **Portfolio → Make a test swap** to move the market yourself and see the scores react.

## Judging map

| Criteria | Where to look |
|---|---|
| Original idea | On-chain *audition* for managers: scored against a lazy LP inside the hook before they can take a deposit, and paid on alpha only. |
| Unique execution | Shadow positions accrue from `feeGrowthGlobal` in `afterSwap`, no oracle or off-chain scorer. One hook covers scoring, custody, guardrails and fees. |
| Impact | Verifiable curation for depositors, a path in for skilled LPs without capital, deeper managed liquidity for v4 pools. |
| Functionality | 18 Foundry tests, including the real deploy and keeper scripts end to end. Live app on Unichain Sepolia. |
| Presentation | [`docs/DEMO_VIDEO.md`](docs/DEMO_VIDEO.md) and [`docs/LostWax-Pitch-Deck.pptx`](docs/LostWax-Pitch-Deck.pptx). |

## Known limits (testnet build)

- Valuation uses spot price; a TWAP is the next step to harden scoring and `recenter` against manipulation.
- A wax shadow is a *marginal* position: it doesn't dilute the fees it is scored on. Fine for ranking, slightly generous for very large strategies.
- Shares are internal balances, not ERC-20s yet.
- Not audited. Testnet only.

## License

MIT
# LostWax
