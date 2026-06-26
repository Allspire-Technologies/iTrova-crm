-- Capability-matrix tests (PRD §3). Run in the Supabase SQL editor or via psql AFTER applying
-- 20260625240000_staff_roles.sql. Exercises the pure cs_role_can_write(role, area); raises on
-- mismatch, NOTICE per pass.

do $$
declare ok boolean;
begin
  -- Admin can write everything.
  foreach ok in array array[
    public.cs_role_can_write('admin','settings'),
    public.cs_role_can_write('admin','assignment'),
    public.cs_role_can_write('admin','pipeline'),
    public.cs_role_can_write('admin','features')
  ] loop
    assert ok, 'admin should be able to write everything';
  end loop;

  -- CSO: notes/tickets/tasks/pipeline/feedback/alerts yes; settings/assignment/features no.
  assert public.cs_role_can_write('cso','tasks'), 'cso can write tasks';
  assert public.cs_role_can_write('cso','pipeline'), 'cso can move pipeline';
  assert not public.cs_role_can_write('cso','settings'), 'cso cannot tune settings';
  assert not public.cs_role_can_write('cso','assignment'), 'cso cannot assign managers';
  assert not public.cs_role_can_write('cso','features'), 'cso does not triage features';

  -- PM: features + notes/feedback; not tickets/tasks/pipeline.
  assert public.cs_role_can_write('pm','features'), 'pm triages features';
  assert public.cs_role_can_write('pm','notes'), 'pm can note';
  assert not public.cs_role_can_write('pm','tickets'), 'pm does not work tickets';
  assert not public.cs_role_can_write('pm','pipeline'), 'pm does not move pipeline';
  assert not public.cs_role_can_write('pm','settings'), 'pm cannot tune settings';

  -- Support: tickets/notes/feedback/alerts; not tasks/pipeline/features/settings.
  assert public.cs_role_can_write('support','tickets'), 'support works tickets';
  assert public.cs_role_can_write('support','notes'), 'support logs calls/notes';
  assert not public.cs_role_can_write('support','tasks'), 'support does not manage tasks';
  assert not public.cs_role_can_write('support','features'), 'support does not triage features';
  assert not public.cs_role_can_write('support','assignment'), 'support cannot assign managers';

  -- Unknown / no role: nothing.
  assert not public.cs_role_can_write('nobody','notes'), 'unknown role writes nothing';

  raise notice 'All staff-role capability test cases passed.';
end $$;
