import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const { data: token } = await supabase.auth.getClaims();
  const signedIn = Boolean(token?.claims.sub);
  const pathname = request.nextUrl.pathname;
  const isLogin = pathname === "/login";
  const isOnboarding = pathname === "/onboarding";
  const isAuthCallback = pathname === "/auth/callback";
  const isPublicAsset = pathname === "/sw.js" || pathname === "/manifest.webmanifest" || pathname === "/robots.txt" || pathname === "/sitemap.xml" || pathname === "/icon" || pathname === "/apple-icon" || pathname === "/opengraph-image" || pathname.startsWith("/pwa-icon/");
  const isOffline = pathname === "/offline";

  // The confirmation-code exchange must be reachable before a session exists.
  if (isAuthCallback || isPublicAsset || isOffline) return response;

  if (!signedIn && !isLogin) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  if (!signedIn || isLogin) {
    if (signedIn && isLogin) {
      const url = request.nextUrl.clone();
      url.pathname = "/";
      url.search = "";
      return NextResponse.redirect(url);
    }
    return response;
  }

  const { data: membership, error } = await supabase
    .from("household_members")
    .select("household_id")
    .limit(1)
    .maybeSingle();

  // Before migrations are applied, leave routing alone so the app can show a useful error.
  if (!error && !membership && !isOnboarding) {
    const url = request.nextUrl.clone();
    url.pathname = "/onboarding";
    url.search = "";
    return NextResponse.redirect(url);
  }

  if (!error && membership && isOnboarding) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  return response;
}
