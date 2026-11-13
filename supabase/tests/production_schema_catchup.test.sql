begin;

select plan(14);

select has_table('public', 'school_track_results', 'school track results table exists');
select has_table('public', 'school_track_result_history', 'school track audit history table exists');
select has_table('public', 'student_guardians', 'guardian relationship table exists');

select has_column('public', 'student_guardians', 'guardian_name_override', 'guardian name override column exists');
select has_column('public', 'student_guardians', 'guardian_phone_override', 'guardian phone override column exists');
select has_column('public', 'student_guardians', 'guardian_phone_override_set', 'guardian phone override flag exists');
select has_column('public', 'registration_leads', 'education_level', 'registration education level column exists');
select has_column('public', 'registration_leads', 'previous_memorization_outcome', 'previous memorization outcome column exists');

select ok(to_regprocedure('public.can_access_school_track_class(uuid,uuid,uuid,text)') is not null, 'school-track authorization helper exists');
select ok(to_regprocedure('public.update_student_guardian_link(uuid,uuid,text,text,text,boolean)') is not null, 'guardian relationship update RPC exists');
select ok(to_regprocedure('public.create_registration_lead_with_details(uuid,uuid,text,text,date,text,text,text,timestamptz,text,text,text)') is not null, 'registration creation RPC exists');
select ok(to_regprocedure('public.update_registration_lead_student_details(uuid,date,text,text)') is not null, 'registration student details update RPC exists');

select ok((select relrowsecurity from pg_class where oid = 'public.school_track_results'::regclass), 'school track results has RLS enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.school_track_result_history'::regclass), 'school track history has RLS enabled');

select * from finish();
rollback;
