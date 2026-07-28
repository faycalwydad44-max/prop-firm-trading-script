import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "PropTrader Pro | Prop Firm Challenge Manager",
  description: "Professional trading signal generator & prop firm challenge manager for XAUUSD, NASDAQ & US30",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fr">
      <body className="antialiased min-h-screen">{children}</body>
    </html>
  );
}
