import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Dispatch Planner",
  description: "Battery charge/discharge plans against GB power prices, with approval and settled P&L.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full bg-background text-foreground">
        <header className="border-b">
          <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
            <Link href="/" className="font-semibold">⚡ Dispatch Planner</Link>
            <span className="text-xs text-muted-foreground">GB wholesale · Elexon MID prices</span>
          </div>
        </header>
        <main className="mx-auto max-w-5xl px-4 py-6">
          <Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>{children}</Suspense>
        </main>
      </body>
    </html>
  );
}
