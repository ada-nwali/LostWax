"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAccount, useConnect, useDisconnect, useSwitchChain } from "wagmi";
import { chain } from "@/lib/wagmi";
import { shortAddr } from "@/lib/market";
import { IS_DEPLOYED } from "@/config/pools";

export function Logo() {
  return (
    <svg aria-hidden="true" width="28" height="28" viewBox="0 0 28 28" fill="none">
      <path d="M14 3c4 5 7 8.5 7 13a7 7 0 0 1-14 0c0-4.5 3-8 7-13z" fill="#D9A441" />
      <path d="M11 17a3 3 0 0 0 3 3" stroke="#0E0B08" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

const LINKS = [
  { href: "/foundry", label: "Foundry", match: ["/foundry", "/strategy"] },
  { href: "/studio", label: "Studio", match: ["/studio"] },
  { href: "/portfolio", label: "Portfolio", match: ["/portfolio"] },
];

export function Header() {
  const path = usePathname();
  return (
    <>
      {!IS_DEPLOYED && (
        <div className="banner">
          Contracts not deployed yet. Run the deploy script in <code>contracts/</code> to wire this app to Unichain Sepolia.
        </div>
      )}
      <header className="header">
        <div className="container header-inner">
          <Link href="/" className="brand">
            <Logo />
            LostWax
          </Link>
          <nav className="nav" aria-label="Main">
            {LINKS.map((l) => (
              <Link key={l.href} href={l.href} className={l.match.some((m) => path.startsWith(m)) ? "active" : ""}>
                {l.label}
              </Link>
            ))}
          </nav>
          <div className="header-right">
            <NetworkPill />
            <ConnectButton />
          </div>
        </div>
      </header>
    </>
  );
}

function NetworkPill() {
  const { chainId, isConnected } = useAccount();
  const wrong = isConnected && chainId !== chain.id;
  return (
    <span className="pill">
      <span className={`dot${wrong ? " off" : ""}`} />
      {wrong ? "Wrong network" : "Unichain Sepolia"}
    </span>
  );
}

export function ConnectButton({ large }: { large?: boolean }) {
  const { address, isConnected, chainId } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain } = useSwitchChain();
  const cls = `btn${large ? " btn-lg btn-block" : ""}`;

  if (!isConnected) {
    return (
      <button className={`${cls} btn-primary`} onClick={() => connect({ connector: connectors[0] })} disabled={isPending}>
        {isPending ? "Connecting…" : "Connect wallet"}
      </button>
    );
  }
  if (chainId !== chain.id) {
    return (
      <button className={`${cls} btn-primary`} onClick={() => switchChain({ chainId: chain.id })}>
        Switch to Unichain Sepolia
      </button>
    );
  }
  if (large) return null;
  return (
    <button className="btn btn-outline" onClick={() => disconnect()} title="Disconnect">
      {shortAddr(address!)}
    </button>
  );
}
