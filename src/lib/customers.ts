import { supabase } from "@/integrations/supabase/client";

// Cross-tenant reads, allowed only because the signed-in user is a platform admin
// (the admin-read RLS policies). A non-admin session sees nothing here.

export type SubscriptionStatus =
  | "trialing"
  | "active"
  | "past_due"
  | "canceled"
  | "expired";

export type CustomerRow = {
  id: string;
  name: string;
  currency: string;
  planKey: string | null;
  ownerId: string;
  ownerName: string | null;
  status: SubscriptionStatus | null;
  amount: number | null;
  createdAt: string;
};

export async function listCustomers(): Promise<CustomerRow[]> {
  const { data: businesses, error } = await supabase
    .from("businesses")
    .select("id, name, currency, subscription_tier, owner_id, created_at")
    .order("created_at", { ascending: false });
  if (error) throw error;

  const rows = businesses ?? [];
  if (rows.length === 0) return [];

  const ownerIds = [...new Set(rows.map((b) => b.owner_id).filter(Boolean))];
  const bizIds = rows.map((b) => b.id);

  const [profilesRes, subsRes] = await Promise.all([
    supabase.from("profiles").select("id, owner_name").in("id", ownerIds),
    supabase.from("subscriptions").select("business_id, status, amount").in("business_id", bizIds),
  ]);
  if (profilesRes.error) throw profilesRes.error;
  if (subsRes.error) throw subsRes.error;

  const ownerById = new Map((profilesRes.data ?? []).map((p) => [p.id, p.owner_name as string]));
  const subByBiz = new Map((subsRes.data ?? []).map((s) => [s.business_id, s]));

  return rows.map((b) => {
    const sub = subByBiz.get(b.id);
    return {
      id: b.id,
      name: b.name,
      currency: b.currency,
      planKey: b.subscription_tier,
      ownerId: b.owner_id,
      ownerName: ownerById.get(b.owner_id) ?? null,
      status: (sub?.status as SubscriptionStatus | undefined) ?? null,
      amount: sub?.amount ?? null,
      createdAt: b.created_at,
    };
  });
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
  team: TeamMember[];
};

export async function getCustomer(id: string): Promise<CustomerDetail | null> {
  const { data: biz, error } = await supabase
    .from("businesses")
    .select("id, name, currency, subscription_tier, timezone, whatsapp_number, owner_id, created_at")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!biz) return null;

  const [teamRes, subRes] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, owner_name, phone, last_seen")
      .eq("business_id", id)
      .order("created_at", { ascending: true }),
    supabase
      .from("subscriptions")
      .select("plan_key, cycle, status, amount, currency, current_period_end, started_at")
      .eq("business_id", id)
      .maybeSingle(),
  ]);
  if (teamRes.error) throw teamRes.error;
  if (subRes.error) throw subRes.error;

  const team: TeamMember[] = (teamRes.data ?? []).map((p) => ({
    id: p.id,
    name: p.owner_name ?? null,
    phone: p.phone ?? null,
    lastSeen: p.last_seen ?? null,
    isOwner: p.id === biz.owner_id,
  }));

  const sub = subRes.data;
  return {
    id: biz.id,
    name: biz.name,
    currency: biz.currency,
    planKey: biz.subscription_tier,
    timezone: biz.timezone,
    whatsappNumber: biz.whatsapp_number,
    ownerId: biz.owner_id,
    createdAt: biz.created_at,
    subscription: sub
      ? {
          planKey: sub.plan_key,
          cycle: sub.cycle,
          status: sub.status as SubscriptionStatus,
          amount: sub.amount,
          currency: sub.currency,
          currentPeriodEnd: sub.current_period_end,
          startedAt: sub.started_at,
        }
      : null,
    team,
  };
}
