-- Dashboard-owned CRM / Customer-Success tables. APPLIED TO THE SHARED iTrova PROJECT (wnuyzsjhijhnhkpcnnqu).
--
-- PRD §6.2. These do not exist in operational iTrova. PRD §6.2 sanctions either a dedicated
-- schema OR the `cs_` prefix; we use the `cs_` prefix in `public` so PostgREST serves them
-- without an extra "exposed schemas" config step, matching the verbatim PRD SQL.
--
-- Every table: uuid PK (gen_random_uuid()), timestamptz created_at/updated_at, RLS that
-- restricts ALL access to internal staff (is_platform_admin()), and FKs to the real
-- iTrova tables (public.businesses, auth.users). Author/created_by on notes/tickets/
-- tasks/feature-requests/feedback is stamped server-side from auth.uid() (tamper-proof audit).

-- ---------------------------------------------------------------------------
-- Shared trigger helpers
-- ---------------------------------------------------------------------------
create or replace function public.cs_set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

create or replace function public.cs_set_author_id()
returns trigger language plpgsql as $$
begin new.author_id = auth.uid(); return new; end $$;

create or replace function public.cs_set_created_by()
returns trigger language plpgsql as $$
begin new.created_by = auth.uid(); return new; end $$;

-- ===========================================================================
-- cs_account_assignment — one account manager per business
-- ===========================================================================
create table if not exists public.cs_account_assignment (
  business_id        uuid primary key references public.businesses(id) on delete cascade,
  account_manager_id uuid references auth.users(id) on delete set null,
  assigned_at        timestamptz not null default now(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- ===========================================================================
-- cs_health_snapshot — daily health score (trend history)
-- ===========================================================================
create table if not exists public.cs_health_snapshot (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  score       int not null check (score between 0 and 100),
  band        text not null check (band in ('green','yellow','red')),
  reasons     jsonb not null default '[]'::jsonb,
  captured_at timestamptz not null default now(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists cs_health_snapshot_business_captured_idx
  on public.cs_health_snapshot (business_id, captured_at desc);

-- ===========================================================================
-- cs_pipeline — current stage per business, with manual-override source
-- ===========================================================================
create table if not exists public.cs_pipeline (
  business_id  uuid primary key references public.businesses(id) on delete cascade,
  stage        text not null
    check (stage in ('lead','registered','subscribed','onboarding','active','power_user','renewed','churned')),
  stage_source text not null default 'auto' check (stage_source in ('auto','manual')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- ===========================================================================
-- cs_note — CRM / meeting notes
-- ===========================================================================
create table if not exists public.cs_note (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  author_id   uuid references auth.users(id) on delete set null,
  type        text not null default 'general' check (type in ('meeting','call','general')),
  body        text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists cs_note_business_idx on public.cs_note (business_id, created_at desc);

-- ===========================================================================
-- cs_ticket — support tickets
-- ===========================================================================
create table if not exists public.cs_ticket (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  title       text not null,
  status      text not null default 'open' check (status in ('open','in_progress','resolved','closed')),
  priority    text not null default 'med' check (priority in ('low','med','high','urgent')),
  assignee_id uuid references auth.users(id) on delete set null,
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  resolved_at timestamptz
);
create index if not exists cs_ticket_business_idx on public.cs_ticket (business_id);
create index if not exists cs_ticket_status_idx on public.cs_ticket (status);
create index if not exists cs_ticket_assignee_idx on public.cs_ticket (assignee_id);

-- ===========================================================================
-- cs_feature_request
-- ===========================================================================
create table if not exists public.cs_feature_request (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  title       text not null,
  detail      text,
  status      text not null default 'new' check (status in ('new','planned','shipped','declined')),
  votes       int not null default 1,
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists cs_feature_request_business_idx on public.cs_feature_request (business_id);
create index if not exists cs_feature_request_status_idx on public.cs_feature_request (status);

-- ===========================================================================
-- cs_feedback — CSAT / free-text
-- ===========================================================================
create table if not exists public.cs_feedback (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  rating      int check (rating between 1 and 5),
  body        text,
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists cs_feedback_business_idx on public.cs_feedback (business_id);

-- ===========================================================================
-- cs_task — customer-success tasks (business-scoped or general)
-- ===========================================================================
create table if not exists public.cs_task (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid references public.businesses(id) on delete cascade,
  title        text not null,
  type         text not null default 'follow_up' check (type in ('call','meeting','follow_up','renewal')),
  assignee_id  uuid references auth.users(id) on delete set null,
  created_by   uuid references auth.users(id) on delete set null,
  due_date     date,
  status       text not null default 'todo' check (status in ('todo','doing','done')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists cs_task_business_idx on public.cs_task (business_id);
create index if not exists cs_task_assignee_idx on public.cs_task (assignee_id);
create index if not exists cs_task_status_idx on public.cs_task (status);

-- ===========================================================================
-- cs_alert — workflow alerts from the health/alert engine
-- ===========================================================================
create table if not exists public.cs_alert (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null references public.businesses(id) on delete cascade,
  kind            text not null check (kind in ('onboarding','adoption','churn','renewal')),
  severity        text not null check (severity in ('warning','critical')),
  detail          text,
  status          text not null default 'active' check (status in ('active','acknowledged','resolved')),
  acknowledged_by uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  resolved_at     timestamptz
);
create index if not exists cs_alert_business_idx on public.cs_alert (business_id);
create index if not exists cs_alert_status_idx on public.cs_alert (status);

-- ---------------------------------------------------------------------------
-- updated_at triggers (all tables)
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'cs_account_assignment','cs_health_snapshot','cs_pipeline','cs_note','cs_ticket',
    'cs_feature_request','cs_feedback','cs_task','cs_alert'
  ] loop
    execute format('drop trigger if exists set_updated_at on public.%I', t);
    execute format(
      'create trigger set_updated_at before update on public.%I for each row execute function public.cs_set_updated_at()', t);
  end loop;
end $$;

-- Tamper-proof audit author on insert.
drop trigger if exists set_author_id on public.cs_note;
create trigger set_author_id before insert on public.cs_note
  for each row execute function public.cs_set_author_id();

do $$
declare t text;
begin
  foreach t in array array['cs_ticket','cs_feature_request','cs_feedback','cs_task'] loop
    execute format('drop trigger if exists set_created_by on public.%I', t);
    execute format(
      'create trigger set_created_by before insert on public.%I for each row execute function public.cs_set_created_by()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- RLS: internal staff only (read + write), for every cs_* table.
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'cs_account_assignment','cs_health_snapshot','cs_pipeline','cs_note','cs_ticket',
    'cs_feature_request','cs_feedback','cs_task','cs_alert'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "staff full access" on public.%I', t);
    execute format(
      'create policy "staff full access" on public.%I for all to authenticated
         using (public.is_platform_admin()) with check (public.is_platform_admin())', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;
