import { supabase } from "@/integrations/supabase/client";
import type { HealthBand, PipelineStage } from "@/lib/cs";

// Typed access to the secure aggregate layer. Every call goes through a SECURITY DEFINER
// RPC that verifies the caller is a platform admin before returning cross-tenant data
// (see supabase/migrations/20260625120000_admin_aggregates.sql). No raw operational rows
// and no service-role key ever reach the browser.

export type SubscriptionStatus = "trialing" | "active" | "past_due" | "canceled" | "expired";

export type BusinessAggregate = {
  businessId: string;
  name: string;
  currency: string;
  timezone: string | null;
  whatsappNumber: string | null;
  ownerId: string;
  ownerName: string | null;
  planKey: string | null;
  subscriptionStatus: SubscriptionStatus | null;
  subscriptionAmount: number | null;
  subscriptionCycle: string | null;
  subscriptionStarted: string | null;
  renewalDate: string | null;
  joinedAt: string;
  // operational aggregates
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

export type DashboardKpis = {
  totalBusinesses: number;
  activeSubscriptions: number;
  newThisMonth: number;
  mrr: number;
  currency: string;
  totalRevenue: number;
  totalSales: number;
  totalProducts: number;
};

type Row = Record<string, unknown>;
// Postgres returns bigint/numeric as strings to preserve precision; coerce safely.
const num = (v: unknown): number => (v == null ? 0 : Number(v));
const str = (v: unknown): string | null => (v == null ? null : String(v));

function mapAggregate(r: Row): BusinessAggregate {
  return {
    businessId: String(r.business_id),
    name: String(r.name),
    currency: str(r.currency) ?? "NGN",
    timezone: str(r.timezone),
    whatsappNumber: str(r.whatsapp_number),
    ownerId: String(r.owner_id),
    ownerName: str(r.owner_name),
    planKey: str(r.plan_key),
    subscriptionStatus: (str(r.subscription_status) as SubscriptionStatus | null),
    subscriptionAmount: r.subscription_amount == null ? null : num(r.subscription_amount),
    subscriptionCycle: str(r.subscription_cycle),
    subscriptionStarted: str(r.subscription_started),
    renewalDate: str(r.renewal_date),
    joinedAt: String(r.joined_at),
    totalUsers: num(r.total_users),
    activeUsers: num(r.active_users),
    lastLogin: str(r.last_login),
    productsTotal: num(r.products_total),
    productsAdded30d: num(r.products_added_30d),
    productsLowStock: num(r.products_low_stock),
    stockMovements: num(r.stock_movements),
    purchaseOrders: num(r.purchase_orders),
    salesCount: num(r.sales_count),
    revenueRecorded: num(r.revenue_recorded),
    ordersCount: num(r.orders_count),
  };
}

export async function listBusinessAggregates(): Promise<BusinessAggregate[]> {
  const { data, error } = await supabase.rpc("admin_business_aggregates");
  if (error) throw error;
  return ((data ?? []) as Row[]).map(mapAggregate);
}

export async function getBusinessAggregate(businessId: string): Promise<BusinessAggregate | null> {
  const { data, error } = await supabase.rpc("admin_business_aggregates", { p_business_id: businessId });
  if (error) throw error;
  const row = ((data ?? []) as Row[])[0];
  return row ? mapAggregate(row) : null;
}

export async function getDashboardKpis(): Promise<DashboardKpis> {
  const { data, error } = await supabase.rpc("admin_dashboard_kpis");
  if (error) throw error;
  const r = (((data ?? []) as Row[])[0] ?? {}) as Row;
  return {
    totalBusinesses: num(r.total_businesses),
    activeSubscriptions: num(r.active_subscriptions),
    newThisMonth: num(r.new_this_month),
    mrr: num(r.mrr),
    currency: str(r.currency) ?? "NGN",
    totalRevenue: num(r.total_revenue),
    totalSales: num(r.total_sales),
    totalProducts: num(r.total_products),
  };
}

export async function refreshAggregates(): Promise<void> {
  const { error } = await supabase.rpc("admin_refresh_aggregates");
  if (error) throw error;
}

// Internal staff member (candidate account manager). From admin_list_staff().
export type StaffMember = { id: string; name: string };

// Filter facets for the customers overview (distinct plans/industries + the staff list),
// fetched once and reused for every dropdown. From admin_customers_facets().
export type CustomersFacets = {
  plans: string[];
  industries: string[];
  managers: StaffMember[];
};

// Daily health-band trend for the Home chart. From admin_health_trend().
export type HealthTrendPoint = { day: string; atRisk: number; yellow: number; green: number; total: number };

export async function getHealthTrend(days = 30): Promise<HealthTrendPoint[]> {
  const { data, error } = await supabase.rpc("admin_health_trend", { p_days: days });
  if (error) throw error;
  return ((data ?? []) as Row[]).map((r) => ({
    day: String(r.day),
    atRisk: num(r.at_risk),
    yellow: num(r.yellow),
    green: num(r.green),
    total: num(r.total),
  }));
}

// Customer Success Pipeline board (PRD §7.6) — one card per business. From admin_pipeline_board().
export type PipelineCard = {
  businessId: string;
  name: string;
  stage: PipelineStage;
  stageSource: "auto" | "manual";
  healthBand: HealthBand | null;
  healthScore: number | null;
  renewalDate: string | null;
  accountManagerName: string | null;
};

export async function getPipelineBoard(): Promise<PipelineCard[]> {
  const { data, error } = await supabase.rpc("admin_pipeline_board");
  if (error) throw error;
  return ((data ?? []) as Row[]).map((r) => ({
    businessId: String(r.business_id),
    name: String(r.name),
    stage: str(r.stage) as PipelineStage,
    stageSource: (str(r.stage_source) as "auto" | "manual") ?? "auto",
    healthBand: str(r.health_band) as HealthBand | null,
    healthScore: r.health_score == null ? null : num(r.health_score),
    renewalDate: str(r.renewal_date),
    accountManagerName: str(r.account_manager_name),
  }));
}

// Profile extras the aggregate doesn't carry (industry + owner email), for the detail page.
export type BusinessProfileExtra = { industry: string | null; ownerEmail: string | null };

export async function getBusinessProfileExtra(businessId: string): Promise<BusinessProfileExtra> {
  const { data, error } = await supabase.rpc("admin_business_profile", { p_business_id: businessId });
  if (error) throw error;
  const r = (((data ?? []) as Row[])[0] ?? {}) as Row;
  return { industry: str(r.industry), ownerEmail: str(r.owner_email) };
}

// 30/90-day usage trends for the Customer Detail "Product Usage" section (lazy-loaded).
export type UsageMetric = { total: number; d30: number; d90: number };
export type BusinessUsage = {
  products: UsageMetric;
  sales: UsageMetric;
  revenue: UsageMetric;
  stock: UsageMetric;
  purchaseOrders: UsageMetric;
  orders: UsageMetric;
};

export async function getBusinessUsage(businessId: string): Promise<BusinessUsage> {
  const { data, error } = await supabase.rpc("admin_business_usage", { p_business_id: businessId });
  if (error) throw error;
  const r = (((data ?? []) as Row[])[0] ?? {}) as Row;
  const metric = (t: unknown, a: unknown, b: unknown): UsageMetric => ({ total: num(t), d30: num(a), d90: num(b) });
  return {
    products: metric(r.products_total, r.products_30d, r.products_90d),
    sales: metric(r.sales_total, r.sales_30d, r.sales_90d),
    revenue: metric(r.revenue_total, r.revenue_30d, r.revenue_90d),
    stock: metric(r.stock_total, r.stock_30d, r.stock_90d),
    purchaseOrders: metric(r.po_total, r.po_30d, r.po_90d),
    orders: metric(r.orders_total, r.orders_30d, r.orders_90d),
  };
}

export async function getCustomersFacets(): Promise<CustomersFacets> {
  const { data, error } = await supabase.rpc("admin_customers_facets");
  if (error) throw error;
  const r = (data ?? {}) as { plans?: unknown; industries?: unknown; managers?: unknown };
  const asStrings = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);
  const managers = Array.isArray(r.managers)
    ? (r.managers as Row[]).map((m) => ({ id: String(m.id), name: str(m.name) ?? String(m.id) }))
    : [];
  return { plans: asStrings(r.plans), industries: asStrings(r.industries), managers };
}
