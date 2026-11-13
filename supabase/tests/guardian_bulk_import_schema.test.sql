begin;

select plan(10);

select has_table('public', 'guardian_import_batches', 'guardian import batches table exists');
select has_table('public', 'guardian_import_rows', 'guardian import rows table exists');

select ok(
  (select relrowsecurity from pg_class where oid = 'public.guardian_import_batches'::regclass),
  'guardian import batches has row-level security enabled'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.guardian_import_rows'::regclass),
  'guardian import rows has row-level security enabled'
);

select ok(
  not has_table_privilege('authenticated', 'public.guardian_import_batches', 'select'),
  'authenticated users cannot read guardian import batches directly'
);
select ok(
  not has_table_privilege('authenticated', 'public.guardian_import_rows', 'select'),
  'authenticated users cannot read guardian import rows directly'
);

select ok(
  has_function_privilege('authenticated', 'public.stage_guardian_import_batch(uuid,uuid,text,text,jsonb)', 'execute'),
  'authenticated users can invoke the guarded staging RPC'
);
select ok(
  not has_function_privilege('anon', 'public.stage_guardian_import_batch(uuid,uuid,text,text,jsonb)', 'execute'),
  'anonymous users cannot invoke the staging RPC'
);
select ok(
  has_function_privilege('authenticated', 'public.begin_guardian_import_approval(uuid)', 'execute'),
  'authenticated users can invoke the approval RPC'
);
select ok(
  not has_function_privilege('authenticated', 'public.guardian_import_recount(uuid)', 'execute'),
  'internal recount RPC is not exposed to authenticated users'
);

select * from finish();
rollback;
