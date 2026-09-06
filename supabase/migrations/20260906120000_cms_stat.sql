-- Home-page statistics for itrova.co (a strip of up to four real figures under the hero). Same
-- shape and policies as cms_testimonial: staff author rows in the CRM Website console, the site
-- reads PUBLISHED rows only, and the strip stays hidden until one is published.
-- APPLIES TO THE SHARED iTrova SUPABASE PROJECT (staging first, then wnuyzsjhijhnhkpcnnqu).

create table if not exists public.cms_stat (
  id uuid primary key default gen_random_uuid(),
  value text not null,
  label text not null,
  sort integer not null default 0,
  published boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists set_updated_at on public.cms_stat;
create trigger set_updated_at before update on public.cms_stat
  for each row execute function public.cs_set_updated_at();
drop trigger if exists set_created_by on public.cms_stat;
create trigger set_created_by before insert on public.cms_stat
  for each row execute function public.cs_set_created_by();

alter table public.cms_stat enable row level security;
drop policy if exists "cms public read published" on public.cms_stat;
create policy "cms public read published" on public.cms_stat for select to anon, authenticated
  using (published = true or public.is_platform_admin());
drop policy if exists "cms admin write" on public.cms_stat;
create policy "cms admin write" on public.cms_stat for all to authenticated
  using (public.cs_my_role() = 'admin') with check (public.cs_my_role() = 'admin');
revoke all on public.cms_stat from anon;
grant select on public.cms_stat to anon;
grant select, insert, update, delete on public.cms_stat to authenticated;

notify pgrst, 'reload schema';
