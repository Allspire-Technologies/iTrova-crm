-- Staff roles + capability enforcement (PRD §3). APPLIED TO THE SHARED iTrova PROJECT
-- (wnuyzsjhijhnhkpcnnqu). PART A of the role work: the role store, the capability matrix, and
-- role-aware RLS on the cs_* tables. PART B (a later migration) scopes the cross-tenant read
-- RPCs (Support → assigned-only) and gates revenue.
--
-- Roles: admin (Management) · cso · pm · support. Existing internal users (platform_admins) are
-- seeded as 'admin', and any platform_admin without an explicit role row is treated as 'admin',
-- so this is non-breaking. Only admins can change roles.

-- ---------------------------------------------------------------------------
-- 1. Role store.
-- ---------------------------------------------------------------------------
create table if not exists public.cs_staff_role (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  role       text not null check (role in ('admin', 'cso', 'pm', 'support')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists set_updated_at on public.cs_staff_role;
create trigger set_updated_at before update on public.cs_staff_role
  for each row execute function public.cs_set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. Capability helpers (SECURITY DEFINER so they read cs_staff_role regardless of RLS).
-- ---------------------------------------------------------------------------
-- Caller's effective role, or null if not internal staff. platform_admins without a row → admin.
create or replace function public.cs_my_role()
returns text
language sql stable security definer set search_path = public as $$
  select case
    when not public.is_platform_admin() then null
    else coalesce((select role from public.cs_staff_role where user_id = auth.uid()), 'admin')
  end;
$$;

create or replace function public.cs_is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select public.cs_my_role() = 'admin';
$$;

-- All-customer visibility (admin/cso/pm). Support sees only assigned customers.
create or replace function public.cs_sees_all()
returns boolean language sql stable security definer set search_path = public as $$
  select public.cs_my_role() in ('admin', 'cso', 'pm');
$$;

-- Revenue visibility (Management/Admin only).
create or replace function public.cs_sees_revenue()
returns boolean language sql stable security definer set search_path = public as $$
  select public.cs_my_role() = 'admin';
$$;

-- Can the caller see this business? All-seers always; support only if it's assigned to them.
create or replace function public.cs_can_see_business(p_business_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.cs_sees_all() or exists (
    select 1 from public.cs_account_assignment a
    where a.business_id = p_business_id and a.account_manager_id = auth.uid()
  );
$$;

-- Write capability matrix (PRD §3) — PURE (role in, boolean out) so it's directly testable.
create or replace function public.cs_role_can_write(p_role text, p_area text)
returns boolean language sql immutable as $$
  select case p_role
    when 'admin'   then true
    when 'cso'     then p_area in ('notes', 'tickets', 'tasks', 'pipeline', 'feedback', 'alerts')
    when 'pm'      then p_area in ('features', 'notes', 'feedback', 'alerts')
    when 'support' then p_area in ('tickets', 'notes', 'feedback', 'alerts')
    else false
  end;
$$;

-- Accessor: the caller's capability for an area.
create or replace function public.cs_can_write(p_area text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.cs_role_can_write(public.cs_my_role(), p_area);
$$;

grant execute on function public.cs_my_role() to authenticated;
grant execute on function public.cs_is_admin() to authenticated;
grant execute on function public.cs_sees_all() to authenticated;
grant execute on function public.cs_sees_revenue() to authenticated;
grant execute on function public.cs_can_see_business(uuid) to authenticated;
grant execute on function public.cs_role_can_write(text, text) to authenticated;
grant execute on function public.cs_can_write(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. RLS for cs_staff_role: any staff may read; only admins may change.
-- ---------------------------------------------------------------------------
alter table public.cs_staff_role enable row level security;
revoke all on public.cs_staff_role from anon;
grant select, insert, update, delete on public.cs_staff_role to authenticated;
drop policy if exists "staff read roles" on public.cs_staff_role;
create policy "staff read roles" on public.cs_staff_role for select to authenticated
  using (public.is_platform_admin());
drop policy if exists "admin manage roles" on public.cs_staff_role;
create policy "admin manage roles" on public.cs_staff_role for all to authenticated
  using (public.cs_is_admin()) with check (public.cs_is_admin());

-- ---------------------------------------------------------------------------
-- 4. Role-aware RLS on the cs_* tables (replaces the blanket "staff full access").
--    read  = cs_can_see_business(business_id)   [all-seers see all; support → assigned]
--    write = cs_can_write(<area>) AND visible
--    Settings + account assignment: read = any staff; write = admin.
-- ---------------------------------------------------------------------------

-- Business-scoped tables: <table, write-area>
do $$
declare
  rec record;
begin
  for rec in
    select * from (values
      ('cs_health_snapshot', null),     -- read-only to the app; writes are via SECURITY DEFINER
      ('cs_pipeline',        'pipeline'),
      ('cs_note',            'notes'),
      ('cs_ticket',          'tickets'),
      ('cs_feature_request', 'features'),
      ('cs_feedback',        'feedback'),
      ('cs_alert',           'alerts')
    ) as t(tbl, area)
  loop
    execute format('drop policy if exists "staff full access" on public.%I', rec.tbl);
    execute format('drop policy if exists "role read" on public.%I', rec.tbl);
    execute format('drop policy if exists "role write" on public.%I', rec.tbl);
    execute format(
      'create policy "role read" on public.%I for select to authenticated using (public.cs_can_see_business(business_id))',
      rec.tbl);
    if rec.area is not null then
      execute format(
        'create policy "role write" on public.%I for all to authenticated
           using (public.cs_can_write(%L) and public.cs_can_see_business(business_id))
           with check (public.cs_can_write(%L) and public.cs_can_see_business(business_id))',
        rec.tbl, rec.area, rec.area);
    end if;
  end loop;
end $$;

-- cs_task: business tasks are business-scoped; general tasks (business_id is null) are visible to
-- all staff. Writes need the 'tasks' capability.
drop policy if exists "staff full access" on public.cs_task;
drop policy if exists "role read" on public.cs_task;
drop policy if exists "role write" on public.cs_task;
create policy "role read" on public.cs_task for select to authenticated
  using (business_id is null or public.cs_can_see_business(business_id));
create policy "role write" on public.cs_task for all to authenticated
  using (public.cs_can_write('tasks') and (business_id is null or public.cs_can_see_business(business_id)))
  with check (public.cs_can_write('tasks') and (business_id is null or public.cs_can_see_business(business_id)));

-- cs_account_assignment: any staff reads; admin writes.
drop policy if exists "staff full access" on public.cs_account_assignment;
drop policy if exists "role read" on public.cs_account_assignment;
drop policy if exists "role write" on public.cs_account_assignment;
create policy "role read" on public.cs_account_assignment for select to authenticated
  using (public.is_platform_admin());
create policy "role write" on public.cs_account_assignment for all to authenticated
  using (public.cs_can_write('assignment')) with check (public.cs_can_write('assignment'));

-- cs_settings: any staff reads; admin writes.
drop policy if exists "staff full access" on public.cs_settings;
drop policy if exists "role read" on public.cs_settings;
drop policy if exists "role write" on public.cs_settings;
create policy "role read" on public.cs_settings for select to authenticated
  using (public.is_platform_admin());
create policy "role write" on public.cs_settings for all to authenticated
  using (public.cs_can_write('settings')) with check (public.cs_can_write('settings'));

-- ---------------------------------------------------------------------------
-- 5. Staff directory with roles (for the Settings role-management table).
-- ---------------------------------------------------------------------------
create or replace function public.admin_list_staff_roles()
returns table (user_id uuid, name text, email text, role text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  return query
  select
    pa.user_id,
    coalesce(pr.owner_name, au.raw_user_meta_data ->> 'full_name', au.raw_user_meta_data ->> 'name', au.email)::text,
    au.email::text,
    coalesce(sr.role, 'admin')
  from public.platform_admins pa
  join auth.users au on au.id = pa.user_id
  left join public.profiles pr on pr.id = pa.user_id
  left join public.cs_staff_role sr on sr.user_id = pa.user_id
  order by 2 nulls last;
end $$;
revoke all on function public.admin_list_staff_roles() from public;
grant execute on function public.admin_list_staff_roles() to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Seed: every current internal user becomes admin (non-breaking rollout).
-- ---------------------------------------------------------------------------
insert into public.cs_staff_role (user_id, role)
  select user_id, 'admin' from public.platform_admins
  on conflict (user_id) do nothing;
