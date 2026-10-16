import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Battery Planner",
  description: "Battery charge/discharge plans against GB power prices, with approval and settled P&L.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full bg-background text-foreground">
        <header className="border-b">
          <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
            <Link href="/" className="font-semibold">⚡ Battery Planner</Link>
            <span className="hidden text-xs text-muted-foreground sm:inline">Buy electricity cheap, sell it when it’s worth more</span>
          </div>
        </header>
        <main className="mx-auto max-w-5xl px-4 py-6">
          <Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>{children}</Suspense>
        </main>
      </body>
    </html>
  );
}
