import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./dashboard.css";

export const metadata: Metadata = {
  title: "Ledgerly | Household finance",
  description: "A shared, multi-currency personal finance workspace.",
};

export const viewport: Viewport = { themeColor: "#071117", colorScheme: "dark" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
