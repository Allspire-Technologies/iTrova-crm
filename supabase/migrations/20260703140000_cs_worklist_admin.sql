-- Holistic worklist: everything captured in a customer's "Notes & CRM" section (notes, tickets,
-- feature requests, feedback, tasks) unified into one shape and joined to the business name, so the
-- team can see it all in one place and update status. Mirrors cs_task_admin's approach.
--
-- security_invoker = true so the staff-only RLS on each cs_* table (and businesses) still gates the
-- caller — this view grants no extra visibility of its own.
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
    n.created_at        as created_at
  from public.cs_note n
  left join public.businesses b on b.id = n.business_id
  union all
  select 'ticket', t.id, t.business_id, b.name, t.title, t.status, t.priority,
         null, null, null, null, null, t.created_at
  from public.cs_ticket t
  left join public.businesses b on b.id = t.business_id
  union all
  select 'feature', f.id, f.business_id, b.name, f.title, f.status, null,
         null, null, f.votes, null, null, f.created_at
  from public.cs_feature_request f
  left join public.businesses b on b.id = f.business_id
  union all
  select 'feedback', fb.id, fb.business_id, b.name, fb.body, null, null,
         null, fb.rating, null, null, null, fb.created_at
  from public.cs_feedback fb
  left join public.businesses b on b.id = fb.business_id
  union all
  select 'task', tk.id, tk.business_id, b.name, tk.title, tk.status, null,
         tk.type, null, null, tk.due_date, tk.assignee_role, tk.created_at
  from public.cs_task tk
  left join public.businesses b on b.id = tk.business_id;

grant select on public.cs_worklist_admin to authenticated;
