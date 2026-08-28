import { ImageResponse } from "next/og";
import { LaundryMarkSvg } from "./laundry-mark";

export const size = { width: 64, height: 64 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    <div style={{ display: "flex", width: "100%", height: "100%", alignItems: "center", justifyContent: "center", borderRadius: "18px", background: "#071117" }}>
      <div style={{ display: "flex", width: "42px", height: "42px", alignItems: "center", justifyContent: "center", borderRadius: "14px", background: "#b8f5d2", color: "#09291d" }}><LaundryMarkSvg style={{ width: 35, height: 35 }} /></div>
    </div>,
    size,
  );
}
