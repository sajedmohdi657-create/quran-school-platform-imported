\set ON_ERROR_STOP on

-- A school administrator can create an explicitly assigned target.
select set_config('request.jwt.claim.sub','30000000-0000-4000-8000-000000000003',false);
select public.create_learning_follow_up_target(
  '10000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  '21000000-0000-4000-8000-000000000001',
  '70000000-0000-4000-8000-000000000001',
  'new_memorization', 1, 1, 4, current_date, '50000000-0000-4000-8000-000000000001', 'اختبار التكليف'
);

insert into public.attendance_sessions(id,school_id,branch_id,class_id,session_date)
values ('90000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  '21000000-0000-4000-8000-000000000001', current_date);

insert into public.attendance_records(id,school_id,branch_id,class_id,session_id,student_id,status)
values ('91000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  '21000000-0000-4000-8000-000000000001',
  '90000000-0000-4000-8000-000000000001',
  '70000000-0000-4000-8000-000000000001','absent');

-- Future-dated sessions must not count as an absence or trigger an alert.
insert into public.attendance_sessions(id,school_id,branch_id,class_id,session_date)
values ('90000000-0000-4000-8000-000000000002',
  '10000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  '21000000-0000-4000-8000-000000000001', current_date + 1);

insert into public.attendance_records(id,school_id,branch_id,class_id,session_id,student_id,status)
values ('91000000-0000-4000-8000-000000000002',
  '10000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  '21000000-0000-4000-8000-000000000001',
  '90000000-0000-4000-8000-000000000002',
  '70000000-0000-4000-8000-000000000001','absent');

do $$
declare report jsonb;
begin
  report := public.get_learning_follow_up_dashboard(
    '10000000-0000-4000-8000-000000000001',
    null,null,null,current_date,current_date,50
  );
  if (report #>> '{overview,assigned_count}')::int <> 1 then
    raise exception 'expected one assigned target: %', report;
  end if;
  if (report #>> '{overview,not_completed_count}')::int <> 1 then
    raise exception 'target without success must remain incomplete: %', report;
  end if;
  if (report #>> '{overview,not_memorized_count}')::int <> 1 then
    raise exception 'new memorization target should appear in not memorized count: %', report;
  end if;
  if (report #>> '{overview,absence_count}')::int <> 1 then
    raise exception 'expected one absence: %', report;
  end if;
end;
$$;

-- A teacher cannot assign a target to another teacher's identity.
select set_config('request.jwt.claim.sub','30000000-0000-4000-8000-000000000001',false);
do $
begin
  perform public.create_learning_follow_up_target(
    '10000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',
    '21000000-0000-4000-8000-000000000001',
    '70000000-0000-4000-8000-000000000001',
    'revision', 1, 5, 7, current_date,
    '50000000-0000-4000-8000-000000000005', null
  );
  raise exception 'teacher must not assign a target to another teacher';
exception when sqlstate '42501' then
  null;
end;
$;
select set_config('request.jwt.claim.sub','30000000-0000-4000-8000-000000000003',false);

do $
begin
  perform public.get_learning_follow_up_dashboard(
    '10000000-0000-4000-8000-000000000001',
    null,null,null,current_date,current_date,null
  );
  raise exception 'dashboard must reject a null row limit';
exception when sqlstate '22023' then
  null;
end;
$;

-- A successful, exact-range memorization result completes the assigned target.
update public.memorization_records
set session_type='new_hifz', surah_number=1, ayah_start=1,
    ayah_end=4, recitation_result='memorized'
where id='80000000-0000-4000-8000-000000000001';

do $$
declare report jsonb;
begin
  report := public.get_learning_follow_up_dashboard(
    '10000000-0000-4000-8000-000000000001',
    null,null,null,current_date,current_date,50
  );
  if (report #>> '{overview,completed_count}')::int <> 1 then
    raise exception 'successful result did not complete target: %', report;
  end if;
  if (report #>> '{overview,not_memorized_count}')::int <> 0
    or (report #>> '{overview,not_reviewed_count}')::int <> 0 then
    raise exception 'new memorization completion was not reflected in the passage breakdown: %', report;
  end if;
end;
$$;

-- Guardian access is limited to an active linked child and is read-only.
insert into auth.users(id,email)
values ('30000000-0000-4000-8000-000000000006','guardian@example.test');
insert into public.profiles(id,full_name,status)
values ('30000000-0000-4000-8000-000000000006','Guardian User','active');
insert into public.student_guardians(school_id,student_id,guardian_profile_id,status)
values ('10000000-0000-4000-8000-000000000001',
  '70000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000006','active');

-- Create one overdue revision target and repeated weakness observations.
insert into public.learning_follow_up_targets(
  id,school_id,branch_id,class_id,student_id,teacher_id,target_kind,
  surah_number,ayah_start,ayah_end,assigned_on,due_on,status,created_by
) values (
  '92000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  '21000000-0000-4000-8000-000000000001',
  '70000000-0000-4000-8000-000000000001',
  '50000000-0000-4000-8000-000000000001',
  'revision',1,1,4,current_date-2,current_date-1,'active',
  '30000000-0000-4000-8000-000000000003'
);

insert into public.memorization_follow_up_notes(
  school_id,branch_id,class_id,student_id,surah_number,ayah_start,ayah_end,status,observed_on
) values
  ('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','21000000-0000-4000-8000-000000000001','70000000-0000-4000-8000-000000000001',1,1,4,'open',current_date-2),
  ('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','21000000-0000-4000-8000-000000000001','70000000-0000-4000-8000-000000000001',1,1,4,'open',current_date-1);

do $qsp$
declare result jsonb; report jsonb;
begin
  report := public.get_learning_follow_up_dashboard(
    '10000000-0000-4000-8000-000000000001',
    null,null,null,current_date-30,current_date,50
  );
  if (report #>> '{overview,not_reviewed_count}')::int <> 1
    or (report #>> '{overview,overdue_count}')::int <> 1 then
    raise exception 'revision target should be reported as not reviewed and overdue: %', report;
  end if;

  result := public.refresh_learning_follow_up_alerts(
    '10000000-0000-4000-8000-000000000001',null,null,null
  );
  if (result ->> 'created_count')::int <> 7 then
    raise exception 'expected teacher and guardian alerts for overdue, recurring weakness and absence: %', result;
  end if;
  result := public.refresh_learning_follow_up_alerts(
    '10000000-0000-4000-8000-000000000001',null,null,null
  );
  if (result ->> 'created_count')::int <> 0 then
    raise exception 'alert refresh must be idempotent: %', result;
  end if;
  if exists (
    select 1 from public.app_notifications n
    where n.recipient_audiences && array['student']::text[]
       or n.category not in ('teachers','guardians')
  ) then
    raise exception 'student or unsupported audience received a smart alert';
  end if;
end;
$qsp$;

select set_config('request.jwt.claim.sub','30000000-0000-4000-8000-000000000006',false);

do $
begin
  perform public.get_my_guardian_learning_follow_up(
    '10000000-0000-4000-8000-000000000001',
    '70000000-0000-4000-8000-000000000001', null
  );
  raise exception 'guardian RPC must reject a null row limit';
exception when sqlstate '22023' then
  null;
end;
$;

do $
declare report jsonb;
begin
  report := public.get_my_guardian_learning_follow_up(
    '10000000-0000-4000-8000-000000000001',
    '70000000-0000-4000-8000-000000000001',50
  );
  if jsonb_array_length(report -> 'targets') <> 2 then
    raise exception 'guardian should see exactly the linked child target: %', report;
  end if;
  if (report #>> '{attendance,absence_count}')::int <> 1 then
    raise exception 'guardian absence count must exclude future sessions: %', report;
  end if;
  if public.is_active_guardian_of_student(
    '10000000-0000-4000-8000-000000000002',
    '70000000-0000-4000-8000-000000000001'
  ) then
    raise exception 'guardian scope leaked across schools';
  end if;
end;
$$;

do $$
begin
  if has_function_privilege('anon',
    'public.get_my_guardian_learning_follow_up(uuid,uuid,integer)','EXECUTE') then
    raise exception 'anon must not execute guardian learning RPC';
  end if;
  if has_table_privilege('anon','public.learning_follow_up_targets','SELECT') then
    raise exception 'anon must not read learning targets';
  end if;
end;
$$;

select 'smart learning follow-up migration assertions passed' as result;
