-- Marketing: AI-drafted social content calendar (share-intent posting, no platform APIs).
-- APPLIES TO THE SHARED iTrova SUPABASE PROJECT (wnuyzsjhijhnhkpcnnqu).

-- Free-tier model config + keys, editable in the CRM (admin UI; staff-level RLS like the rest of cs_settings).
alter table public.cs_settings add column if not exists marketing_ai jsonb not null default '{}'::jsonb;

create table if not exists public.cs_social_post (
  id             uuid primary key default gen_random_uuid(),
  scheduled_date date not null,
  pillar         text not null default 'tip',
  caption        text not null,
  hashtags       text,
  card_text      text,  -- short hook rendered on the branded card image
  status         text not null default 'draft' check (status in ('draft','approved','posted','skipped')),
  posted_to      text[] not null default '{}',  -- platforms already shared to
  notes          text,
  created_by     uuid references auth.users(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists cs_social_post_date_idx on public.cs_social_post (scheduled_date);

alter table public.cs_social_post enable row level security;
drop policy if exists "staff full access" on public.cs_social_post;
create policy "staff full access" on public.cs_social_post for all to authenticated
  using (public.is_platform_admin()) with check (public.is_platform_admin());
revoke all on public.cs_social_post from anon;
grant select, insert, update, delete on public.cs_social_post to authenticated;

drop trigger if exists set_updated_at on public.cs_social_post;
create trigger set_updated_at before update on public.cs_social_post
  for each row execute function public.cs_set_updated_at();

notify pgrst, 'reload schema';
