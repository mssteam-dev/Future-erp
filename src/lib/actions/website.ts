"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { logAudit, nullable, run, str } from "./helpers";
import { WEEKDAYS_AR } from "@/lib/website";

const MENU = "/website/menu";
const BRANCHES = "/website/branches";

function fail(path: string, message: string): never {
  const sep = path.includes("?") ? "&" : "?";
  redirect(`${path}${sep}error=${encodeURIComponent(message)}`);
}

function done(path: string): never {
  revalidatePath(path);
  redirect(`${path}?ok=1`);
}

/** رقم غير سالب، أو null إن كان الحقل فارغًا أو غير صالح */
function amount(formData: FormData, key: string): number | null {
  const raw = str(formData, key);
  if (raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** ترتيب صحيح، أو null إن تُرك الحقل فارغًا ليُحسب تلقائيًا */
function order(formData: FormData, key = "sort_order"): number | null {
  const raw = str(formData, key);
  if (raw === "") return null;
  const n = Number(raw);
  return Number.isInteger(n) ? n : null;
}

// =============================== أقسام المنيو ================================
export async function saveSiteCategory(formData: FormData): Promise<void> {
  const id = nullable(formData, "id");
  const back = id ? `${MENU}?edit=${id}` : MENU;
  const nameAr = str(formData, "name_ar");
  const nameEn = str(formData, "name_en");
  if (!nameAr || !nameEn) fail(back, "أدخل اسم القسم بالعربية والإنجليزية");

  const sort = order(formData);
  const { error } = await run("website.edit", async (client, userId) => {
    if (id) {
      await client.query(
        `update site_menu_categories
            set name_ar = $2, name_en = $3, sort_order = coalesce($4, sort_order), is_visible = $5
          where id = $1`,
        [id, nameAr, nameEn, sort, str(formData, "is_visible") === "on"],
      );
    } else {
      await client.query(
        `insert into site_menu_categories (name_ar, name_en, sort_order)
         values ($1, $2, coalesce($3, (select coalesce(max(sort_order), 0) + 10 from site_menu_categories)))`,
        [nameAr, nameEn, sort],
      );
    }
    await logAudit(client, userId, id ? "update" : "insert", "site_menu_categories", id,
      `قسم في منيو الموقع: ${nameAr}`);
  });

  if (error) fail(back, error);
  done(MENU);
}

export async function deleteSiteCategory(formData: FormData): Promise<void> {
  const id = str(formData, "id");
  const { error } = await run("website.edit", async (client, userId) => {
    const { rows } = await client.query(
      `select c.name_ar, (select count(*) from site_menu_items i where i.category_id = c.id) as items
         from site_menu_categories c where c.id = $1`,
      [id],
    );
    if (!rows[0]) throw new Error("القسم غير موجود");
    if (Number(rows[0].items) > 0) {
      throw new Error("في القسم أصناف. احذف أصنافه أو انقلها إلى قسم آخر أولًا، أو أخفِ القسم بدل حذفه");
    }
    await client.query("delete from site_menu_categories where id = $1", [id]);
    await logAudit(client, userId, "delete", "site_menu_categories", id,
      `حذف قسم من منيو الموقع: ${rows[0].name_ar}`);
  });

  if (error) fail(MENU, error);
  done(MENU);
}

// =============================== أصناف المنيو ================================
export async function saveSiteItem(formData: FormData): Promise<void> {
  const id = nullable(formData, "id");
  const listId = str(formData, "list_id");          // القسم المعروض حاليًا
  const categoryId = str(formData, "category_id");  // القسم الذي يُحفظ فيه الصنف
  const list = `${MENU}/${listId || categoryId}`;
  const back = id ? `${list}?edit=${id}` : list;

  const nameAr = str(formData, "name_ar");
  const nameEn = str(formData, "name_en");
  const price = amount(formData, "price");
  if (!nameAr || !nameEn) fail(back, "أدخل اسم الصنف بالعربية والإنجليزية");
  if (price === null) fail(back, "أدخل سعرًا صحيحًا (رقم غير سالب)");
  if (!categoryId) fail(back, "اختر القسم");

  const sort = order(formData);
  const { error } = await run("website.edit", async (client, userId) => {
    if (id) {
      await client.query(
        `update site_menu_items
            set category_id = $2, name_ar = $3, name_en = $4, price = $5,
                note_ar = $6, note_en = $7, sort_order = coalesce($8, sort_order), is_visible = $9
          where id = $1`,
        [id, categoryId, nameAr, nameEn, price, nullable(formData, "note_ar"),
         nullable(formData, "note_en"), sort, str(formData, "is_visible") === "on"],
      );
    } else {
      await client.query(
        `insert into site_menu_items (category_id, name_ar, name_en, price, note_ar, note_en, sort_order)
         values ($1, $2, $3, $4, $5, $6,
                 coalesce($7, (select coalesce(max(sort_order), 0) + 10
                                 from site_menu_items where category_id = $1)))`,
        [categoryId, nameAr, nameEn, price, nullable(formData, "note_ar"),
         nullable(formData, "note_en"), sort],
      );
    }
    await logAudit(client, userId, id ? "update" : "insert", "site_menu_items", id,
      `صنف في منيو الموقع: ${nameAr} — السعر ${price}`);
  });

  if (error) fail(back, error);
  done(`${MENU}/${categoryId}`);
}

/** تعديل السعر مباشرة من القائمة */
export async function setSiteItemPrice(formData: FormData): Promise<void> {
  const id = str(formData, "id");
  const list = `${MENU}/${str(formData, "list_id")}`;
  const price = amount(formData, "price");
  if (price === null) fail(list, "أدخل سعرًا صحيحًا (رقم غير سالب)");

  const { error } = await run("website.edit", async (client, userId) => {
    const { rows } = await client.query(
      `update site_menu_items i set price = $2
         from (select id, price as old_price from site_menu_items where id = $1) o
        where i.id = o.id
        returning i.name_ar, o.old_price`,
      [id, price],
    );
    if (!rows[0]) throw new Error("الصنف غير موجود");
    await logAudit(client, userId, "update", "site_menu_items", id,
      `سعر ${rows[0].name_ar} في منيو الموقع: من ${Number(rows[0].old_price)} إلى ${price}`);
  });

  if (error) fail(list, error);
  done(list);
}

/** إظهار الصنف في الموقع أو إخفاؤه */
export async function toggleSiteItem(formData: FormData): Promise<void> {
  const id = str(formData, "id");
  const list = `${MENU}/${str(formData, "list_id")}`;

  const { error } = await run("website.edit", async (client, userId) => {
    const { rows } = await client.query(
      `update site_menu_items set is_visible = not is_visible where id = $1
       returning name_ar, is_visible`,
      [id],
    );
    if (!rows[0]) throw new Error("الصنف غير موجود");
    await logAudit(client, userId, "update", "site_menu_items", id,
      `${rows[0].is_visible ? "إظهار" : "إخفاء"} ${rows[0].name_ar} في منيو الموقع`);
  });

  if (error) fail(list, error);
  done(list);
}

export async function deleteSiteItem(formData: FormData): Promise<void> {
  const id = str(formData, "id");
  const list = `${MENU}/${str(formData, "list_id")}`;

  const { error } = await run("website.edit", async (client, userId) => {
    const { rows } = await client.query(
      "delete from site_menu_items where id = $1 returning name_ar",
      [id],
    );
    if (!rows[0]) throw new Error("الصنف غير موجود");
    await logAudit(client, userId, "delete", "site_menu_items", id,
      `حذف ${rows[0].name_ar} من منيو الموقع`);
  });

  if (error) fail(list, error);
  done(list);
}

// ================================ فروع الموقع ================================
function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

type DayHours = { weekday: number; closed: boolean; open: string | null; close: string | null };

/** يقرأ ساعات الأسبوع من النموذج. اليوم المتروك فارغًا لا يُحفظ له صف. */
function readHours(formData: FormData): { days: DayHours[]; error?: string } {
  const days: DayHours[] = [];
  const time = /^([01]\d|2[0-3]):[0-5]\d$/;
  for (let d = 0; d < 7; d++) {
    const closed = str(formData, `closed_${d}`) === "on";
    const open = str(formData, `open_${d}`);
    const close = str(formData, `close_${d}`);
    if (closed) {
      days.push({ weekday: d, closed: true, open: null, close: null });
    } else if (open && close) {
      if (!time.test(open) || !time.test(close)) {
        return { days, error: `وقت غير صالح ليوم ${WEEKDAYS_AR[d]}` };
      }
      days.push({ weekday: d, closed: false, open, close });
    } else if (open || close) {
      return { days, error: `أدخل وقتي الفتح والإغلاق معًا ليوم ${WEEKDAYS_AR[d]}` };
    }
  }
  return { days };
}

export async function saveSiteBranch(formData: FormData): Promise<void> {
  const id = nullable(formData, "id");
  const back = id ? `${BRANCHES}?edit=${id}` : BRANCHES;
  const nameAr = str(formData, "name_ar");
  const nameEn = str(formData, "name_en");
  const mapUrl = nullable(formData, "map_url");
  if (!nameAr || !nameEn) fail(back, "أدخل اسم الفرع بالعربية والإنجليزية");
  if (mapUrl && !/^https:\/\/\S+$/.test(mapUrl)) {
    fail(back, "رابط الخريطة غير صالح. انسخه كاملًا من خرائط جوجل، ويبدأ بـ https");
  }
  const hours = readHours(formData);
  if (hours.error) fail(back, hours.error);

  const sort = order(formData);
  const { error } = await run("website.edit", async (client, userId) => {
    let branchId = id;
    const fields = [nameAr, nameEn, nullable(formData, "address_ar"), nullable(formData, "address_en"),
      nullable(formData, "phone"), mapUrl];

    if (branchId) {
      const { rowCount } = await client.query(
        `update site_branches
            set name_ar = $2, name_en = $3, address_ar = $4, address_en = $5, phone = $6,
                map_url = $7, sort_order = coalesce($8, sort_order), is_visible = $9
          where id = $1`,
        [branchId, ...fields, sort, str(formData, "is_visible") === "on"],
      );
      if (!rowCount) throw new Error("الفرع غير موجود");
    } else {
      // معرّف ثابت للفرع في روابط الموقع، يُشتق من الاسم الإنجليزي مرة واحدة
      const base = slugify(nameEn) || "branch";
      const { rows: taken } = await client.query(
        "select slug from site_branches where slug = $1 or slug like $2",
        [base, `${base}-%`],
      );
      const used = new Set(taken.map((r) => r.slug as string));
      let slug = base;
      for (let n = 2; used.has(slug); n++) slug = `${base}-${n}`;

      const { rows } = await client.query(
        `insert into site_branches (slug, name_ar, name_en, address_ar, address_en, phone, map_url, sort_order)
         values ($1, $2, $3, $4, $5, $6, $7,
                 coalesce($8, (select coalesce(max(sort_order), 0) + 10 from site_branches)))
         returning id`,
        [slug, ...fields, sort],
      );
      branchId = rows[0].id as string;
    }

    await client.query("delete from site_branch_hours where branch_id = $1", [branchId]);
    for (const day of hours.days) {
      await client.query(
        `insert into site_branch_hours (branch_id, weekday, is_closed, open_time, close_time)
         values ($1, $2, $3, $4, $5)`,
        [branchId, day.weekday, day.closed, day.open, day.close],
      );
    }
    // تعديل الساعات وحدها يجب أن يظهر في تاريخ آخر تحديث للفرع
    await client.query("update site_branches set updated_at = now() where id = $1", [branchId]);

    await logAudit(client, userId, id ? "update" : "insert", "site_branches", branchId,
      `فرع في الموقع: ${nameAr}`);
  });

  if (error) fail(back, error);
  done(BRANCHES);
}

export async function deleteSiteBranch(formData: FormData): Promise<void> {
  const id = str(formData, "id");
  const { error } = await run("website.edit", async (client, userId) => {
    const { rows } = await client.query(
      "delete from site_branches where id = $1 returning name_ar",
      [id],
    );
    if (!rows[0]) throw new Error("الفرع غير موجود");
    await logAudit(client, userId, "delete", "site_branches", id,
      `حذف فرع من الموقع: ${rows[0].name_ar}`);
  });

  if (error) fail(BRANCHES, error);
  done(BRANCHES);
}
