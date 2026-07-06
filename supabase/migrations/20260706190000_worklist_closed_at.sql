-- Worklist: expose WHEN an item was closed, so the UI can archive old closed items.
-- APPLIED TO THE SHARED iTrova PROJECT (wnuyzsjhijhnhkpcnnqu).
--
-- Done/Shipped/Resolved/Closed items should drop out of the Worklist and Tasks views 7 days
-- after they were closed (still reachable via an explicit "Archived" filter — nothing is
-- deleted). The view previously exposed no closure timestamp, so the client had nothing to
-- age against. Add closed_at per kind:
--   ticket  → resolved_at (falls back to updated_at for closed-without-resolving)
--   feature → updated_at (status changes bump it)
--   task    → completed_at (falls back to updated_at)
--   note/feedback → null (no status, never archived)
-- CREATE OR REPLACE VIEW appends the new column at the end, so existing readers are unaffected.
-- The 7-day window itself lives in the client (lib/worklist.ts) next to the status grouping.

create or replace view public.cs_worklist_admin with (security_invoker = true) as
  select
    'note'::text        as kind,
    n.id                as id,
    n.business_id       as business_id,
    b.name              as business_name,
    n.body              as title,
    null::text          as status,
    null::text          as priority,
    n.type              as sub_type,
    null::int           as rating,
    null::int           as votes,
    null::date          as due_date,
    null::text          as assignee_role,
    n.created_at        as created_at,
    null::timestamptz   as closed_at
  from public.cs_note n
  left join public.businesses b on b.id = n.business_id
  union all
  select 'ticket', t.id, t.business_id, b.name, t.title, t.status, t.priority,
         null, null, null, null, null, t.created_at,
         coalesce(t.resolved_at, t.updated_at)
  from public.cs_ticket t
  left join public.businesses b on b.id = t.business_id
  union all
  select 'feature', f.id, f.business_id, b.name, f.title, f.status, null,
         null, null, f.votes, null, null, f.created_at,
         f.updated_at
  from public.cs_feature_request f
  left join public.businesses b on b.id = f.business_id
  union all
  select 'feedback', fb.id, fb.business_id, b.name, fb.body, null, null,
         null, fb.rating, null, null, null, fb.created_at,
         null::timestamptz
  from public.cs_feedback fb
  left join public.businesses b on b.id = fb.business_id
  union all
  select 'task', tk.id, tk.business_id, b.name, tk.title, tk.status, null,
         tk.type, null, null, tk.due_date, tk.assignee_role, tk.created_at,
         coalesce(tk.completed_at, tk.updated_at)
  from public.cs_task tk
  left join public.businesses b on b.id = tk.business_id;

grant select on public.cs_worklist_admin to authenticated;
