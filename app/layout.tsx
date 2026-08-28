import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./dashboard.css";
import "./auth.css";
import PwaRegister from "./pwa-register";
import { SITE_DESCRIPTION, SITE_NAME, SITE_URL } from "../lib/site";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  applicationName: SITE_NAME,
  title: { default: `${SITE_NAME} — Household Finance`, template: `%s · ${SITE_NAME}` },
  description: SITE_DESCRIPTION,
  keywords: ["household finance", "shared budget", "expense tracker", "personal finance", "shopping list", "debt payoff", "multi-currency ledger"],
  authors: [{ name: "Alejandro Osorno" }],
  creator: "Alejandro Osorno",
  category: "finance",
  manifest: "/manifest.webmanifest",
  openGraph: { type: "website", locale: "en_US", url: SITE_URL, siteName: SITE_NAME, title: `${SITE_NAME} — Household Finance`, description: SITE_DESCRIPTION },
  twitter: { card: "summary_large_image", title: `${SITE_NAME} — Household Finance`, description: SITE_DESCRIPTION },
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: SITE_NAME },
  formatDetection: { telephone: false, address: false, email: false },
};

export const viewport: Viewport = { themeColor: "#071117", colorScheme: "dark" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body><PwaRegister />{children}</body>
    </html>
  );
}
