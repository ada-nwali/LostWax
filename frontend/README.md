# LostWax frontend

Next.js 14 (App Router), wagmi 2, viem 2. Injected wallets only, Unichain Sepolia only.

```bash
npm install
npm run dev
```

| Route | What |
|---|---|
| `/` | Landing |
| `/foundry` | All strategies, filter bronze / wax |
| `/strategy/[id]` | Record vs lazy LP, mandate, deposit / withdraw, cast, recenter, curator controls |
| `/studio` | Sculpt a wax model, your trials, cast |
| `/portfolio` | Positions, curator alpha fee, faucet, test swap |

Contract addresses come from `src/config/deployment.json`, written by `make deploy` in `../contracts`. ABIs live in `src/abi/`. Pools in `src/config/pools.ts` must match `contracts/script/Config.sol`.
