// invite-staff — admin-gated Edge Function that GENERATES a staff invite link (no email sent).
// The admin copies the returned link and hands it to the new staff member, who opens it and sets
// their name + password on /set-password. The service-role key lives only here (never the browser).
//
// Deploy:  supabase functions deploy invite-staff
// (verify_jwt stays ON — only signed-in users can call it; we additionally require cs_is_admin.)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ROLES = ["admin", "cso", "pm", "support"];

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // 1) The caller must be an admin. Re-use their JWT against cs_is_admin().
    const caller = createClient(url, anon, {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    });
    const { data: isAdmin, error: roleErr } = await caller.rpc("cs_is_admin");
    if (roleErr) return json({ error: roleErr.message }, 401);
    if (isAdmin !== true) return json({ error: "Only an admin can invite staff." }, 403);

    const { email, role } = await req.json().catch(() => ({}));
    if (!email || typeof email !== "string") return json({ error: "An email is required." }, 400);
    if (!ROLES.includes(role)) return json({ error: "A valid role is required." }, 400);

    // 2) Generate an invite token (service role). We return the token_hash (not Supabase's verify
    //    URL) so the caller builds a link on its OWN domain; /set-password verifies it via
    //    verifyOtp(). The `invite_token` metadata flag makes iTrova's handle_new_user trigger skip
    //    business creation (this account is internal staff, not a tenant).
    const admin = createClient(url, service);
    let userId: string | undefined;
    let tokenHash: string | undefined;
    let linkType = "invite";

    const invite = await admin.auth.admin.generateLink({
      type: "invite",
      email,
      options: { data: { invite_token: "platform-staff" } },
    });
    if (invite.error) {
      // Most likely the user already exists (re-issuing a link for a pending invite). Fall back to
      // a magic link, which works for an existing account.
      const magic = await admin.auth.admin.generateLink({ type: "magiclink", email });
      if (magic.error) return json({ error: invite.error.message }, 400);
      userId = magic.data.user?.id;
      tokenHash = magic.data.properties?.hashed_token;
      linkType = "magiclink";
    } else {
      userId = invite.data.user?.id;
      tokenHash = invite.data.properties?.hashed_token;
    }
    if (!userId || !tokenHash) return json({ error: "Could not generate the invite." }, 500);

    // 3) Make them staff with the chosen role.
    const pa = await admin.from("platform_admins").upsert({ user_id: userId }, { onConflict: "user_id" });
    if (pa.error) return json({ error: pa.error.message }, 500);
    const sr = await admin.from("cs_staff_role").upsert({ user_id: userId, role }, { onConflict: "user_id" });
    if (sr.error) return json({ error: sr.error.message }, 500);

    return json({ token_hash: tokenHash, type: linkType, email });
  } catch (e) {
    return json({ error: (e as Error)?.message ?? "Unexpected error." }, 500);
  }
});
