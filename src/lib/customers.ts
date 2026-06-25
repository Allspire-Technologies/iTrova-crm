import { supabase } from "@/integrations/supabase/client";
import {
  getBusinessAggregate,
  listBusinessAggregates,
  type BusinessAggregate,
  type SubscriptionStatus,
} from "@/lib/admin";

export type { SubscriptionStatus };

// All data here comes from the staff-gated aggregate RPCs (see lib/admin.ts). The team
// list still reads profiles directly — allowed by the admin-read RLS, which also verifies
// is_platform_admin().

export type CustomerRow = {
  id: string;
  name: string;
  currency: string;
  planKey: string | null;
  ownerName: string | null;
  status: SubscriptionStatus | null;
  amount: number | null;
  totalUsers: number;
  salesCount: number;
  revenueRecorded: number;
  createdAt: string;
};

function toRow(a: BusinessAggregate): CustomerRow {
  return {
    id: a.businessId,
    name: a.name,
    currency: a.currency,
    planKey: a.planKey,
    ownerName: a.ownerName,
    status: a.subscriptionStatus,
    amount: a.subscriptionAmount,
    totalUsers: a.totalUsers,
    salesCount: a.salesCount,
    revenueRecorded: a.revenueRecorded,
    createdAt: a.joinedAt,
  };
}

export async function listCustomers(): Promise<CustomerRow[]> {
  const aggs = await listBusinessAggregates();
  return aggs.map(toRow);
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
