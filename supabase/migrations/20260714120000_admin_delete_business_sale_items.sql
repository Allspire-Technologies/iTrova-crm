-- Fix: deleting a business failed with
--   "update or delete on table products violates foreign key constraint
--    sale_items_product_id_fkey on table sale_items"
-- APPLIED TO THE SHARED iTrova SUPABASE PROJECT (wnuyzsjhijhnhkpcnnqu).
--
-- Why: deleting a business cascades to its parent tables (products, sales, accounts,
-- journal_entries, …) via business_id ON DELETE CASCADE. Two grandchild FKs are NOT
-- cascade-friendly and trip when their parent is cascaded:
--   • sale_items.product_id     → products  (no action)   ← the reported error
--   • journal_lines.account_id  → accounts  (restrict)    ← the next one, for any
--                                                            business with ledger data
-- A schema-wide sweep shows these are the ONLY two non-cascade FKs (every other one is
-- CASCADE or SET NULL). sale_items and journal_lines both also cascade from their own
-- parent (sales / journal_entries), but the products / accounts cascade can run first,
-- so we clear these two grandchild sets up-front to unblock the whole delete.
--
-- We fix this in the RPC rather than switching those FKs to ON DELETE CASCADE: products
-- and accounts carry delete policies, and a cascade there would let a normal product or
-- account deletion silently wipe sale history / ledger lines (which Reports and the
-- financial statements derive from). This change is scoped to the delete-business path.

create or replace function public.admin_delete_business(p_business_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.cs_is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_business_id is null then
    raise exception 'business id required';
  end if;
  if not exists (select 1 from public.businesses where id = p_business_id) then
    raise exception 'business not found' using errcode = 'no_data_found';
  end if;

  -- profiles.business_id is a plain uuid (no FK) — detach members so no rows point at a dead business.
  update public.profiles set business_id = null where business_id = p_business_id;

  -- Clear the two grandchild tables whose FK into a cascaded parent isn't ON DELETE CASCADE,
  -- so the business cascade below doesn't trip on them.
  delete from public.sale_items
  where sale_id in (select id from public.sales where business_id = p_business_id);

  delete from public.journal_lines
  where entry_id in (select id from public.journal_entries where business_id = p_business_id);

  -- FK-linked tables cascade. This removes the business and its products, sales, invoices,
  -- accounts, journal entries, etc.
  delete from public.businesses where id = p_business_id;
end; $$;

revoke all on function public.admin_delete_business(uuid) from public, anon;
grant execute on function public.admin_delete_business(uuid) to authenticated;
