export const RECEIPT_MIME_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"] as const;
export type ReceiptMimeType = (typeof RECEIPT_MIME_TYPES)[number];

const startsWith = (bytes: Uint8Array, signature: number[]) => signature.every((value, index) => bytes[index] === value);

export function detectReceiptMime(bytes: Uint8Array): ReceiptMimeType | null {
  if (bytes.length >= 4 && startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (bytes.length >= 8 && startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (bytes.length >= 12 && startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes.slice(8), [0x57, 0x45, 0x42, 0x50])) return "image/webp";
  if (bytes.length >= 5 && startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return "application/pdf";
  return null;
}

export function receiptExtension(mime: ReceiptMimeType) {
  if (mime === "image/jpeg") return "jpg";
  if (mime === "application/pdf") return "pdf";
  return mime.split("/")[1];
}

export function safeReceiptFilename(value: string, fallback = "receipt") {
  const normalized = value.trim().replace(/[\u0000-\u001f\u007f/\\]+/gu, "_").slice(0, 180);
  return normalized || fallback;
}

export function formatFileSize(bytes: number, locale = "en-US") {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 KB";
  if (bytes < 1_048_576) return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(bytes / 1024)} KB`;
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(bytes / 1_048_576)} MB`;
}
