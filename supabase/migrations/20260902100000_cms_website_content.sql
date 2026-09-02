-- Website CMS: content the itrova marketing site reads and CRM staff author from the new
-- /website console (changelog, blog posts, testimonials, guide sections, landing copy), plus
-- the first Storage bucket (cms-media) for blog covers.
-- Access model: the PUBLIC (anon + app users) reads PUBLISHED rows only; CRM admins write.
-- APPLIES TO THE SHARED iTrova SUPABASE PROJECT (wnuyzsjhijhnhkpcnnqu).

create table if not exists public.cms_changelog (
  id uuid primary key default gen_random_uuid(),
  entry_date text not null,
  title text not null,
  tag text check (tag in ('New', 'Improved')),
  items jsonb not null default '[]'::jsonb,
  published boolean not null default false,
  sort integer not null default 0,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.cms_post (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  excerpt text,
  body_md text not null default '',
  cover_url text,
  tags text[] not null default '{}',
  author text,
  published_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.cms_testimonial (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  business text not null,
  quote text not null,
  published boolean not null default false,
  sort integer not null default 0,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.cms_guide_section (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  summary text not null default '',
  roles text[] not null default '{}',
  steps jsonb not null default '[]'::jsonb,
  tip text,
  figures jsonb not null default '[]'::jsonb,
  published boolean not null default false,
  sort integer not null default 0,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.cms_copy (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  published boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table public.cms_copy add column if not exists published boolean not null default false;

create index if not exists cms_post_published_at_idx on public.cms_post (published_at desc);
create index if not exists cms_changelog_sort_idx on public.cms_changelog (sort desc, entry_date desc);

-- updated_at + created_by triggers (shared helpers from 20260625140000_cs_tables.sql).
drop trigger if exists set_updated_at on public.cms_changelog;
create trigger set_updated_at before update on public.cms_changelog
  for each row execute function public.cs_set_updated_at();
drop trigger if exists set_created_by on public.cms_changelog;
create trigger set_created_by before insert on public.cms_changelog
  for each row execute function public.cs_set_created_by();

drop trigger if exists set_updated_at on public.cms_post;
create trigger set_updated_at before update on public.cms_post
  for each row execute function public.cs_set_updated_at();
drop trigger if exists set_created_by on public.cms_post;
create trigger set_created_by before insert on public.cms_post
  for each row execute function public.cs_set_created_by();

drop trigger if exists set_updated_at on public.cms_testimonial;
create trigger set_updated_at before update on public.cms_testimonial
  for each row execute function public.cs_set_updated_at();
drop trigger if exists set_created_by on public.cms_testimonial;
create trigger set_created_by before insert on public.cms_testimonial
  for each row execute function public.cs_set_created_by();

drop trigger if exists set_updated_at on public.cms_guide_section;
create trigger set_updated_at before update on public.cms_guide_section
  for each row execute function public.cs_set_updated_at();
drop trigger if exists set_created_by on public.cms_guide_section;
create trigger set_created_by before insert on public.cms_guide_section
  for each row execute function public.cs_set_created_by();

drop trigger if exists set_updated_at on public.cms_copy;
create trigger set_updated_at before update on public.cms_copy
  for each row execute function public.cs_set_updated_at();

-- RLS: public reads published rows only; the shared project's `authenticated` role includes
-- every iTrova app user, so they get the same published-only view; staff read everything;
-- CRM admins write.
alter table public.cms_changelog enable row level security;
drop policy if exists "cms public read published" on public.cms_changelog;
create policy "cms public read published" on public.cms_changelog for select to anon, authenticated
  using (published = true or public.is_platform_admin());
drop policy if exists "cms admin write" on public.cms_changelog;
create policy "cms admin write" on public.cms_changelog for all to authenticated
  using (public.cs_my_role() = 'admin') with check (public.cs_my_role() = 'admin');
revoke all on public.cms_changelog from anon;
grant select on public.cms_changelog to anon;
grant select, insert, update, delete on public.cms_changelog to authenticated;

alter table public.cms_post enable row level security;
drop policy if exists "cms public read published" on public.cms_post;
create policy "cms public read published" on public.cms_post for select to anon, authenticated
  using ((published_at is not null and published_at <= now()) or public.is_platform_admin());
drop policy if exists "cms admin write" on public.cms_post;
create policy "cms admin write" on public.cms_post for all to authenticated
  using (public.cs_my_role() = 'admin') with check (public.cs_my_role() = 'admin');
revoke all on public.cms_post from anon;
grant select on public.cms_post to anon;
grant select, insert, update, delete on public.cms_post to authenticated;

alter table public.cms_testimonial enable row level security;
drop policy if exists "cms public read published" on public.cms_testimonial;
create policy "cms public read published" on public.cms_testimonial for select to anon, authenticated
  using (published = true or public.is_platform_admin());
drop policy if exists "cms admin write" on public.cms_testimonial;
create policy "cms admin write" on public.cms_testimonial for all to authenticated
  using (public.cs_my_role() = 'admin') with check (public.cs_my_role() = 'admin');
revoke all on public.cms_testimonial from anon;
grant select on public.cms_testimonial to anon;
grant select, insert, update, delete on public.cms_testimonial to authenticated;

alter table public.cms_guide_section enable row level security;
drop policy if exists "cms public read published" on public.cms_guide_section;
create policy "cms public read published" on public.cms_guide_section for select to anon, authenticated
  using (published = true or public.is_platform_admin());
drop policy if exists "cms admin write" on public.cms_guide_section;
create policy "cms admin write" on public.cms_guide_section for all to authenticated
  using (public.cs_my_role() = 'admin') with check (public.cs_my_role() = 'admin');
revoke all on public.cms_guide_section from anon;
grant select on public.cms_guide_section to anon;
grant select, insert, update, delete on public.cms_guide_section to authenticated;

alter table public.cms_copy enable row level security;
drop policy if exists "cms copy public read" on public.cms_copy;
create policy "cms copy public read" on public.cms_copy for select to anon, authenticated
  using (published = true or public.is_platform_admin());
drop policy if exists "cms admin write" on public.cms_copy;
create policy "cms admin write" on public.cms_copy for all to authenticated
  using (public.cs_my_role() = 'admin') with check (public.cs_my_role() = 'admin');
revoke all on public.cms_copy from anon;
grant select on public.cms_copy to anon;
grant select, insert, update, delete on public.cms_copy to authenticated;

-- First Storage use in the stack: a public-read bucket for blog covers and future CMS media.
-- Size/type limits are enforced by the bucket itself, not just the console's client check;
-- the update keeps an already-created bucket (staging) in line on re-apply.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('cms-media', 'cms-media', true, 5242880, array['image/png','image/jpeg','image/webp','image/avif'])
on conflict (id) do nothing;
update storage.buckets
set file_size_limit = 5242880,
    allowed_mime_types = array['image/png','image/jpeg','image/webp','image/avif']
where id = 'cms-media';

drop policy if exists "cms media public read" on storage.objects;
create policy "cms media public read" on storage.objects for select to anon, authenticated
  using (bucket_id = 'cms-media');
drop policy if exists "cms media admin write" on storage.objects;
create policy "cms media admin write" on storage.objects for insert to authenticated
  with check (bucket_id = 'cms-media' and public.cs_my_role() = 'admin');
drop policy if exists "cms media admin update" on storage.objects;
create policy "cms media admin update" on storage.objects for update to authenticated
  using (bucket_id = 'cms-media' and public.cs_my_role() = 'admin');
drop policy if exists "cms media admin delete" on storage.objects;
create policy "cms media admin delete" on storage.objects for delete to authenticated
  using (bucket_id = 'cms-media' and public.cs_my_role() = 'admin');

notify pgrst, 'reload schema';
