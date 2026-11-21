// injected comes from the main entry; wagmi/connectors drags in every SDK
import { createConfig, http, injected } from "wagmi";
import { unichainSepolia } from "viem/chains";

export const chain = unichainSepolia;

export const wagmiConfig = createConfig({
  chains: [unichainSepolia],
  connectors: [injected()],
  transports: {
    [unichainSepolia.id]: http(process.env.NEXT_PUBLIC_RPC_URL || "https://sepolia.unichain.org"),
  },
  ssr: true,
});

export const explorerTx = (hash: string) => `${unichainSepolia.blockExplorers.default.url}/tx/${hash}`;
