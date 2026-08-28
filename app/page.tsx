import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { loadDashboard } from "../lib/dashboard";
import DashboardClient from "./dashboard-client";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function Home() {
  const data = await loadDashboard();
  if (!data) redirect("/login");
  if (!data.household) redirect("/onboarding");
  return <DashboardClient data={data} />;
}
