import type { MetadataRoute } from "next";
import { SITE_DESCRIPTION, SITE_NAME } from "../lib/site";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: SITE_NAME,
    short_name: SITE_NAME,
    description: SITE_DESCRIPTION,
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#071117",
    theme_color: "#071117",
    orientation: "any",
    lang: "en",
    categories: ["finance", "productivity", "utilities"],
    icons: [
      { src: "/pwa-icon/192?v=orbit-ledger-2", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/pwa-icon/512?v=orbit-ledger-2", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/pwa-icon/512?v=orbit-ledger-maskable-2", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
