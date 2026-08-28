import Link from "next/link";

export default function NotFound() {
  return <main className="system-page"><section className="system-card"><div className="system-mark" aria-hidden="true">L</div><p className="eyebrow">OUT OF ORBIT · 404</p><h1>This page is not in the ledger.</h1><p>The address may have changed, or the page may no longer exist.</p><Link href="/">Return to Laundry</Link></section></main>;
}
