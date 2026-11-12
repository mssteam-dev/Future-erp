import { NextRequest } from "next/server";
import { queryAs, requirePermission } from "@/lib/auth";

/** صورة المنتج — تُقرأ من قاعدة البيانات وتُخزَّن مؤقتًا في المتصفح */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  await requirePermission("products.view");
  const { id } = await params;

  const rows = await queryAs<{ image: Buffer | null; image_mime: string | null; image_updated_at: string | null }>(
    "select image, image_mime, image_updated_at from products where id = $1",
    [id],
  );

  const row = rows[0];
  if (!row?.image) return new Response("لا توجد صورة", { status: 404 });

  return new Response(new Uint8Array(row.image), {
    headers: {
      "Content-Type": row.image_mime ?? "image/jpeg",
      "Cache-Control": "private, max-age=3600, must-revalidate",
      ETag: `"${row.image_updated_at ?? id}"`,
    },
  });
}
