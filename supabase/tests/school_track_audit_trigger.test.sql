begin;

select plan(5);

select ok(
  not has_function_privilege('authenticated', 'public.audit_school_track_result()', 'execute'),
  'authenticated users cannot invoke the audit trigger as an RPC'
);
select ok(
  not has_function_privilege('anon', 'public.audit_school_track_result()', 'execute'),
  'anonymous users cannot invoke the audit trigger'
);
select ok(
  exists (
    select 1
    from pg_trigger
    where tgfoid = 'public.audit_school_track_result()'::regprocedure
      and tgrelid = 'public.school_track_results'::regclass
      and not tgisinternal
  ),
  'audit function remains attached to the school result trigger'
);
select ok(
  (select prosecdef from pg_proc where oid = 'public.audit_school_track_result()'::regprocedure),
  'audit trigger retains its security-definer execution context'
);
select ok(
  (select proconfig @> array['search_path=""']::text[]
   from pg_proc where oid = 'public.audit_school_track_result()'::regprocedure),
  'audit trigger pins an empty search_path'
);

select * from finish();
rollback;
