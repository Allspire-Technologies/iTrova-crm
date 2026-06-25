import { supabase } from "@/integrations/supabase/client";
import { getBusinessAggregate, type SubscriptionStatus } from "@/lib/admin";
import type { HealthBand } from "@/lib/cs";

export type { SubscriptionStatus };

// All data here comes from the staff-gated aggregate RPCs (see lib/admin.ts). The team
// list still reads profiles directly — allowed by the admin-read RLS, which also verifies
// is_platform_admin().

type Row = Record<string, unknown>;
const num = (v: unknown): number => (v == null ? 0 : Number(v));
const str = (v: unknown): string | null => (v == null ? null : String(v));

// ----------------------------------------------------------------------------
// Customer Overview table (PRD §7.2) — server-side paginated/filtered/sorted.
// The whole list is computed in Postgres (admin_customers_page) so the browser
// never loads every business client-side.
// ----------------------------------------------------------------------------
export type CustomerPageRow = {
  businessId: string;
  name: string;
  industry: string | null;
  planKey: string | null;
  subscriptionStatus: SubscriptionStatus | null;
  joinedAt: string;
  productsTotal: number;
  salesCount: number;
  totalUsers: number;
  lastLogin: string | null;
  renewalDate: string | null;
  healthScore: number | null;
  healthBand: HealthBand | null;
  accountManagerId: string | null;
  accountManagerName: string | null;
  ownerName: string | null;
};

export type CustomersSort =
  | "health"
  | "name"
  | "industry"
  | "plan"
  | "status"
  | "joined"
  | "products"
  | "sales"
  | "users"
  | "last_login"
  | "renewal"
  | "manager";

export type CustomersQuery = {
  search?: string;
  band?: HealthBand;
  plan?: string;
  subscriptionStatus?: SubscriptionStatus;
  industry?: string;
  accountManager?: string; // uuid
  unassigned?: boolean;
  renewalDue?: boolean;
  atRisk?: boolean;
  active?: boolean; // login ≤ 30d
  newThisMonth?: boolean;
  sort?: CustomersSort;
  dir?: "asc" | "desc";
  page?: number; // 1-based
  pageSize?: number;
};

export type CustomersPage = {
  rows: CustomerPageRow[];
  total: number;
  page: number;
  pageSize: number;
};

function mapPageRow(r: Row): CustomerPageRow {
  return {
    businessId: String(r.business_id),
    name: String(r.name),
    industry: str(r.industry),
    planKey: str(r.plan_key),
    subscriptionStatus: (str(r.subscription_status) as SubscriptionStatus | null),
    joinedAt: String(r.joined_at),
    productsTotal: num(r.products_total),
    salesCount: num(r.sales_count),
    totalUsers: num(r.total_users),
    lastLogin: str(r.last_login),
    renewalDate: str(r.renewal_date),
    healthScore: r.health_score == null ? null : num(r.health_score),
    healthBand: (str(r.health_band) as HealthBand | null),
    accountManagerId: str(r.account_manager_id),
    accountManagerName: str(r.account_manager_name),
    ownerName: str(r.owner_name),
  };
}

export async function listCustomersPage(q: CustomersQuery = {}): Promise<CustomersPage> {
  const pageSize = q.pageSize ?? 25;
  const page = Math.max(1, q.page ?? 1);
  const { data, error } = await supabase.rpc("admin_customers_page", {
    p_search: q.search?.trim() || null,
    p_band: q.band ?? null,
    p_plan: q.plan ?? null,
    p_subscription_status: q.subscriptionStatus ?? null,
    p_industry: q.industry ?? null,
    p_account_manager: q.accountManager ?? null,
    p_unassigned: q.unassigned ?? false,
    p_renewal_due: q.renewalDue ?? false,
    p_at_risk: q.atRisk ?? false,
    p_active: q.active ?? false,
    p_new_this_month: q.newThisMonth ?? false,
    p_renewal_days: 14,
    p_sort: q.sort ?? "health",
    p_dir: q.dir ?? "asc",
    p_limit: pageSize,
    p_offset: (page - 1) * pageSize,
  });
  if (error) throw error;
  const raw = (data ?? []) as Row[];
  const total = raw.length ? num(raw[0].total_count) : 0;
  return { rows: raw.map(mapPageRow), total, page, pageSize };
}

export type TeamMember = {
  id: string;
  name: string | null;
  phone: string | null;
  lastSeen: string | null;
  isOwner: boolean;
};

export type CustomerSubscription = {
  planKey: string;
  cycle: string;
  status: SubscriptionStatus;
  amount: number;
  currency: string;
  currentPeriodEnd: string | null;
  startedAt: string | null;
};

export type CustomerMetrics = {
  totalUsers: number;
  activeUsers: number;
  lastLogin: string | null;
  productsTotal: number;
  productsAdded30d: number;
  productsLowStock: number;
  stockMovements: number;
  purchaseOrders: number;
  salesCount: number;
  revenueRecorded: number;
  ordersCount: number;
};

export type CustomerDetail = {
  id: string;
  name: string;
  currency: string;
  planKey: string | null;
  timezone: string | null;
  whatsappNumber: string | null;
  ownerId: string;
  createdAt: string;
  subscription: CustomerSubscription | null;
  metrics: CustomerMetrics;
  team: TeamMember[];
};

export async function getCustomer(id: string): Promise<CustomerDetail | null> {
  const agg = await getBusinessAggregate(id);
  if (!agg) return null;

  const { data: team, error } = await supabase
    .from("profiles")
    .select("id, owner_name, phone, last_seen")
    .eq("business_id", id)
    .order("created_at", { ascending: true });
  if (error) throw error;

  return {
    id: agg.businessId,
    name: agg.name,
    currency: agg.currency,
    planKey: agg.planKey,
    timezone: agg.timezone,
    whatsappNumber: agg.whatsappNumber,
    ownerId: agg.ownerId,
    createdAt: agg.joinedAt,
    subscription: agg.subscriptionStatus
      ? {
          planKey: agg.planKey ?? "",
          cycle: agg.subscriptionCycle ?? "",
          status: agg.subscriptionStatus,
          amount: agg.subscriptionAmount ?? 0,
          currency: agg.currency,
          currentPeriodEnd: agg.renewalDate,
          startedAt: agg.subscriptionStarted,
        }
      : null,
    metrics: {
      totalUsers: agg.totalUsers,
      activeUsers: agg.activeUsers,
      lastLogin: agg.lastLogin,
      productsTotal: agg.productsTotal,
      productsAdded30d: agg.productsAdded30d,
      productsLowStock: agg.productsLowStock,
      stockMovements: agg.stockMovements,
      purchaseOrders: agg.purchaseOrders,
      salesCount: agg.salesCount,
      revenueRecorded: agg.revenueRecorded,
      ordersCount: agg.ordersCount,
    },
    team: (team ?? []).map((p) => ({
      id: p.id,
      name: p.owner_name ?? null,
      phone: p.phone ?? null,
      lastSeen: p.last_seen ?? null,
      isOwner: p.id === agg.ownerId,
    })),
  };
}
