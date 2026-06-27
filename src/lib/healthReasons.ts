// Turn the raw `reasons` JSON stored on a health snapshot into something presentable.
//
// The health engine (cs_score, PRD §7.3) emits an array mixing two shapes:
//   - Scoring factors: { rule, points, ...context }  e.g.
//       { rule: "login_recency",  points: 25, days: 1.2 }
//       { rule: "inventory_setup",points: 20, products: 14 }
//       { rule: "sales_activity", points: 12, days: 9 }
//       { rule: "user_adoption",  points: 8,  active_users: 1 }
//       { rule: "renewal_posture",points: 10, status: "active" }
//   - Flags: { rule: "trip_wire" | "warning", detail: "no login in 21 days" }
// Older/snapshot data (and tests) may also store plain strings. We normalise all of it into
// scored `factors` (with a max + tone) and human `flags`, so the UI never dumps raw JSON.

export type FactorTone = "good" | "warn" | "bad";

export type HealthFactor = {
  key: string;
  label: string;
  points: number;
  max: number;
  detail: string;
  tone: FactorTone;
};

export type HealthFlagKind = "critical" | "warning" | "note";
export type HealthFlag = { kind: HealthFlagKind; text: string };

export type HealthBreakdown = {
  factors: HealthFactor[];
  flags: HealthFlag[];
  total: number; // sum of factor points earned
  max: number; // sum of factor maxes (100 when all five are present)
};

type Obj = Record<string, unknown>;

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/** "no login in 21 days" -> "No login in 21 days" (first letter only; keep the rest verbatim). */
function sentence(text: string): string {
  const t = text.trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : t;
}

function daysAgo(days: number | null, verb: string, none: string): string {
  if (days == null) return none;
  const d = Math.round(days);
  if (d <= 0) return `${verb} today`;
  return `${verb} ${d} day${d === 1 ? "" : "s"} ago`;
}

const STATUS_LABEL: Record<string, string> = {
  active: "Subscription active",
  trialing: "On trial",
  past_due: "Payment past due",
  canceled: "Subscription canceled",
  expired: "Subscription expired",
};

// rule -> label, max points, and how to describe its context line.
const RULES: Record<string, { label: string; max: number; detail: (o: Obj) => string }> = {
  login_recency: { label: "Login recency", max: 25, detail: (o) => daysAgo(num(o.days), "Last login", "Never logged in") },
  inventory_setup: {
    label: "Inventory setup",
    max: 20,
    detail: (o) => {
      const n = num(o.products) ?? 0;
      return n === 0 ? "No products added yet" : `${n} product${n === 1 ? "" : "s"} in catalogue`;
    },
  },
  sales_activity: { label: "Sales activity", max: 30, detail: (o) => daysAgo(num(o.days), "Last sale", "No sales recorded") },
  user_adoption: {
    label: "User adoption",
    max: 15,
    detail: (o) => {
      const n = num(o.active_users) ?? 0;
      return n === 0 ? "No active users (last 30 days)" : `${n} active user${n === 1 ? "" : "s"} (last 30 days)`;
    },
  },
  renewal_posture: {
    label: "Renewal posture",
    max: 10,
    detail: (o) => {
      const s = str(o.status);
      return s ? STATUS_LABEL[s] ?? sentence(s.replace(/_/g, " ")) : "No subscription";
    },
  },
};

function toneFor(points: number, max: number): FactorTone {
  if (max <= 0) return "warn";
  const ratio = points / max;
  if (ratio >= 1) return "good";
  if (ratio > 0) return "warn";
  return "bad";
}

export function parseHealthReasons(reasons: unknown): HealthBreakdown {
  const factors: HealthFactor[] = [];
  const flags: HealthFlag[] = [];
  if (!Array.isArray(reasons)) return { factors, flags, total: 0, max: 0 };

  for (const r of reasons) {
    if (typeof r === "string") {
      const t = r.trim();
      if (t) flags.push({ kind: "note", text: t });
      continue;
    }
    if (!r || typeof r !== "object") continue;
    const o = r as Obj;
    const rule = str(o.rule);

    if (rule && RULES[rule]) {
      const def = RULES[rule];
      const points = num(o.points) ?? 0;
      factors.push({ key: rule, label: def.label, points, max: def.max, detail: def.detail(o), tone: toneFor(points, def.max) });
      continue;
    }

    if (rule === "trip_wire" || rule === "warning") {
      const detail = str(o.detail);
      if (detail) flags.push({ kind: rule === "trip_wire" ? "critical" : "warning", text: sentence(detail) });
      continue;
    }

    // Legacy/unknown object — surface any human-readable field rather than JSON.
    const text = str(o.label) ?? str(o.reason) ?? str(o.message) ?? str(o.detail);
    if (text) flags.push({ kind: "note", text: sentence(text) });
  }

  const total = factors.reduce((sum, f) => sum + f.points, 0);
  const max = factors.reduce((sum, f) => sum + f.max, 0);
  return { factors, flags, total, max };
}
