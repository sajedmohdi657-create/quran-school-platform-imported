-- Restrict guardian bulk-import RPC execution to authenticated callers and
-- the trusted service role. Internal recounting remains service-role only.

begin;

revoke all on function public.guardian_import_recount(uuid)
  from public, anon, authenticated;
grant execute on function public.guardian_import_recount(uuid)
  to service_role;

revoke all on function public.stage_guardian_import_batch(uuid, uuid, text, text, jsonb)
  from public, anon;
grant execute on function public.stage_guardian_import_batch(uuid, uuid, text, text, jsonb)
  to authenticated, service_role;

revoke all on function public.begin_guardian_import_approval(uuid)
  from public, anon;
grant execute on function public.begin_guardian_import_approval(uuid)
  to authenticated, service_role;

revoke all on function public.finish_guardian_import_approval(uuid)
  from public, anon;
grant execute on function public.finish_guardian_import_approval(uuid)
  to authenticated, service_role;

revoke all on function public.fail_guardian_import_row(uuid, uuid, text)
  from public, anon;
grant execute on function public.fail_guardian_import_row(uuid, uuid, text)
  to authenticated, service_role;

revoke all on function public.finalize_guardian_import_row(uuid, uuid, uuid, text, text, boolean)
  from public, anon;
grant execute on function public.finalize_guardian_import_row(uuid, uuid, uuid, text, text, boolean)
  to authenticated, service_role;

revoke all on function public.get_guardian_import_batch(uuid)
  from public, anon;
grant execute on function public.get_guardian_import_batch(uuid)
  to authenticated, service_role;

revoke all on function public.list_guardian_import_rows(uuid)
  from public, anon;
grant execute on function public.list_guardian_import_rows(uuid)
  to authenticated, service_role;

revoke all on function public.rollback_guardian_import_batch(uuid)
  from public, anon;
grant execute on function public.rollback_guardian_import_batch(uuid)
  to authenticated, service_role;

commit;
