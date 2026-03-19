"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Landmark } from "lucide-react";
import { WalletButton } from "./WalletButton";

const WebProviders = dynamic(
  () => import("../lib/wagmi").then((m) => m.WebProviders),
  { ssr: false },
);

function TopNav() {
  const pathname = usePathname();

  const isActive = (href: string) => {
    if (!pathname) return false;
    if (href === "/") return pathname === "/";
    return pathname.startsWith(href);
  };

  const navItems = [
    { href: "/", label: "Browse" },
    { href: "/leaderboard", label: "Leaderboard" },
    { href: "/portfolio", label: "Portfolio" },
    { href: "/analytics", label: "Analytics" },
    { href: "/agents", label: "Agents Doc" },
  ];

  return (
    <header
      className="fixed top-0 w-full z-50 flex items-center justify-between px-6 py-4"
      style={{
        backgroundColor: "rgba(252, 249, 243, 0.80)",
        backdropFilter: "blur(16px)",
        WebkitBackdropFilter: "blur(16px)",
        boxShadow: "0 20px 40px rgba(28, 28, 24, 0.06)",
      }}
    >
      {/* Logo + Nav */}
      <div className="flex items-center gap-8">
        <Link
          href="/"
          className="flex items-center gap-2.5 no-underline"
        >
          <Landmark className="w-6 h-6" strokeWidth={2.5} style={{ color: "#111519" }} />
          <span
            className="font-display font-bold tracking-tight"
            style={{ color: "#111519", fontSize: "1.25rem", letterSpacing: "-0.03em" }}
          >
            Agora
          </span>
        </Link>
        <nav className="flex items-center gap-6">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="text-sm font-medium no-underline transition-all duration-200"
              style={{
                color: "#111519",
                opacity: isActive(item.href) ? 1 : 0.5,
                borderBottom: isActive(item.href) ? "2px solid #111519" : "2px solid transparent",
                paddingBottom: "2px",
              }}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </div>

      {/* Connect */}
      <WalletButton
        className="inline-flex items-center justify-center gap-2 px-5 py-2 text-sm font-medium rounded-lg transition-all duration-200 hover:opacity-90 bg-[#111519] text-white"
        connectLabel="Connect"
      />
    </header>
  );
}

export function ClientLayout({ children }: { children: React.ReactNode }) {
  return (
    <WebProviders>
      <div className="min-h-screen flex flex-col font-sans" style={{ backgroundColor: "#fcf9f3", color: "#111519" }}>
        <TopNav />
        <main className="flex-1 w-full max-w-7xl mx-auto px-6 py-10 pt-24">
          {children}
        </main>
      </div>
    </WebProviders>
  );
}
