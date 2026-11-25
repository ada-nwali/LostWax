# LostWax architecture

One contract, `LostWaxHook`, is both the Uniswap v4 hook and the vault. It uses two hook permissions: `afterInitialize` and `afterSwap`.

```
             sculpt()                 cast()                 deposit()/withdraw()
 curator ───────────────▶  WAX  ───────────────▶  BRONZE  ◀──────────────────────── depositors
                            │                      │
             afterSwap: shadow scored       real v4 position owned by the hook
             vs lazy LP on real swaps       rebalance / recenter within mandate
                                            harvest(): alpha fee as minted shares
```

## Scoring without an oracle

Every v4 pool tracks `feeGrowthGlobal0/1X128`: fees earned per unit of in-range liquidity. The hook stores the last seen value per pool and, on each `afterSwap`:

1. `Δg = feeGrowthGlobal_now − feeGrowthGlobal_last`
2. for each wax strategy in the pool, if the tick was inside its range **before and after** the swap: `fees += L × Δg / 2¹²⁸`
3. saves the new tick and fee growth

That is the same accounting a real position uses, so a wax model earns what a marginal position in that range would have earned. Up to 16 wax trials are tracked per pool to keep swap gas bounded. Casting frees the slot; the vault moves to a separate list (up to 8 per pool) that only takes chart snapshots. Anyone can retire a trial that ended behind the lazy LP, or one left uncast for a second trial length.

v4 does not call a hook for swaps the hook makes itself, so after each vault rebalance swap the hook runs the same accounting step by hand. Pool state never drifts from the PoolManager's.

**Sizing.** Both the wax shadow and the lazy LP start at the same value (`NOTIONAL`, in token1 units). Value is linear in liquidity, so `L = NOTIONAL / value(1e18 liquidity in range)`.

**Lazy LP.** It is full range and always in range, so it needs no per-swap state: `fees = L × (feeGrowthGlobal_now − feeGrowthGlobal_start) / 2¹²⁸`.

**Score.** `index = value / NOTIONAL` for both, where value = position amounts at spot + accrued fees, all in token1. `alphaBps = (strategy − lazy) / lazy`.

**Wax rebalances** convert the shadow's whole value into the new range at spot. No swap costs, so the score reflects range choice.

## Bronze vaults

After `cast()`, the strategy owns a real position in the pool (salt = strategy id). All PoolManager work runs inside `unlockCallback`:

| Action | Flow |
|---|---|
| `POKE` | modify(0) to collect fees into idle balances |
| `DEPOSIT` | add liquidity, user pays exact principal, fees go to idle |
| `WITHDRAW` | remove pro-rata liquidity, principal taken straight to the user, plus pro-rata idle |
| `REBALANCE` | remove all, swap toward the new range's token ratio, add, leftovers stay idle |

Leftover deltas are closed against the vault's idle balances (`_close`), so the hook never holds unaccounted tokens.

**Shares.** The first deposit mints shares 1:1 with value and starts a fresh lazy LP benchmark. Later deposits mint `value × supply / vaultValue`.

**Alpha fee.** On `harvest` (also run before every deposit and withdraw):

```
sharePrice  = vaultValue / supply
lazyIndex   = lazyValue / NOTIONAL
excess      = sharePrice − lazyIndex
if excess > highWater:
    feeValue  = (excess − highWater) × supply × feeBps
    feeShares = feeValue × supply / (vaultValue − feeValue)   → curator
    highWater = new excess
```

No outperformance, no fee. Falling behind resets nothing: the curator earns again only above the old mark.

## Mandate

Set at `sculpt` and immutable:

- `rule`: `OutOfRange`, `Edge80` (price past 80% of the half-width) or `Manual`
- `cooldown`: seconds between rebalances
- `maxTickMove`: largest shift of the range centre per rebalance
- `alphaFeeBps`: up to 30%

`rebalance()` is curator-only and checked against all of the above. `recenter()` is permissionless once the rule fires; the new centre is clamped to `maxTickMove`.

## History

Each strategy keeps a 96-point ring buffer of `(time, strategyIndex, lazyIndex, rebalanced)`. Points are written on actions and from `afterSwap` once per `snapshotInterval`, so the app draws its chart straight from chain state with no indexer.

## Frontend

Next.js 14 App Router with wagmi and viem, injected wallets only. Reads go through `getStrategies`, `getStrategy` and `getHistory` (one call per page) polled every 6 seconds. The deploy script writes `frontend/src/config/deployment.json`; pool definitions in `src/config/pools.ts` mirror `script/Config.sol`.

## Security notes

- **Same-block price guard.** On the first swap of each block the hook stores the tick the block started at. `sculpt`, `cast`, `deposit`, `rebalance`, `recenter` and a third-party `retire` revert with `PriceMoved` if the tick is more than `MAX_TICK_DEVIATION` (200) away from it. The alpha fee is skipped instead of reverting, so `withdraw` always works. This blocks flash-loan style manipulation; a price held across blocks pays arbitrage and is not caught.
- Spot pricing is still the main open risk beyond that. Next: a TWAP from an oracle hook or the pool's own observations.
- Vault rebalance swaps go through the vault's own pool with a price limit of `MAX_SWAP_TICKS` (100) from spot; whatever does not fill stays idle. The `maxTickMove` clamp and cooldown also limit sandwiching around a permissionless recenter.
- State-changing vault functions carry a transient-storage reentrancy lock on top of PoolManager's own unlock lock.
- Pools with native ETH are not registered (custody uses ERC-20 transfers). Any ERC-20 pool initialised with this hook is registered; the app only lists the configured pools.
- Only `afterInitialize` and `afterSwap` are implemented. The other `IHooks` functions are not, which keeps the contract under the 24 KB limit; their permission bits are off, so the PoolManager never calls them.
- Test tokens and the faucet are for testnet only.
