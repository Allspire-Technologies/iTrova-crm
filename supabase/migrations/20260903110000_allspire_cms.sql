-- Allspire website CMS: the proof and copy that allspire.tech renders (client logos, stats,
-- case studies, testimonials, team, page copy, webinar). Authored from the CRM's Allspire
-- section; the site reads PUBLISHED rows only. Separate as_* tables from iTrova's cms_* so the
-- two sites never share content by accident. Media uploads reuse the cms-media bucket under an
-- allspire/ prefix (same admin-only write policies).
-- APPLIES TO THE SHARED iTrova SUPABASE PROJECT (staging first, then wnuyzsjhijhnhkpcnnqu).

create table if not exists public.as_logo (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  logo_url text not null,
  website text,
  sort integer not null default 0,
  published boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.as_stat (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  value text not null,
  sort integer not null default 0,
  published boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.as_case_study (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  client text,
  industry text,
  summary text not null default '',
  challenge text,
  solution text,
  outcome text,
  cover_url text,
  body_md text not null default '',
  sort integer not null default 0,
  published boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.as_testimonial (
  id uuid primary key default gen_random_uuid(),
  quote text not null,
  name text not null,
  role text,
  company text,
  photo_url text,
  sort integer not null default 0,
  published boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.as_team_member (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  role text not null,
  bio text,
  photo_url text,
  linkedin text,
  sort integer not null default 0,
  published boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.as_copy (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  published boolean not null default false,
  updated_at timestamptz not null default now()
);

-- Single-row: the webinar programme (id is a boolean guard like referral_config).
create table if not exists public.as_webinar (
  id boolean primary key default true check (id),
  title text not null default 'From Notebook to Smart Business',
  schedule text not null default 'Every Saturday in 2026',
  time_label text not null default '7:00 PM WAT',
  registration_url text,
  facilitator_name text,
  facilitator_role text,
  facilitator_photo_url text,
  topics jsonb not null default '[]'::jsonb,
  published boolean not null default false,
  updated_at timestamptz not null default now()
);
-- Seeded from the webinar that is live on allspire.tech today, published so the site keeps showing it.
insert into public.as_webinar (id, registration_url, facilitator_name, facilitator_role, topics, published)
values (
  true,
  'https://docs.google.com/forms/d/e/1FAIpQLSexyMzM0NcME3yncE96mhcOOdYAW_H01BJ4SzbnR2gMUm25HA/viewform',
  'Samuel TosinPaul',
  'Digital Transformation Strategist and Co-Founder, Allspire Technologies',
  '["Track sales and expenses easily","Manage inventory without stress","Understand your business numbers","Keep customers coming back","Use AI and digital tools to grow faster","Build a business that runs beyond you"]'::jsonb,
  true
)
on conflict (id) do nothing;

create index if not exists as_case_study_industry_idx on public.as_case_study (industry);

-- Triggers (shared helpers from 20260625140000_cs_tables.sql).
do $$
declare t text;
begin
  foreach t in array array['as_logo','as_stat','as_case_study','as_testimonial','as_team_member'] loop
    execute format('drop trigger if exists set_updated_at on public.%I', t);
    execute format('create trigger set_updated_at before update on public.%I for each row execute function public.cs_set_updated_at()', t);
    execute format('drop trigger if exists set_created_by on public.%I', t);
    execute format('create trigger set_created_by before insert on public.%I for each row execute function public.cs_set_created_by()', t);
  end loop;
  foreach t in array array['as_copy','as_webinar'] loop
    execute format('drop trigger if exists set_updated_at on public.%I', t);
    execute format('create trigger set_updated_at before update on public.%I for each row execute function public.cs_set_updated_at()', t);
  end loop;
end $$;

-- RLS: public (anon + every app user) reads published rows; staff read all; CRM admins write.
do $$
declare t text;
begin
  foreach t in array array['as_logo','as_stat','as_case_study','as_testimonial','as_team_member','as_copy','as_webinar'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "as public read published" on public.%I', t);
    execute format('create policy "as public read published" on public.%I for select to anon, authenticated using (published = true or public.is_platform_admin())', t);
    execute format('drop policy if exists "as admin write" on public.%I', t);
    execute format('create policy "as admin write" on public.%I for all to authenticated using (public.cs_my_role() = ''admin'') with check (public.cs_my_role() = ''admin'')', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select on public.%I to anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;

notify pgrst, 'reload schema';
