import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "You’re Offline", robots: { index: false, follow: false } };

export default function OfflinePage() {
  return <main className="system-page"><section className="system-card"><div className="system-mark" aria-hidden="true">L</div><p className="eyebrow">CONNECTION PAUSED</p><h1>Your ledger is still private.</h1><p>Laundry could not reach the network. Reconnect before viewing or changing household finance data.</p><Link href="/">Try Again</Link></section></main>;
}
