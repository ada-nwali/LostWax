import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Providers } from "./providers";
import { Header } from "@/components/Header";
import "./globals.css";

export const metadata: Metadata = {
  title: "LostWax · Proven before funded",
  description: "Curated liquidity where managers prove a strategy before anyone funds it, and earn only when they beat a passive LP.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@500;600;700&family=Inter:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
      </head>
      <body>
        <Providers>
          <Header />
          <main>{children}</main>
          <footer style={{ borderTop: "1px solid var(--line)" }}>
            <div className="container" style={{ padding: "32px", display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: 12, fontSize: 14, color: "var(--faint)" }}>
              <span>LostWax · testnet build on Unichain Sepolia</span>
              <span>Built for the UHI11 Hookathon</span>
            </div>
          </footer>
        </Providers>
      </body>
    </html>
  );
}
