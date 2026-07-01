// execute-plan-change — the ONLY path that applies a business plan change. Dual-control: the
// requesting admin submits { request_id, password, code }; we (1) confirm the caller is an admin,
// (2) re-verify their password server-side, then (3) hand off to admin_apply_plan_change (service
// role) which enforces the two-person invariant (approved by a DIFFERENT admin), the one-time code
// and its TTL, and finally writes businesses.subscription_tier. The service-role key lives only
// here (never the browser), and admin_apply_plan_change is service_role-only, so the password check
// can't be skipped.
//
// Deploy:  supabase functions deploy execute-plan-change
// (verify_jwt stays ON — only signed-in users can call it; we additionally require cs_is_admin.)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
    if (isAdmin !== true) return json({ error: "Only an admin can change a plan." }, 403);

    const { request_id, password, code } = await req.json().catch(() => ({}));
    if (!request_id || typeof request_id !== "string") return json({ error: "A request id is required." }, 400);
    if (!password || typeof password !== "string") return json({ error: "Your password is required." }, 400);
    if (!code || typeof code !== "string") return json({ error: "The approval code is required." }, 400);

    // 2) Re-verify the caller's password. Identify them from their JWT, then sign in on a throwaway
    //    client (no shared session) — success proves they entered their current password.
    const { data: userData, error: userErr } = await caller.auth.getUser();
    const email = userData?.user?.email;
    const actorId = userData?.user?.id;
    if (userErr || !email || !actorId) return json({ error: "Could not identify the signed-in user." }, 401);

    const verifier = createClient(url, anon);
    const { error: pwErr } = await verifier.auth.signInWithPassword({ email, password });
    if (pwErr) return json({ error: "Password is incorrect." }, 401);

    // 3) Enforce the dual-control invariant + apply the change (service role).
    const admin = createClient(url, service);
    const { data: result, error: applyErr } = await admin.rpc("admin_apply_plan_change", {
      p_request_id: request_id,
      p_code: code,
      p_actor: actorId,
    });
    if (applyErr) return json({ error: applyErr.message }, 500);
    if (!result?.ok) return json({ error: result?.error ?? "Couldn't apply the plan change." }, 400);

    return json({ ok: true, to_tier: result.to_tier });
  } catch (e) {
    return json({ error: (e as Error)?.message ?? "Unexpected error." }, 500);
  }
});
