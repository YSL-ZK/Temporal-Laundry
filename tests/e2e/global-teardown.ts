import { rm } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import { AUTH_STATE_PATH, E2E_EMAIL, requireLocalUrl } from "./support";

export default async function globalTeardown() {
  const supabaseUrl = requireLocalUrl(process.env.NEXT_PUBLIC_SUPABASE_URL, "NEXT_PUBLIC_SUPABASE_URL");
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required for full-stack browser tests.");
  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const users = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (!users.error) {
    for (const user of users.data.users.filter((candidate) => candidate.email === E2E_EMAIL)) {
      const memberships = await admin.from("household_members").select("household_id").eq("user_id", user.id);
      for (const membership of memberships.data ?? []) await admin.from("households").delete().eq("id", membership.household_id);
      await admin.auth.admin.deleteUser(user.id);
    }
  }
  await rm(AUTH_STATE_PATH, { force: true });
}
