import type { ReactNode } from "react";
import Link from "next/link";

import "./globals.css";

export const metadata = {
  title: "$DRAW",
  description: "Creator fees fill a prize pot. One eligible buyer wins each window.",
};

function NavLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="text-sm tracking-wide text-muted hover:text-ink">
      {children}
    </Link>
  );
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="font-serif antialiased">
        <div className="mx-auto flex min-h-screen max-w-3xl flex-col px-6 py-8">
          <header className="flex items-baseline justify-between border-b border-line pb-4">
            <Link href="/" className="text-xl tracking-tight">
              $DRAW
            </Link>
            <nav className="flex gap-5">
              <NavLink href="/">Home</NavLink>
              <NavLink href="/check">Check</NavLink>
              <NavLink href="/winners">Winners</NavLink>
            </nav>
          </header>
          <main className="flex-1 py-10">{children}</main>
          <footer className="border-t border-line pt-4 text-xs text-muted">
            Eligibility is decided off-chain. The entrant list is published before randomness is requested.
          </footer>
        </div>
      </body>
    </html>
  );
}
