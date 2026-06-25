import { supabase } from "@/integrations/supabase/client";

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
