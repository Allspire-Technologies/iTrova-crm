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
};

/** Merge fields available to templates + freeform. */
export type MergeVars = {
  business_name: string;
  owner_name: string;
  plan: string;
  renewal_date: string;
};

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

/** Past messages sent to a business (visibility-scoped by RLS), newest first. */
export async function listCustomerMessages(businessId: string): Promise<CustomerMessage[]> {
  const { data, error } = await supabase
    .from("cs_customer_message")
    .select("id, business_id, to_email, subject, template_key, status, error, created_at")
    .eq("business_id", businessId)
    .order("created_at", { ascending: false });
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
