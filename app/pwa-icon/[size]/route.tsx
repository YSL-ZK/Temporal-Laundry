import { ImageResponse } from "next/og";

const iconSizes = new Set([192, 512]);

export async function GET(_request: Request, context: { params: Promise<{ size: string }> }) {
  const requestedSize = Number((await context.params).size);
  if (!iconSizes.has(requestedSize)) return new Response("Not found", { status: 404 });

  return new ImageResponse(
    <div style={{ position: "relative", display: "flex", width: "100%", height: "100%", alignItems: "center", justifyContent: "center", overflow: "hidden", background: "#071117" }}>
      <div style={{ position: "absolute", display: "flex", width: "76%", height: "31%", border: "2px solid rgba(184,245,210,.2)", borderRadius: "50%", transform: "rotate(-18deg)" }} />
      <div style={{ position: "absolute", display: "flex", width: "56%", height: "56%", border: "2px solid rgba(158,176,255,.2)", borderRadius: "50%" }} />
      <div style={{ display: "flex", width: "52%", height: "52%", alignItems: "center", justifyContent: "center", border: "2px solid rgba(255,255,255,.35)", borderRadius: "30%", background: "#b8f5d2", boxShadow: "0 24px 70px rgba(80,220,150,.28)", color: "#09291d", fontSize: requestedSize * 0.31, fontWeight: 800, letterSpacing: "-0.08em" }}>L</div>
    </div>,
    { width: requestedSize, height: requestedSize, headers: { "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800" } },
  );
}
