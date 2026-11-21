import type { Abi, Address } from "viem";
import hookJson from "@/abi/lostWaxHook.json";
import faucetJson from "@/abi/faucet.json";
import erc20Json from "@/abi/erc20.json";
import swapJson from "@/abi/swapRouter.json";
import type { PoolKey } from "@/config/pools";

export const hookAbi = hookJson as Abi;
export const faucetAbi = faucetJson as Abi;
export const erc20Abi = erc20Json as Abi;
export const swapRouterAbi = swapJson as Abi;

export enum Stage {
  None = 0,
  Wax = 1,
  Bronze = 2,
  Retired = 3,
}

export enum Rule {
  OutOfRange = 0,
  Edge80 = 1,
  Manual = 2,
}

export const RULE_LABEL: Record<Rule, string> = {
  [Rule.OutOfRange]: "Recenter when price leaves the range",
  [Rule.Edge80]: "Recenter at 80% of the range",
  [Rule.Manual]: "Manual only",
};

export interface Mandate {
  rule: number;
  cooldown: number;
  maxTickMove: number;
  alphaFeeBps: number;
}

// Mirrors ILostWax.StrategyView
export interface StrategyView {
  id: bigint;
  name: string;
  curator: Address;
  stage: number;
  key: PoolKey;
  mandate: Mandate;
  tickLower: number;
  tickUpper: number;
  currentTick: number;
  sqrtPriceX96: bigint;
  createdAt: bigint;
  trialEndsAt: bigint;
  castAt: bigint;
  lastRebalance: bigint;
  strategyIndex: bigint;
  benchIndex: bigint;
  alphaBps: bigint;
  trialAlphaBps: bigint;
  qualified: boolean;
  canRecenter: boolean;
  liquidity: bigint;
  totalShares: bigint;
  tvl: bigint;
  pendingFee: bigint;
}

export interface Snapshot {
  time: number;
  strategyIndex: bigint;
  benchIndex: bigint;
  rebalanced: boolean;
}
