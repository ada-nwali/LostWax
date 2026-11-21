import { encodeAbiParameters, keccak256, type Address } from "viem";
import deployment from "./deployment.json";

// Mirrors contracts/script/Config.sol.
export type TokenSymbol = keyof typeof deployment.tokens;

export interface PoolConfig {
  id: string;
  base: TokenSymbol;
  quote: TokenSymbol;
  label: string;
  baseLabel: string;
  quoteLabel: string;
  fee: number;
  spacing: number;
  maxTickMove: number;
}

export const POOLS: PoolConfig[] = [
  { id: "weth-usdc", base: "tWETH", quote: "tUSDC", label: "ETH / USDC", baseLabel: "ETH", quoteLabel: "USDC", fee: 3000, spacing: 60, maxTickMove: 600 },
  { id: "wbtc-usdc", base: "tWBTC", quote: "tUSDC", label: "WBTC / USDC", baseLabel: "WBTC", quoteLabel: "USDC", fee: 3000, spacing: 60, maxTickMove: 600 },
  { id: "uni-usdc", base: "tUNI", quote: "tUSDC", label: "UNI / USDC", baseLabel: "UNI", quoteLabel: "USDC", fee: 3000, spacing: 60, maxTickMove: 600 },
  { id: "usdc-usdt", base: "tUSDC", quote: "tUSDT", label: "USDC / USDT", baseLabel: "USDC", quoteLabel: "USDT", fee: 500, spacing: 10, maxTickMove: 40 },
];

export const HOOK = deployment.hook as Address;
export const FAUCET = deployment.faucet as Address;
export const SWAP_ROUTER = deployment.swapRouter as Address;
export const TRIAL_DURATION = deployment.trialDuration;
export const IS_DEPLOYED = HOOK !== "0x0000000000000000000000000000000000000000";

export const tokenAddress = (s: TokenSymbol) => deployment.tokens[s] as Address;

export interface PoolKey {
  currency0: Address;
  currency1: Address;
  fee: number;
  tickSpacing: number;
  hooks: Address;
}

export function baseIsToken0(p: PoolConfig) {
  return BigInt(tokenAddress(p.base)) < BigInt(tokenAddress(p.quote));
}

export function poolKey(p: PoolConfig): PoolKey {
  const [c0, c1] = baseIsToken0(p) ? [tokenAddress(p.base), tokenAddress(p.quote)] : [tokenAddress(p.quote), tokenAddress(p.base)];
  return { currency0: c0, currency1: c1, fee: p.fee, tickSpacing: p.spacing, hooks: HOOK };
}

export function poolForKey(key: { currency0: string; currency1: string; fee: number }) {
  const a = key.currency0.toLowerCase();
  const b = key.currency1.toLowerCase();
  return POOLS.find((p) => {
    const k = poolKey(p);
    return k.currency0.toLowerCase() === a && k.currency1.toLowerCase() === b && k.fee === key.fee;
  });
}

/** keccak256(abi.encode(PoolKey)), same as PoolIdLibrary.toId */
export function poolId(p: PoolConfig) {
  const k = poolKey(p);
  return keccak256(
    encodeAbiParameters(
      [{ type: "address" }, { type: "address" }, { type: "uint24" }, { type: "int24" }, { type: "address" }],
      [k.currency0, k.currency1, k.fee, k.tickSpacing, k.hooks],
    ),
  );
}
