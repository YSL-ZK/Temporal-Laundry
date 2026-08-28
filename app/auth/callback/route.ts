import { NextResponse } from "next/server";
import { createAdminClient } from "../../../lib/supabase/admin";
import { createClient } from "../../../lib/supabase/server";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const invitationId = searchParams.get("invite");
  const requestedNext = searchParams.get("next");
  const next = requestedNext?.startsWith("/") && !requestedNext.startsWith("//") ? requestedNext : "/";
  const appUrl = process.env.APP_URL;

  if (!appUrl) {
    return new NextResponse("Server configuration error", { status: 500 });
  }

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      if (invitationId) {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return NextResponse.redirect(new URL("/login?error=invitation_failed", appUrl));
        const { error: inviteError } = await createAdminClient().rpc("accept_household_invitation", { actor_id: user.id, invitation_id: invitationId });
        if (inviteError) return NextResponse.redirect(new URL("/login?error=invitation_failed", appUrl));
      }
      return NextResponse.redirect(new URL(next, appUrl));
    }
  }

  return NextResponse.redirect(new URL("/login?error=confirmation_failed", appUrl));
}
