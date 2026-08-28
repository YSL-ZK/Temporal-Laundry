import type { Metadata } from "next";

export const metadata: Metadata = { title: "Set Up Your Household", robots: { index: false, follow: false } };

export default function OnboardingLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
