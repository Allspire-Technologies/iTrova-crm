import { createClient } from "@supabase/supabase-js";

// Same Supabase project as iTrova (shared DB). Publishable/anon key only — never the
// service-role key. Privileged cross-tenant writes go through Edge Functions.
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    storage: localStorage,
    persistSession: true,
    autoRefreshToken: true,
  },
});
