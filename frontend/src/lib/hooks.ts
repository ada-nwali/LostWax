"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAccount, useConfig, useReadContract, useReadContracts, useWriteContract } from "wagmi";
import { waitForTransactionReceipt } from "wagmi/actions";
import { BaseError, ContractFunctionRevertedError, maxUint256, type Abi, type Address } from "viem";
import { erc20Abi, hookAbi, type Snapshot, type StrategyView } from "./contracts";
import { HOOK, IS_DEPLOYED, poolForKey, baseIsToken0 } from "@/config/pools";
import { price01, token1ToQuote, wei } from "./market";
import { useToast } from "@/components/Toast";

const POLL = 6_000;

/** Hook custom errors in plain words. */
const REVERT_TEXT: Record<string, string> = {
  PriceMoved: "The price moved sharply in this block. Wait a few seconds and try again.",
  Slippage: "Price changed before your transaction landed. Try again.",
  Cooldown: "The mandate cooldown has not passed yet.",
  NotTriggered: "The rebalance rule has not fired.",
  TrialRunning: "The trial is still running.",
  NotQualified: "This model is not ahead of the lazy LP.",
  NotCurator: "Only the curator can do this.",
  WrongStage: "This strategy is not in the right stage for that.",
  MoveTooLarge: "That range move is larger than the mandate allows.",
  BadRange: "That price range is not valid for this pool.",
  BadMandate: "Check the name (1 to 32 characters) and mandate.",
  TooManyStrategies: "This pool already has the maximum number of wax trials.",
  UnknownPool: "This pool is not registered with LostWax.",
  ZeroAmount: "Enter an amount.",
};

function errorText(e: unknown) {
  if (e instanceof BaseError) {
    const revert = e.walk((x) => x instanceof ContractFunctionRevertedError);
    const name = revert instanceof ContractFunctionRevertedError ? revert.data?.errorName : undefined;
    if (name && REVERT_TEXT[name]) return REVERT_TEXT[name];
    return e.shortMessage;
  }
  return (e as Error).message ?? "Transaction failed";
}

export function useNow(intervalMs = 15_000) {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

export function useStrategies() {
  const q = useReadContract({
    address: HOOK,
    abi: hookAbi,
    functionName: "getStrategies",
    args: [0n, 200n],
    query: { enabled: IS_DEPLOYED, refetchInterval: POLL },
  });
  return { ...q, strategies: (q.data as StrategyView[] | undefined) ?? [] };
}

export function useStrategy(id: bigint) {
  const q = useReadContract({
    address: HOOK,
    abi: hookAbi,
    functionName: "getStrategy",
    args: [id],
    query: { enabled: IS_DEPLOYED, refetchInterval: POLL },
  });
  return { ...q, strategy: q.data as StrategyView | undefined };
}

export function useHistory(id: bigint) {
  const q = useReadContract({
    address: HOOK,
    abi: hookAbi,
    functionName: "getHistory",
    args: [id],
    query: { enabled: IS_DEPLOYED, refetchInterval: POLL },
  });
  return (q.data as Snapshot[] | undefined) ?? [];
}

/** shares and cost basis for the connected wallet, per strategy */
export function usePositions(ids: bigint[]) {
  const { address } = useAccount();
  const contracts = useMemo(
    () =>
      address
        ? ids.flatMap((id) => [
            { address: HOOK, abi: hookAbi, functionName: "sharesOf", args: [id, address] },
            { address: HOOK, abi: hookAbi, functionName: "costBasis", args: [id, address] },
          ])
        : [],
    [address, ids],
  );
  const q = useReadContracts({ contracts, query: { enabled: !!address && IS_DEPLOYED, refetchInterval: POLL } });
  const map = new Map<string, { shares: bigint; cost: bigint }>();
  ids.forEach((id, i) => {
    const shares = (q.data?.[i * 2]?.result as bigint | undefined) ?? 0n;
    const cost = (q.data?.[i * 2 + 1]?.result as bigint | undefined) ?? 0n;
    map.set(id.toString(), { shares, cost });
  });
  return { positions: map, refetch: q.refetch };
}

/** pool metadata + prices for a strategy */
export function useMarket(s?: StrategyView) {
  return useMemo(() => {
    if (!s) return undefined;
    const pool = poolForKey(s.key);
    if (!pool) return undefined;
    const b0 = baseIsToken0(pool);
    const p01 = price01(s.sqrtPriceX96);
    const toQuote = (v1: bigint) => token1ToQuote(wei(v1), p01, b0);
    return { pool, baseIs0: b0, p01, toQuote };
  }, [s]);
}

type Write = { address: Address; abi: Abi; functionName: string; args?: readonly unknown[] };

/** write + wait + toast, one call */
export function useTx() {
  const config = useConfig();
  const { writeContractAsync } = useWriteContract();
  const toast = useToast();
  const [pending, setPending] = useState<string | null>(null);

  const send = useCallback(
    async (label: string, req: Write) => {
      setPending(label);
      try {
        const hash = await writeContractAsync(req as Parameters<typeof writeContractAsync>[0]);
        const receipt = await waitForTransactionReceipt(config, { hash });
        if (receipt.status !== "success") throw new Error("Transaction reverted");
        toast.show({ text: `${label} confirmed`, hash });
        return receipt;
      } catch (e) {
        toast.show({ text: errorText(e).split("\n")[0], error: true });
        throw e;
      } finally {
        setPending(null);
      }
    },
    [config, writeContractAsync, toast],
  );

  return { send, pending };
}

/** approve max if the allowance is short */
export function useApprove() {
  const config = useConfig();
  const { address } = useAccount();
  const { send } = useTx();
  return useCallback(
    async (token: Address, spender: Address, amount: bigint, label: string) => {
      if (!address || amount === 0n) return;
      const { readContract } = await import("wagmi/actions");
      const allowance = (await readContract(config, {
        address: token,
        abi: erc20Abi,
        functionName: "allowance",
        args: [address, spender],
      })) as bigint;
      if (allowance >= amount) return;
      await send(`Approve ${label}`, { address: token, abi: erc20Abi, functionName: "approve", args: [spender, maxUint256] });
    },
    [address, config, send],
  );
}
