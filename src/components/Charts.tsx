import { money } from "@/lib/format";

/** مخطط أعمدة بسيط مرسوم كـ SVG — يظهر في الشاشة وفي الطباعة بلا مكتبات خارجية */
export function BarChart({
  data,
  height = 190,
  color = "var(--brand)",
  format = money,
}: {
  data: { label: string; value: number; color?: string }[];
  height?: number;
  color?: string;
  format?: (v: unknown) => string;
}) {
  if (data.length === 0) {
    return (
      <div style={{ padding: 28, textAlign: "center", color: "var(--muted)", fontSize: 13 }}>
        لا توجد بيانات لعرضها
      </div>
    );
  }

  const max = Math.max(...data.map((d) => Math.abs(d.value)), 1);
  const barWidth = Math.min(72, Math.max(26, 520 / data.length));
  const gap = Math.max(6, barWidth * 0.25);
  const width = data.length * (barWidth + gap) + gap;
  const topPad = 20;
  const plot = height - 42 - topPad + 10;

  return (
    <div style={{ overflowX: "auto", padding: "8px 4px 0" }}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height={height}
        style={{ maxWidth: width, display: "block", margin: "0 auto" }}
        role="img"
      >
        {[0, 0.25, 0.5, 0.75, 1].map((t) => (
          <line
            key={t}
            x1={0}
            x2={width}
            y1={topPad + plot * t}
            y2={topPad + plot * t}
            stroke="#eef1f7"
            strokeWidth={1}
          />
        ))}

        {data.map((d, i) => {
          const h = (Math.abs(d.value) / max) * plot;
          const x = width - (gap + i * (barWidth + gap)) - barWidth; // من اليمين لليسار
          const y = topPad + plot - h;
          return (
            <g key={d.label + i}>
              <rect
                x={x}
                y={y}
                width={barWidth}
                height={Math.max(h, 1)}
                rx={5}
                fill={d.color ?? (d.value < 0 ? "var(--danger)" : color)}
                opacity={0.92}
              />
              <text
                x={x + barWidth / 2}
                y={y - 5}
                textAnchor="middle"
                fontSize={10.5}
                fill="var(--muted)"
                style={{ direction: "ltr" }}
              >
                {format(d.value)}
              </text>
              <text
                x={x + barWidth / 2}
                y={height - 10}
                textAnchor="middle"
                fontSize={11}
                fill="var(--text)"
              >
                {d.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/** مخطط خطي للمبيعات اليومية */
export function LineChart({
  data,
  height = 190,
}: {
  data: { label: string; value: number }[];
  height?: number;
}) {
  if (data.length < 2) {
    return (
      <div style={{ padding: 28, textAlign: "center", color: "var(--muted)", fontSize: 13 }}>
        لا توجد حركة كافية لرسم المخطط
      </div>
    );
  }

  const width = 760;
  const plot = height - 34;
  const max = Math.max(...data.map((d) => d.value), 1);
  const stepX = width / (data.length - 1);

  // المحور من اليمين إلى اليسار ليوافق اتجاه القراءة
  const point = (i: number, v: number) => [width - i * stepX, 8 + plot - (v / max) * plot];
  const path = data.map((d, i) => `${i === 0 ? "M" : "L"}${point(i, d.value).join(",")}`).join(" ");
  const area = `${path} L${point(data.length - 1, 0)[0]},${8 + plot} L${point(0, 0)[0]},${8 + plot} Z`;

  return (
    <div style={{ overflowX: "auto", padding: "8px 4px 0" }}>
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} role="img">
        {[0, 0.5, 1].map((t) => (
          <line key={t} x1={0} x2={width} y1={8 + plot * t} y2={8 + plot * t} stroke="#eef1f7" />
        ))}
        <path d={area} fill="var(--brand)" opacity={0.08} />
        <path d={path} fill="none" stroke="var(--brand)" strokeWidth={2} strokeLinejoin="round" />
        {data.map((d, i) => {
          const [x, y] = point(i, d.value);
          const showLabel = data.length <= 16 || i % Math.ceil(data.length / 12) === 0;
          return (
            <g key={d.label}>
              <circle cx={x} cy={y} r={2.6} fill="var(--brand)" />
              {showLabel ? (
                <text x={x} y={height - 8} textAnchor="middle" fontSize={10} fill="var(--muted)">
                  {d.label}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
