-- Standalone sales leads (prospects) for the pipeline's Lead column. APPLIED TO THE SHARED iTrova
-- PROJECT (wnuyzsjhijhnhkpcnnqu).
--
-- Why: the pipeline's other 7 stages (registered..churned) are auto-derived from REAL businesses
-- (cs_auto_stage). 'lead' was manual-only, so the only way a card landed in Lead was a business
-- someone dragged in — which pinned it (stage_source='manual') and FROZE that business's onboarding
-- auto-tracking. This table makes Lead a standalone prospect list, decoupled from businesses, so the
-- two never interfere. A lead that signs up is marked 'converted' (optionally linked to the new
-- business_id) and then flows into 'registered' via the normal auto-derivation.
--
-- All fields are optional (a lead may be just a name, or just a phone number).

create table if not exists public.cs_lead (
  id            uuid primary key default gen_random_uuid(),
  name          text,
  contact_name  text,
  contact_email text,
  contact_phone text,
  source        text,
  notes         text,
  status        text not null default 'open' check (status in ('open','converted','lost')),
  business_id   uuid references public.businesses(id) on delete set null,  -- set on conversion
  created_by    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists cs_lead_status_idx on public.cs_lead (status, created_at desc);

-- Reuse the shared cs_* trigger helpers (20260625140000): stamp updated_at + created_by.
drop trigger if exists set_updated_at on public.cs_lead;
create trigger set_updated_at before update on public.cs_lead
  for each row execute function public.cs_set_updated_at();
drop trigger if exists set_created_by on public.cs_lead;
create trigger set_created_by before insert on public.cs_lead
  for each row execute function public.cs_set_created_by();

-- RLS: internal staff only (read + write), matching every other cs_* table.
alter table public.cs_lead enable row level security;
drop policy if exists "staff full access" on public.cs_lead;
create policy "staff full access" on public.cs_lead for all to authenticated
  using (public.is_platform_admin()) with check (public.is_platform_admin());
revoke all on public.cs_lead from anon;
grant select, insert, update, delete on public.cs_lead to authenticated;

-- Free any business previously PINNED into the Lead column: re-derive its real stage so the
-- standalone Lead list no longer mixes with businesses. (auto-derivation never produces 'lead'.)
update public.cs_pipeline
   set stage = public.cs_auto_stage(business_id), stage_source = 'auto', updated_at = now()
 where stage = 'lead';
