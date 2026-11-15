import { withAdmin } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * ما يقرؤه الموقع الإلكتروني العام: المنيو الظاهر والفروع الظاهرة فقط.
 * بلا تسجيل دخول لأنه المحتوى نفسه المنشور للزوار، ولا يُعاد منه غير ذلك.
 * التخزين المؤقت على الشبكة يجعل قاعدة البيانات تُسأل مرتين في الدقيقة على الأكثر.
 */
export async function GET() {
  try {
    const content = await withAdmin(async (client) => {
      const { rows } = await client.query("select site_public_content() as content");
      return rows[0].content;
    });
    return Response.json(content, {
      headers: {
        "Cache-Control": "public, max-age=0, s-maxage=30, stale-while-revalidate=300",
      },
    });
  } catch {
    return Response.json(
      { error: "unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
