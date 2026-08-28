import { redirect } from "next/navigation";
import { loadDashboard } from "../lib/dashboard";
import DashboardClient from "./dashboard-client";

export default async function Home() {
  const data = await loadDashboard();
  if (!data) redirect("/login");
  if (!data.household) redirect("/onboarding");
  return <DashboardClient data={data} />;
}
