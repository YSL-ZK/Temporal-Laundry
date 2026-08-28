import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Sign In",
  alternates: { canonical: "/login" },
  robots: { index: true, follow: true },
};

export default function LoginLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
