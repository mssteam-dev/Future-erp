/** ثوابت ودوال عرض مشتركة لقسم الموقع الإلكتروني */

// الترتيب مطابق لعمود weekday في site_branch_hours: 0 = الأحد
export const WEEKDAYS_AR = [
  "الأحد",
  "الاثنين",
  "الثلاثاء",
  "الأربعاء",
  "الخميس",
  "الجمعة",
  "السبت",
] as const;

export type SiteDayHours = {
  weekday: number;
  is_closed: boolean;
  open_time: string | null;   // HH:MM
  close_time: string | null;  // HH:MM
};

/** 14:00 ← 2:00 م */
export function timeLabel(hhmm: string | null): string {
  if (!hhmm) return "";
  const [h, m] = hhmm.split(":").map(Number);
  const h12 = h % 12 || 12;
  return `${h12}:${String(m).padStart(2, "0")} ${h < 12 ? "ص" : "م"}`;
}

/**
 * ملخص ساعات الأسبوع في سطر: الساعات الأكثر تكرارًا أولًا ثم الأيام المختلفة عنها.
 * مثال: «10:00 ص – 3:00 ص، الجمعة 2:00 م – 3:00 ص»
 */
export function hoursSummary(days: SiteDayHours[]): string {
  if (days.length === 0) return "غير محددة";

  const label = (d: SiteDayHours) =>
    d.is_closed ? "مغلق" : `${timeLabel(d.open_time)} – ${timeLabel(d.close_time)}`;

  const counts = new Map<string, number>();
  for (const d of days) counts.set(label(d), (counts.get(label(d)) ?? 0) + 1);
  const usual = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];

  const parts = [usual];
  for (const d of days) {
    if (label(d) !== usual) parts.push(`${WEEKDAYS_AR[d.weekday]} ${label(d)}`);
  }

  // إن لم تكن كل الأيام محددة نذكر ذلك حتى لا يُفهم أن الملخص يشمل الأسبوع كله
  const missing = 7 - days.length;
  if (missing === 1) parts.push("يوم واحد غير محدد");
  else if (missing === 2) parts.push("يومان غير محددين");
  else if (missing > 2) parts.push(`${missing} أيام غير محددة`);

  return parts.join("، ");
}

/** «3 أصناف»، «20 صنفًا»، «صنف واحد» — صيغة العدد الصحيحة للمعدود */
export function countLabel(
  n: number,
  forms: { zero: string; one: string; two: string; few: string; many: string; other: string },
): string {
  if (n === 0) return forms.zero;
  if (n === 1) return forms.one;
  if (n === 2) return forms.two;
  const rem = n % 100;
  if (rem >= 3 && rem <= 10) return `${n} ${forms.few}`;
  if (rem >= 11) return `${n} ${forms.many}`;
  return `${n} ${forms.other}`;
}

export const ITEMS_COUNT = {
  zero: "لا أصناف بعد",
  one: "صنف واحد",
  two: "صنفان",
  few: "أصناف",
  many: "صنفًا",
  other: "صنف",
};
