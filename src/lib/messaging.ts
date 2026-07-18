import { supabase } from "@/integrations/supabase/client";

// Direct customer email (Management/Admin + Customer Support). Templates + freeform, sent via the
// send-customer-email Edge Function (holds the Sender.net token); every send is logged to
// cs_customer_message. See supabase/migrations/20260705120000_customer_messaging.sql.

export type EmailTemplate = { key: string; name: string; subject: string; body: string };

export type MessageStatus = "queued" | "sent" | "failed" | "opened";
export type MessageChannel = "email" | "whatsapp";
export type CustomerMessage = {
  id: string;
  businessId: string;
  channel: MessageChannel;
  toEmail: string | null;   // null for WhatsApp
  toPhone: string | null;   // null for email
  subject: string | null;   // null for WhatsApp
  templateKey: string | null;
  status: MessageStatus;
  error: string | null;
  createdAt: string;
  sentByName: string | null; // staff member who sent it (resolved server-side)
};

/** Strip a rich-text/HTML template body down to plain text for WhatsApp (no HTML, no subject).
 *  Block tags become newlines; entities are decoded; runs of blank lines collapse. */
export function htmlToPlainText(html: string): string {
  return html
    .replace(/<\s*(br|\/p|\/div|\/li|\/h[1-6])\s*>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Merge fields available to templates + freeform. */
export type MergeVars = {
  business_name: string;
  owner_name: string;
  plan: string;
  renewal_date: string;
};

/** True when a rich-text HTML value has no visible content (e.g. "<p></p>"). */
export function richTextIsEmpty(html: string): boolean {
  return html.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").trim().length === 0;
}

/** Replace {{token}} occurrences with the matching merge var (unknown tokens are left as-is). */
export function renderTemplate(text: string, vars: MergeVars): string {
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (m, key: string) => (key in vars ? (vars as Record<string, string>)[key] : m));
}

/** Seeded email templates (any staff may read). */
export async function listTemplates(): Promise<EmailTemplate[]> {
  const { data, error } = await supabase
    .from("cs_email_template")
    .select("key, name, subject, body")
    .order("name");
  if (error) throw error;
  return (data ?? []) as EmailTemplate[];
}

/** Create or update a template (admin-only via RLS). */
export async function saveTemplate(t: EmailTemplate): Promise<EmailTemplate> {
  const { data, error } = await supabase
    .from("cs_email_template")
    .upsert({ key: t.key, name: t.name, subject: t.subject, body: t.body }, { onConflict: "key" })
    .select("key, name, subject, body")
    .single();
  if (error) throw error;
  return data as EmailTemplate;
}

/** Delete a template (admin-only via RLS). */
export async function deleteTemplate(key: string): Promise<void> {
  const { error } = await supabase.from("cs_email_template").delete().eq("key", key);
  if (error) throw error;
}

/** Past messages sent to a business (visibility-scoped, newest first), each with the staff member
 *  who sent it. Uses the cs_customer_messages RPC because the sender name (created_by → auth.users)
 *  can only be resolved server-side. */
export async function listCustomerMessages(businessId: string): Promise<CustomerMessage[]> {
  const { data, error } = await supabase.rpc("cs_customer_messages", { p_business_id: businessId });
  if (error) throw error;
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: String(r.id),
    businessId: String(r.business_id),
    channel: (r.channel === "whatsapp" ? "whatsapp" : "email") as MessageChannel,
    toEmail: r.to_email == null ? null : String(r.to_email),
    toPhone: r.to_phone == null ? null : String(r.to_phone),
    subject: r.subject == null ? null : String(r.subject),
    templateKey: r.template_key == null ? null : String(r.template_key),
    status: String(r.status) as MessageStatus,
    error: r.error == null ? null : String(r.error),
    createdAt: String(r.created_at),
    sentByName: r.created_by_name == null ? null : String(r.created_by_name),
  }));
}

/** Log a WhatsApp send (a wa.me link was opened). Server verifies the caller may message the
 *  customer. Returns the new log row id. */
export async function logWhatsapp(input: {
  businessId: string; toPhone: string; toName: string | null; body: string; templateKey?: string | null;
}): Promise<string> {
  const { data, error } = await supabase.rpc("cs_log_whatsapp", {
    p_business_id: input.businessId,
    p_to_phone: input.toPhone,
    p_to_name: input.toName,
    p_body: input.body,
    p_template_key: input.templateKey ?? null,
  });
  if (error) throw error;
  return String(data);
}

/** One row of the central Messages log — a send to any customer, with business + sender resolved. */
export type MessageLogEntry = {
  id: string;
  businessId: string;
  businessName: string;
  channel: MessageChannel;
  toEmail: string | null;
  toPhone: string | null;
  subject: string | null;
  templateKey: string | null;
  status: MessageStatus;
  error: string | null;
  createdAt: string;
  sentByName: string | null;
};

export type MessageLogPage = { rows: MessageLogEntry[]; total: number };

/** Central log of customer emails across ALL customers (visibility-scoped server-side), newest
 *  first, paginated. Powers the Messages module. Optional subject/business/recipient search + status
 *  filter; `total` is the full filtered count for the pager. */
export async function listMessageLog(
  opts: { search?: string; status?: MessageStatus | null; limit?: number; offset?: number } = {},
): Promise<MessageLogPage> {
  const { data, error } = await supabase.rpc("cs_message_log", {
    p_search: opts.search?.trim() || null,
    p_status: opts.status ?? null,
    p_limit: opts.limit ?? 50,
    p_offset: opts.offset ?? 0,
  });
  if (error) throw error;
  const raw = (data ?? []) as Record<string, unknown>[];
  const rows = raw.map((r) => ({
    id: String(r.id),
    businessId: String(r.business_id),
    businessName: String(r.business_name),
    channel: (r.channel === "whatsapp" ? "whatsapp" : "email") as MessageChannel,
    toEmail: r.to_email == null ? null : String(r.to_email),
    toPhone: r.to_phone == null ? null : String(r.to_phone),
    subject: r.subject == null ? null : String(r.subject),
    templateKey: r.template_key == null ? null : String(r.template_key),
    status: String(r.status) as MessageStatus,
    error: r.error == null ? null : String(r.error),
    createdAt: String(r.created_at),
    sentByName: r.created_by_name == null ? null : String(r.created_by_name),
  }));
  return { rows, total: raw.length ? Number(raw[0].total_count) || 0 : 0 };
}

export type SendEmailInput = {
  businessId: string;
  subject: string;
  html: string;
  templateKey?: string | null;
};

/** Send a customer email via the Edge Function. The recipient is resolved SERVER-SIDE (always the
 *  business owner's account email) — the browser never chooses the address. Returns the resolved
 *  recipient for confirmation. */
export async function sendCustomerEmail(input: SendEmailInput): Promise<string> {
  const { data, error } = await supabase.functions.invoke<{ ok?: boolean; id?: string | null; to_email?: string; error?: string }>(
    "send-customer-email",
    {
      body: {
        business_id: input.businessId,
        subject: input.subject,
        html: input.html,
        template_key: input.templateKey ?? null,
      },
    },
  );
  if (error) {
    if ((error as { name?: string }).name === "FunctionsFetchError" || /failed to send a request/i.test(error.message)) {
      throw new Error("Couldn't reach the email function — deploy it: supabase functions deploy send-customer-email");
    }
    let message = error.message;
    try {
      const body = await (error as { context?: Response }).context?.json();
      if (body?.error) message = body.error;
    } catch {
      /* fall back to error.message */
    }
    throw new Error(message);
  }
  if (data?.error) throw new Error(data.error);
  if (!data?.ok) throw new Error("The email did not send.");
  return data.to_email ?? "";
}
