import { supabase } from "@/integrations/supabase/client";

// Owner account activation (Customer detail). The resend-activation-email Edge Function resolves
// the owner and mints the link server-side; the browser passes only the business id.

export type ActivationState =
  | { kind: "activated"; at: string }
  | { kind: "pending" }
  | { kind: "no_email" };

export function activationState(ownerEmail: string | null, confirmedAt: string | null): ActivationState {
  if (!ownerEmail) return { kind: "no_email" };
  if (confirmedAt) return { kind: "activated", at: confirmedAt };
  return { kind: "pending" };
}

export async function resendActivationEmail(businessId: string, idempotencyKey: string): Promise<string> {
  const { data, error } = await supabase.functions.invoke<{ ok?: boolean; to_email?: string; error?: string }>(
    "resend-activation-email",
    { body: { business_id: businessId, idempotency_key: idempotencyKey } },
  );
  if (error) {
    if ((error as { name?: string }).name === "FunctionsFetchError" || /failed to send a request/i.test(error.message)) {
      throw new Error("Couldn't reach the activation function — deploy it: supabase functions deploy resend-activation-email");
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
  return data?.to_email ?? "";
}
