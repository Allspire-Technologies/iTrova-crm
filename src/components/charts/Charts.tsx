import { cn } from "@/lib/utils";

// Tiny dependency-free, accessible SVG charts. Each is role="img" with an aria-label so the
// data is conveyed without relying on the visual alone (PRD §9 accessibility).

export function Sparkline({
  values,
  width = 200,
  height = 44,
  className,
  strokeClass = "stroke-brand",
  fillClass = "fill-brand/10",
  dotClass = "fill-brand",
  ariaLabel,
}: {
  values: number[];
  width?: number;
  height?: number;
  className?: string;
  strokeClass?: string;
  fillClass?: string;
  dotClass?: string;
  ariaLabel: string;
}) {
  if (values.length === 0) {
    return <div className={cn("text-xs text-muted-foreground", className)} role="img" aria-label={`${ariaLabel}: no data`}>—</div>;
  }
  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = max - min || 1;
  const n = values.length;
  const pad = 3;
  const innerH = height - pad * 2;
  const dx = n > 1 ? width / (n - 1) : 0;
  const pts = values.map((v, i) => [n > 1 ? i * dx : width / 2, pad + innerH - ((v - min) / range) * innerH] as const);
  const line = pts.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${line} L${width},${height} L0,${height} Z`;
  const [lx, ly] = pts[n - 1];
  return (
    <svg role="img" aria-label={ariaLabel} width={width} height={height} viewBox={`0 0 ${width} ${height}`} className={className} preserveAspectRatio="none">
      <path d={area} className={fillClass} stroke="none" />
      <path d={line} className={strokeClass} fill="none" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={lx} cy={ly} r={2.5} className={dotClass} />
    </svg>
  );
}

export function MiniBars({
  data,
  height = 40,
  barClass = "fill-brand",
  className,
  ariaLabel,
}: {
  data: { label: string; value: number }[];
  height?: number;
  barClass?: string;
  className?: string;
  ariaLabel: string;
}) {
  const max = Math.max(...data.map((d) => d.value), 1);
  const bw = 16;
  const gap = 8;
  const width = data.length * (bw + gap) - gap;
  return (
    <svg role="img" aria-label={ariaLabel} width={width} height={height} viewBox={`0 0 ${width} ${height}`} className={className}>
      {data.map((d, i) => {
        const h = Math.max((d.value / max) * height, d.value > 0 ? 2 : 0);
        return <rect key={i} x={i * (bw + gap)} y={height - h} width={bw} height={h} rx={2} className={barClass} />;
      })}
    </svg>
  );
}
