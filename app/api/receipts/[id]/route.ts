import { createAdminClient } from "../../../../lib/supabase/admin";
import { createClient } from "../../../../lib/supabase/server";
import { safeReceiptFilename } from "../../../../lib/receipts";
import { uuidSchema } from "../../../../lib/validation";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const parsedId = uuidSchema.safeParse((await context.params).id);
  if (!parsedId.success) return new Response("Not found", { status: 404 });

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401, headers: { "Cache-Control": "private, no-store" } });

  const { data: receipt } = await supabase
    .from("receipts")
    .select("storage_path,mime_type,size_bytes,original_filename")
    .eq("id", parsedId.data)
    .single();
  if (!receipt) return new Response("Not found", { status: 404, headers: { "Cache-Control": "private, no-store" } });

  const { data: file, error } = await createAdminClient().storage.from("receipts").download(receipt.storage_path);
  if (error || !file) return new Response("Receipt unavailable", { status: 404, headers: { "Cache-Control": "private, no-store" } });

  const bytes = await file.arrayBuffer();
  const filename = safeReceiptFilename(receipt.original_filename ?? "receipt");
  const asciiFilename = filename.replace(/[^\x20-\x7e]/gu, "_").replace(/["\\]/gu, "_");
  return new Response(bytes, {
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
      "Content-Disposition": `attachment; filename="${asciiFilename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Content-Length": String(bytes.byteLength),
      "Content-Type": receipt.mime_type ?? "application/octet-stream",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
