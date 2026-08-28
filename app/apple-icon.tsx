import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    <div style={{ display: "flex", width: "100%", height: "100%", alignItems: "center", justifyContent: "center", borderRadius: "42px", background: "#071117" }}>
      <div style={{ display: "flex", width: "112px", height: "112px", alignItems: "center", justifyContent: "center", borderRadius: "34px", background: "#b8f5d2", color: "#09291d", fontSize: 82, fontWeight: 800, letterSpacing: "-0.08em" }}>L</div>
    </div>,
    size,
  );
}
