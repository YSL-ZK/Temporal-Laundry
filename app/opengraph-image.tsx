import { ImageResponse } from "next/og";
import { LaundryMarkSvg } from "./laundry-mark";

export const alt = "Laundry household finance workspace";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    <div style={{ position: "relative", display: "flex", width: "100%", height: "100%", alignItems: "center", overflow: "hidden", padding: "72px 84px", background: "#071117", color: "#f1f7f5" }}>
      <div style={{ position: "absolute", right: -80, bottom: -180, display: "flex", width: 620, height: 620, borderRadius: "50%", background: "#193742" }} />
      <div style={{ position: "absolute", right: 90, top: 110, display: "flex", width: 340, height: 130, border: "2px solid rgba(184,245,210,.22)", borderRadius: "50%", transform: "rotate(-18deg)" }} />
      <div style={{ position: "absolute", right: 185, top: 175, display: "flex", width: 170, height: 170, alignItems: "center", justifyContent: "center", borderRadius: "52px", background: "#b8f5d2", color: "#09291d" }}><LaundryMarkSvg style={{ width: 142, height: 142 }} /></div>
      <div style={{ display: "flex", width: 700, flexDirection: "column" }}>
        <div style={{ display: "flex", color: "#79dfa9", fontSize: 22, fontWeight: 700, letterSpacing: ".16em" }}>LAUNDRY · HOUSEHOLD FINANCE</div>
        <div style={{ display: "flex", marginTop: 26, fontSize: 76, fontWeight: 700, lineHeight: 1.02, letterSpacing: "-.06em" }}>Money moves better together.</div>
        <div style={{ display: "flex", marginTop: 26, color: "#afc0c0", fontSize: 28, lineHeight: 1.4 }}>Accounts, plans, shopping, and shared decisions—organized on one private ledger.</div>
      </div>
    </div>,
    size,
  );
}
