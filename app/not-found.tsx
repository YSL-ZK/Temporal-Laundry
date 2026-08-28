import Link from "next/link";
import LaundryMark from "./laundry-mark";

export default function NotFound() {
  return <main className="system-page"><section className="system-card"><LaundryMark className="system-mark" /><p className="eyebrow">OUT OF ORBIT · 404</p><h1>This page is not in the ledger.</h1><p>The address may have changed, or the page may no longer exist.</p><Link href="/">Return to Laundry</Link></section></main>;
}
