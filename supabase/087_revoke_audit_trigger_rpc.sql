-- Trigger-only audit function must not be exposed as an authenticated RPC.
begin;

revoke all on function public.audit_school_track_result()
  from public, anon, authenticated;

commit;
