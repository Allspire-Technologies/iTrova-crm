-- Tasks feature (PRD §7.7). APPLIED TO THE SHARED iTrova PROJECT (wnuyzsjhijhnhkpcnnqu).
--
-- §7.7 assigns tasks to one of three internal role-groups (Product Manager / Customer Success
-- Officer / Support Team). cs_task already has assignee_id (a specific staff user, kept for
-- later), but there is no staff-role concept yet, so we add assignee_role to capture the PRD's
-- role-based assignment. Also adds a staff-gated view that joins the business name for the
-- global queue (cs_task itself has no name).

-- ---------------------------------------------------------------------------
-- 1. Role-based assignment column.
-- ---------------------------------------------------------------------------
alter table public.cs_task
  add column if not exists assignee_role text
    check (assignee_role in ('pm', 'cso', 'support'));

create index if not exists cs_task_assignee_role_idx on public.cs_task (assignee_role);
create index if not exists cs_task_due_idx on public.cs_task (due_date);

-- ---------------------------------------------------------------------------
-- 2. Global queue view: every task + its business name. security_invoker so the
--    staff-only RLS on cs_task (and businesses) still applies to the caller.
-- ---------------------------------------------------------------------------
create or replace view public.cs_task_admin with (security_invoker = true) as
select
  t.id,
  t.business_id,
  b.name as business_name,
  t.title,
  t.type,
  t.assignee_role,
  t.assignee_id,
  t.created_by,
  t.due_date,
  t.status,
  t.created_at,
  t.updated_at,
  t.completed_at
from public.cs_task t
left join public.businesses b on b.id = t.business_id;

grant select on public.cs_task_admin to authenticated;
