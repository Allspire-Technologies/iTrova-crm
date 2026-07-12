import { supabase } from "@/integrations/supabase/client";

// Direct customer email (Management/Admin + Customer Support). Templates + freeform, sent via the
// send-customer-email Edge Function (holds the Sender.net token); every send is logged to
// cs_customer_message. See supabase/migrations/20260705120000_customer_messaging.sql.

export type EmailTemplate = { key: string; name: string; subject: string; body: string };

export type MessageStatus = "queued" | "sent" | "failed";
export type CustomerMessage = {
  id: string;
  businessId: string;
  toEmail: string;
  subject: string;
  templateKey: string | null;
  status: MessageStatus;
  error: string | null;
  createdAt: string;
  sentByName: string | null; // staff member who sent it (resolved server-side)
};

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
    toEmail: String(r.to_email),
    subject: String(r.subject),
    templateKey: r.template_key == null ? null : String(r.template_key),
    status: String(r.status) as MessageStatus,
    error: r.error == null ? null : String(r.error),
    createdAt: String(r.created_at),
    sentByName: r.created_by_name == null ? null : String(r.created_by_name),
  }));
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
