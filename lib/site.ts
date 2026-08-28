export const SITE_NAME = "Laundry";
export const SITE_DESCRIPTION = "Private and shared household finance, organized around a secure transaction ledger.";

const fallbackUrl = "https://ysl-laundry.vercel.app";

export const SITE_URL = (() => {
  try {
    return new URL(process.env.APP_URL?.trim() || fallbackUrl).origin;
  } catch {
    return fallbackUrl;
  }
})();
