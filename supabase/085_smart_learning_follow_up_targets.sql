-- QuranOS: explicit memorization/revision targets and scoped follow-up reports.
-- Phase 1: targets are teacher-assigned; missing activity is never inferred as failure.

begin;

create table public.learning_follow_up_targets (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null,
  branch_id uuid not null,
  class_id uuid not null,
  student_id uuid not null,
  teacher_id uuid not null,
  target_kind text not null,
  surah_number smallint not null,
  ayah_start smallint not null,
  ayah_end smallint not null,
  assigned_on date not null default current_date,
  due_on date not null,
  status text not null default 'active',
  notes text,
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint learning_targets_class_scope_fk
    foreign key (school_id, branch_id, class_id)
    references public.classes(school_id, branch_id, id),
  constraint learning_targets_student_fk
    foreign key (student_id) references public.students(id),
  constraint learning_targets_teacher_fk
    foreign key (teacher_id) references public.teachers(id),
  constraint learning_targets_creator_fk
    foreign key (created_by) references public.profiles(id),
  constraint learning_targets_kind_check
    check (target_kind in ('new_memorization', 'revision')),
  constraint learning_targets_surah_check
    check (surah_number between 1 and 114),
  constraint learning_targets_ayah_range_check
    check (
      ayah_start between 1 and public.quran_surah_ayah_count(surah_number)
      and ayah_end between 1 and public.quran_surah_ayah_count(surah_number)
      and ayah_start <= ayah_end
    ),
  constraint learning_targets_dates_check
    check (due_on >= assigned_on),
  constraint learning_targets_status_check
    check (status in ('active', 'cancelled')),
  constraint learning_targets_notes_check
    check (notes is null or char_length(btrim(notes)) between 1 and 1000),
  constraint learning_targets_scope_id_unique
    unique (school_id, branch_id, class_id, id)
);

create index learning_targets_student_due_idx
  on public.learning_follow_up_targets
    (school_id, student_id, status, due_on, target_kind);
create index learning_targets_class_due_idx
  on public.learning_follow_up_targets
    (school_id, branch_id, class_id, due_on)
  where status = 'active';

create trigger learning_targets_set_updated_at
before update on public.learning_follow_up_targets
for each row execute function public.set_updated_at();

alter table public.learning_follow_up_targets enable row level security;
revoke all on public.learning_follow_up_targets from public, anon, authenticated;
grant select on public.learning_follow_up_targets to authenticated;

create policy learning_targets_select_authorized
on public.learning_follow_up_targets
for select to authenticated
using (
  public.can_access_memorization_class(
    school_id, branch_id, class_id, 'memorization.view'
  )
  or public.can_access_memorization_class(
    school_id, branch_id, class_id, 'memorization.manage'
  )
);

create or replace function public.create_learning_follow_up_target(
  target_school_id uuid,
  target_branch_id uuid,
  target_class_id uuid,
  target_student_id uuid,
  target_kind text,
  target_surah_number smallint,
  target_ayah_start smallint,
  target_ayah_end smallint,
  target_due_on date,
  target_teacher_id uuid default null,
  target_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  resolved_teacher_id uuid;
  new_target_id uuid;
begin
  if current_user_id is null then
    raise exception using errcode = '42501', message = 'LEARNING_TARGET_AUTH_REQUIRED';
  end if;

  if target_kind not in ('new_memorization', 'revision')
    or target_due_on is null
    or target_due_on < current_date
    or target_surah_number not between 1 and 114
    or target_ayah_start < 1
    or target_ayah_end < target_ayah_start
    or target_ayah_end > public.quran_surah_ayah_count(target_surah_number)
    or (target_notes is not null and char_length(btrim(target_notes)) not between 1 and 1000)
  then
    raise exception using errcode = '22023', message = 'LEARNING_TARGET_INPUT_INVALID';
  end if;

  if not public.can_access_memorization_class(
    target_school_id, target_branch_id, target_class_id, 'memorization.manage'
  ) then
    raise exception using errcode = '42501', message = 'LEARNING_TARGET_MANAGE_REQUIRED';
  end if;

  if not exists (
    select 1 from public.students s
    where s.id = target_student_id
      and s.school_id = target_school_id
      and s.branch_id = target_branch_id
      and s.class_id = target_class_id
      and s.status = 'active'
  ) then
    raise exception using errcode = '23514', message = 'LEARNING_TARGET_STUDENT_SCOPE_INVALID';
  end if;

  if target_teacher_id is null then
    select t.id into resolved_teacher_id
    from public.teachers t
    join public.class_teachers ct
      on ct.school_id = t.school_id
     and ct.branch_id = t.branch_id
     and ct.teacher_id = t.id
     and ct.class_id = target_class_id
     and ct.status = 'active'
    where t.school_id = target_school_id
      and t.branch_id = target_branch_id
      and t.profile_id = current_user_id
      and t.status = 'active'
    order by t.id
    limit 1;

  else
    select t.id into resolved_teacher_id
    from public.teachers t
    join public.class_teachers ct
      on ct.school_id = t.school_id
     and ct.branch_id = t.branch_id
     and ct.teacher_id = t.id
     and ct.class_id = target_class_id
     and ct.status = 'active'
    where t.id = target_teacher_id
      and t.school_id = target_school_id
      and t.branch_id = target_branch_id
      and t.status = 'active';
  end if;

  if resolved_teacher_id is null then
    raise exception using errcode = '23514', message = 'LEARNING_TARGET_TEACHER_NOT_ASSIGNED';
  end if;

  if exists (
    select 1
    from public.school_memberships m
    join public.membership_roles mr
      on mr.school_id = m.school_id and mr.membership_id = m.id
    join public.roles r
      on r.school_id = mr.school_id and r.id = mr.role_id and r.status = 'active'
    where m.school_id = target_school_id
      and m.profile_id = current_user_id
      and m.status = 'active'
      and r.code = 'teacher'
  ) and not exists (
    select 1
    from public.school_memberships manager_membership
    join public.membership_roles manager_membership_role
      on manager_membership_role.school_id = manager_membership.school_id
     and manager_membership_role.membership_id = manager_membership.id
    join public.roles manager_role
      on manager_role.school_id = manager_membership_role.school_id
     and manager_role.id = manager_membership_role.role_id
     and manager_role.status = 'active'
    join public.role_permissions manager_role_permission
      on manager_role_permission.school_id = manager_role.school_id
     and manager_role_permission.role_id = manager_role.id
    join public.permissions manager_permission
      on manager_permission.id = manager_role_permission.permission_id
    where manager_membership.school_id = target_school_id
      and manager_membership.profile_id = current_user_id
      and manager_membership.status = 'active'
      and manager_role.code <> 'teacher'
      and manager_permission.code = 'memorization.manage'
      and (
        manager_membership_role.branch_id is null
        or manager_membership_role.branch_id = target_branch_id
      )
  ) and not exists (
    select 1 from public.teachers t
    where t.id = resolved_teacher_id and t.profile_id = current_user_id
  ) then
    raise exception using errcode = '42501', message = 'LEARNING_TARGET_TEACHER_IDENTITY_MISMATCH';
  end if;

  insert into public.learning_follow_up_targets (
    school_id, branch_id, class_id, student_id, teacher_id,
    target_kind, surah_number, ayah_start, ayah_end, due_on, notes, created_by
  ) values (
    target_school_id, target_branch_id, target_class_id, target_student_id,
    resolved_teacher_id, target_kind, target_surah_number, target_ayah_start,
    target_ayah_end, target_due_on, nullif(btrim(target_notes), ''), current_user_id
  ) returning id into new_target_id;

  return new_target_id;
end;
$$;

revoke all on function public.create_learning_follow_up_target(
  uuid, uuid, uuid, uuid, text, smallint, smallint, smallint, date, uuid, text
) from public, anon;
grant execute on function public.create_learning_follow_up_target(
  uuid, uuid, uuid, uuid, text, smallint, smallint, smallint, date, uuid, text
) to authenticated;

create or replace function public.get_learning_follow_up_dashboard(
  target_school_id uuid,
  target_branch_id uuid default null,
  target_class_id uuid default null,
  target_student_id uuid default null,
  target_date_from date default (current_date - 29),
  target_date_to date default current_date,
  target_limit integer default 100
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  if (select auth.uid()) is null then
    raise exception using errcode = '42501', message = 'LEARNING_DASHBOARD_AUTH_REQUIRED';
  end if;
  if target_date_from is null or target_date_to is null
    or target_date_from > target_date_to
    or target_date_to - target_date_from > 366
    or target_limit is null
    or target_limit not between 1 and 200
  then
    raise exception using errcode = '22023', message = 'LEARNING_DASHBOARD_FILTER_INVALID';
  end if;

  if not exists (
    select 1 from public.classes c
    where c.school_id = target_school_id and c.status = 'active'
      and (target_branch_id is null or c.branch_id = target_branch_id)
      and (target_class_id is null or c.id = target_class_id)
      and (
        public.can_access_memorization_class(target_school_id,c.branch_id,c.id,'memorization.view')
        or public.can_access_memorization_class(target_school_id,c.branch_id,c.id,'memorization.manage')
      )
  ) then
    raise exception using errcode = '42501', message = 'LEARNING_DASHBOARD_SCOPE_DENIED';
  end if;

  with scoped_targets as (
    select t.*, s.first_name, s.last_name, c.name as class_name,
      case
        when t.target_kind = 'new_memorization' then exists (
          select 1 from public.memorization_records r
          where r.school_id = t.school_id and r.student_id = t.student_id
            and r.surah_number = t.surah_number
            and r.ayah_start <= t.ayah_start and r.ayah_end >= t.ayah_end
            and r.session_type in ('new_memorization','new_hifz','assessment')
            and r.recitation_result = 'memorized'
            and r.record_date >= t.assigned_on
        )
        else exists (
          select 1 from public.memorization_records r
          where r.school_id = t.school_id and r.student_id = t.student_id
            and r.surah_number = t.surah_number
            and r.ayah_start <= t.ayah_start and r.ayah_end >= t.ayah_end
            and r.session_type in ('near_revision','distant_revision')
            and r.recitation_result = 'revised'
            and r.record_date >= t.assigned_on
        )
      end as completed
    from public.learning_follow_up_targets t
    join public.students s on s.id = t.student_id and s.school_id = t.school_id
    join public.classes c on c.id = t.class_id and c.school_id = t.school_id
      and c.branch_id = t.branch_id and c.status = 'active'
    where t.school_id = target_school_id
      and t.status = 'active'
      and (target_branch_id is null or t.branch_id = target_branch_id)
      and (target_class_id is null or t.class_id = target_class_id)
      and (target_student_id is null or t.student_id = target_student_id)
      and (
        public.can_access_memorization_class(target_school_id,t.branch_id,t.class_id,'memorization.view')
        or public.can_access_memorization_class(target_school_id,t.branch_id,t.class_id,'memorization.manage')
      )
  ),
  rows as (
    select st.*,
      (not st.completed and st.due_on < current_date) as overdue,
      exists (
        select 1 from public.memorization_follow_up_notes n
        where n.school_id = st.school_id and n.branch_id = st.branch_id
          and n.class_id = st.class_id and n.student_id = st.student_id
          and n.surah_number = st.surah_number
          and n.ayah_start <= st.ayah_end and n.ayah_end >= st.ayah_start
          and n.status = 'open'
          and n.observed_on >= st.assigned_on
          and n.observed_on between target_date_from and target_date_to
      ) as has_open_weakness
    from scoped_targets st
  ),
  attendance as (
    select ar.student_id, s.first_name, s.last_name,
      count(*) filter (where ar.status = 'absent')::bigint as absences,
      count(*) filter (where ar.status = 'late')::bigint as late_count
    from public.attendance_records ar
    join public.attendance_sessions a on a.id = ar.session_id
      and a.school_id = ar.school_id and a.branch_id = ar.branch_id
      and a.class_id = ar.class_id
    join public.students s on s.id = ar.student_id and s.school_id = ar.school_id
    where ar.school_id = target_school_id
      and a.session_date between target_date_from and target_date_to
      and (target_branch_id is null or ar.branch_id = target_branch_id)
      and (target_class_id is null or ar.class_id = target_class_id)
      and (target_student_id is null or ar.student_id = target_student_id)
      and (
        public.can_access_attendance_class(ar.school_id,ar.branch_id,ar.class_id,'attendance.view')
        or public.can_access_attendance_class(ar.school_id,ar.branch_id,ar.class_id,'attendance.manage')
      )
    group by ar.student_id, s.first_name, s.last_name
  )
  select jsonb_build_object(
    'overview', jsonb_build_object(
      'assigned_count', count(*),
      'completed_count', count(*) filter (where r.completed),
      'overdue_count', count(*) filter (where r.overdue),
      'not_completed_count', count(*) filter (where not r.completed),
      'not_memorized_count', count(*) filter (where not r.completed and r.target_kind = 'new_memorization'),
      'not_reviewed_count', count(*) filter (where not r.completed and r.target_kind = 'revision'),
      'weakness_count', count(*) filter (where r.has_open_weakness),
      'absence_count', coalesce((select sum(a.absences) from attendance a),0),
      'late_count', coalesce((select sum(a.late_count) from attendance a),0)
    ),
    'targets', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', x.id, 'student_id', x.student_id,
        'student_name', btrim(concat_ws(' ',x.first_name,x.last_name)),
        'class_id', x.class_id, 'class_name', x.class_name,
        'target_kind', x.target_kind, 'surah_number', x.surah_number,
        'ayah_start', x.ayah_start, 'ayah_end', x.ayah_end,
        'assigned_on', x.assigned_on, 'due_on', x.due_on,
        'completed', x.completed, 'overdue', x.overdue,
        'has_open_weakness', x.has_open_weakness,
        'notes', x.notes
      ) order by x.overdue desc, x.due_on, x.created_at desc)
      from (select * from rows order by overdue desc, due_on, created_at desc limit target_limit) x
    ), '[]'::jsonb),
    'attendance_by_student', coalesce((
      select jsonb_agg(jsonb_build_object(
        'student_id', a.student_id, 'student_name', btrim(concat_ws(' ',a.first_name,a.last_name)), 'absence_count', a.absences, 'late_count', a.late_count
      ) order by a.absences desc, a.late_count desc)
      from attendance a
    ), '[]'::jsonb)
  ) into result
  from rows r;

  return coalesce(result, '{}'::jsonb);
end;
$$;

revoke all on function public.get_learning_follow_up_dashboard(
  uuid, uuid, uuid, uuid, date, date, integer
) from public, anon;
grant execute on function public.get_learning_follow_up_dashboard(
  uuid, uuid, uuid, uuid, date, date, integer
) to authenticated;

create or replace function public.get_my_guardian_learning_follow_up(
  target_school_id uuid,
  target_student_id uuid,
  target_limit integer default 50
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  if target_limit is null or target_limit not between 1 and 100 then
    raise exception using errcode = '22023', message = 'GUARDIAN_LEARNING_LIMIT_INVALID';
  end if;
  if not public.is_active_guardian_of_student(target_school_id,target_student_id) then
    raise exception using errcode = '42501', message = 'GUARDIAN_LEARNING_SCOPE_DENIED';
  end if;

  select jsonb_build_object(
    'targets', coalesce(jsonb_agg(jsonb_build_object(
      'id', t.id,
      'target_kind', t.target_kind,
      'surah_number', t.surah_number,
      'ayah_start', t.ayah_start,
      'ayah_end', t.ayah_end,
      'assigned_on', t.assigned_on,
      'due_on', t.due_on,
      'completed', case
        when t.target_kind = 'new_memorization' then exists (
          select 1 from public.memorization_records r
          where r.school_id = t.school_id and r.student_id = t.student_id
            and r.surah_number = t.surah_number
            and r.ayah_start <= t.ayah_start and r.ayah_end >= t.ayah_end
            and r.session_type in ('new_memorization','new_hifz','assessment')
            and r.recitation_result = 'memorized' and r.record_date >= t.assigned_on
        )
        else exists (
          select 1 from public.memorization_records r
          where r.school_id = t.school_id and r.student_id = t.student_id
            and r.surah_number = t.surah_number
            and r.ayah_start <= t.ayah_start and r.ayah_end >= t.ayah_end
            and r.session_type in ('near_revision','distant_revision')
            and r.recitation_result = 'revised' and r.record_date >= t.assigned_on
        )
      end,
      'overdue', t.due_on < current_date
        and not case
          when t.target_kind = 'new_memorization' then exists (
            select 1 from public.memorization_records r
            where r.school_id = t.school_id and r.student_id = t.student_id
              and r.surah_number = t.surah_number
              and r.ayah_start <= t.ayah_start and r.ayah_end >= t.ayah_end
              and r.session_type in ('new_memorization','new_hifz','assessment')
              and r.recitation_result = 'memorized' and r.record_date >= t.assigned_on
          )
          else exists (
            select 1 from public.memorization_records r
            where r.school_id = t.school_id and r.student_id = t.student_id
              and r.surah_number = t.surah_number
              and r.ayah_start <= t.ayah_start and r.ayah_end >= t.ayah_end
              and r.session_type in ('near_revision','distant_revision')
              and r.recitation_result = 'revised' and r.record_date >= t.assigned_on
          )
        end
    ) order by t.due_on, t.created_at desc), '[]'::jsonb),
    'attendance', (
      select jsonb_build_object(
        'absence_count', count(*) filter (where ar.status = 'absent'),
        'late_count', count(*) filter (where ar.status = 'late')
      )
      from public.attendance_records ar
      join public.attendance_sessions a on a.id = ar.session_id
        and a.school_id = ar.school_id and a.branch_id = ar.branch_id
        and a.class_id = ar.class_id
      where ar.school_id = target_school_id and ar.student_id = target_student_id
        and a.session_date >= current_date - 29
        and a.session_date <= current_date
    )
  ) into result
  from (
    select * from public.learning_follow_up_targets
    where school_id = target_school_id and student_id = target_student_id and status = 'active'
    order by due_on, created_at desc limit target_limit
  ) t;

  return coalesce(result, '{}'::jsonb);
end;
$$;

revoke all on function public.get_my_guardian_learning_follow_up(uuid, uuid, integer)
  from public, anon;
grant execute on function public.get_my_guardian_learning_follow_up(uuid, uuid, integer)
  to authenticated;


create or replace function public.refresh_learning_follow_up_alerts(
  target_school_id uuid,
  target_branch_id uuid default null,
  target_class_id uuid default null,
  target_student_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $qsp$
declare
  current_user_id uuid := (select auth.uid());
  target_row record;
  absence_row record;
  guardian_row record;
  teacher_profile_id uuid;
  created_count integer := 0;
  notification_id uuid;
  student_label text;
  passage_label text;
begin
  if current_user_id is null then
    raise exception using errcode = '42501', message = 'LEARNING_ALERT_AUTH_REQUIRED';
  end if;

  if not exists (
    select 1 from public.classes c
    where c.school_id = target_school_id and c.status = 'active'
      and (target_branch_id is null or c.branch_id = target_branch_id)
      and (target_class_id is null or c.id = target_class_id)
      and (
        public.can_access_memorization_class(target_school_id,c.branch_id,c.id,'memorization.view')
        or public.can_access_memorization_class(target_school_id,c.branch_id,c.id,'memorization.manage')
      )
  ) then
    raise exception using errcode = '42501', message = 'LEARNING_ALERT_SCOPE_DENIED';
  end if;

  for target_row in
    select t.*, s.first_name, s.last_name
    from public.learning_follow_up_targets t
    join public.students s on s.id = t.student_id and s.school_id = t.school_id
    where t.school_id = target_school_id and t.status = 'active'
      and t.due_on < current_date
      and (target_branch_id is null or t.branch_id = target_branch_id)
      and (target_class_id is null or t.class_id = target_class_id)
      and (target_student_id is null or t.student_id = target_student_id)
      and (
        public.can_access_memorization_class(target_school_id,t.branch_id,t.class_id,'memorization.view')
        or public.can_access_memorization_class(target_school_id,t.branch_id,t.class_id,'memorization.manage')
      )
      and not exists (
        select 1 from public.memorization_records r
        where r.school_id = t.school_id and r.student_id = t.student_id
          and r.surah_number = t.surah_number
          and r.ayah_start <= t.ayah_start and r.ayah_end >= t.ayah_end
          and r.record_date >= t.assigned_on
          and (
            (t.target_kind = 'new_memorization'
              and r.session_type in ('new_memorization','new_hifz','assessment')
              and r.recitation_result = 'memorized')
            or
            (t.target_kind = 'revision'
              and r.session_type in ('near_revision','distant_revision')
              and r.recitation_result = 'revised')
          )
      )
  loop
    student_label := btrim(concat_ws(' ',target_row.first_name,target_row.last_name));
    passage_label := 'السورة رقم ' || target_row.surah_number::text
      || '، الآيات ' || target_row.ayah_start::text || '-' || target_row.ayah_end::text;

    select t.profile_id into teacher_profile_id
    from public.teachers t
    where t.id = target_row.teacher_id
      and t.school_id = target_row.school_id
      and t.status = 'active'
      and t.profile_id is not null;

    if teacher_profile_id is not null then
      notification_id := public.create_learning_follow_up_notification(
        target_row.school_id, target_row.branch_id, target_row.class_id, teacher_profile_id, target_row.student_id,
        'teachers', 'learning_target_overdue',
        case when target_row.target_kind = 'new_memorization'
          then 'تكليف حفظ متأخر' else 'تكليف مراجعة متأخر' end,
        'التلميذ ' || student_label || ': لم تُسجل نتيجة إنجاز لـ' || passage_label
          || ' بعد موعد الاستحقاق.',
        '/academic-reports?tab=smart',
        'learning_target_overdue', target_row.id
      );
      if notification_id is not null then created_count := created_count + 1; end if;
    end if;

    for guardian_row in
      select distinct g.guardian_profile_id
      from public.student_guardians g
      join public.profiles p on p.id = g.guardian_profile_id and p.status = 'active'
      where g.school_id = target_row.school_id
        and g.student_id = target_row.student_id
        and g.status = 'active'
    loop
      notification_id := public.create_learning_follow_up_notification(
        target_row.school_id, target_row.branch_id, target_row.class_id, guardian_row.guardian_profile_id, target_row.student_id,
        'guardians', 'learning_target_overdue',
        case when target_row.target_kind = 'new_memorization'
          then 'متابعة الحفظ' else 'متابعة المراجعة' end,
        'لم يُسجل إنجاز ' || student_label || ' لـ' || passage_label
          || ' قبل الموعد المحدد. يرجى متابعة التكليف مع المعلم.',
        '/parent',
        'learning_target_overdue', target_row.id
      );
      if notification_id is not null then created_count := created_count + 1; end if;
    end loop;
  end loop;

  -- Repeated unresolved observations are elevated once per assigned passage.
  for target_row in
    select t.*, s.first_name, s.last_name
    from public.learning_follow_up_targets t
    join public.students s on s.id = t.student_id and s.school_id = t.school_id
    where t.school_id = target_school_id and t.status = 'active'
      and (target_branch_id is null or t.branch_id = target_branch_id)
      and (target_class_id is null or t.class_id = target_class_id)
      and (target_student_id is null or t.student_id = target_student_id)
      and (
        public.can_access_memorization_class(target_school_id,t.branch_id,t.class_id,'memorization.view')
        or public.can_access_memorization_class(target_school_id,t.branch_id,t.class_id,'memorization.manage')
      )
      and exists (
        select 1 from public.memorization_follow_up_notes n
        where n.school_id = t.school_id and n.branch_id = t.branch_id
          and n.class_id = t.class_id and n.student_id = t.student_id
          and n.surah_number = t.surah_number
          and n.ayah_start <= t.ayah_end and n.ayah_end >= t.ayah_start
          and n.status = 'open'
          and n.observed_on >= t.assigned_on
        having count(*) >= 2
      )
  loop
    student_label := btrim(concat_ws(' ',target_row.first_name,target_row.last_name));
    select t.profile_id into teacher_profile_id
    from public.teachers t
    where t.id = target_row.teacher_id
      and t.school_id = target_row.school_id
      and t.status = 'active'
      and t.profile_id is not null;

    if teacher_profile_id is not null then
      notification_id := public.create_learning_follow_up_notification(
        target_row.school_id, target_row.branch_id, target_row.class_id, teacher_profile_id, target_row.student_id,
        'teachers', 'learning_passage_recurring_weakness',
        'موضع يحتاج متابعة متكررة',
        'تكررت ملاحظات الضعف لدى ' || student_label || ' في السورة رقم '
          || target_row.surah_number::text || '، الآيات '
          || target_row.ayah_start::text || '-' || target_row.ayah_end::text || '.',
        '/academic-reports?tab=smart',
        'learning_target_weakness', target_row.id
      );
      if notification_id is not null then created_count := created_count + 1; end if;
    end if;

    for guardian_row in
      select distinct g.guardian_profile_id
      from public.student_guardians g
      join public.profiles p on p.id = g.guardian_profile_id and p.status = 'active'
      where g.school_id = target_row.school_id
        and g.student_id = target_row.student_id
        and g.status = 'active'
    loop
      notification_id := public.create_learning_follow_up_notification(
        target_row.school_id, target_row.branch_id, target_row.class_id, guardian_row.guardian_profile_id, target_row.student_id,
        'guardians', 'learning_passage_recurring_weakness',
        'متابعة موضع في الحفظ',
        'لاحظ المعلم تكرار صعوبة في موضع من حفظ ' || student_label
          || '. ستتم متابعة الموضع مع المعلم.',
        '/parent',
        'learning_target_weakness', target_row.id
      );
      if notification_id is not null then created_count := created_count + 1; end if;
    end loop;
  end loop;

  -- Absence reminders are created only for classes the caller can access in attendance.
  for absence_row in
    select ar.id, ar.school_id, ar.student_id, ar.branch_id, ar.class_id,
      a.session_date, s.first_name, s.last_name
    from public.attendance_records ar
    join public.attendance_sessions a on a.id = ar.session_id
      and a.school_id = ar.school_id and a.branch_id = ar.branch_id
      and a.class_id = ar.class_id
    join public.students s on s.id = ar.student_id and s.school_id = ar.school_id
    where ar.school_id = target_school_id and ar.status = 'absent'
      and a.session_date >= current_date - 29
      and a.session_date <= current_date
      and (target_branch_id is null or ar.branch_id = target_branch_id)
      and (target_class_id is null or ar.class_id = target_class_id)
      and (target_student_id is null or ar.student_id = target_student_id)
      and (
        public.can_access_attendance_class(ar.school_id,ar.branch_id,ar.class_id,'attendance.view')
        or public.can_access_attendance_class(ar.school_id,ar.branch_id,ar.class_id,'attendance.manage')
      )
  loop
    student_label := btrim(concat_ws(' ',absence_row.first_name,absence_row.last_name));

    for target_row in
      select distinct t.profile_id
      from public.class_teachers ct
      join public.teachers t on t.id = ct.teacher_id
        and t.school_id = ct.school_id and t.branch_id = ct.branch_id
      where ct.school_id = absence_row.school_id
        and ct.branch_id = absence_row.branch_id
        and ct.class_id = absence_row.class_id
        and ct.status = 'active' and t.status = 'active'
        and t.profile_id is not null
    loop
      notification_id := public.create_learning_follow_up_notification(
        absence_row.school_id, absence_row.branch_id, absence_row.class_id, target_row.profile_id, absence_row.student_id,
        'teachers', 'attendance_absence_follow_up',
        'غياب يحتاج متابعة',
        'سُجل غياب ' || student_label || ' بتاريخ ' || absence_row.session_date::text || '.',
        '/attendance',
        'attendance_absence_follow_up', absence_row.id
      );
      if notification_id is not null then created_count := created_count + 1; end if;
    end loop;

    for guardian_row in
      select distinct g.guardian_profile_id
      from public.student_guardians g
      join public.profiles p on p.id = g.guardian_profile_id and p.status = 'active'
      where g.school_id = absence_row.school_id
        and g.student_id = absence_row.student_id and g.status = 'active'
    loop
      notification_id := public.create_learning_follow_up_notification(
        absence_row.school_id, absence_row.branch_id, absence_row.class_id, guardian_row.guardian_profile_id, absence_row.student_id,
        'guardians', 'attendance_absence_follow_up',
        'تنبيه بخصوص الغياب',
        'سُجل غياب ' || student_label || ' بتاريخ ' || absence_row.session_date::text
          || '. يرجى الاطلاع على سجل الحضور والتواصل مع المدرسة عند الحاجة.',
        '/parent',
        'attendance_absence_follow_up', absence_row.id
      );
      if notification_id is not null then created_count := created_count + 1; end if;
    end loop;
  end loop;

  return jsonb_build_object('created_count',created_count,'deduplicated',true);
end;
$qsp$;

revoke all on function public.refresh_learning_follow_up_alerts(uuid,uuid,uuid,uuid)
  from public, anon;
grant execute on function public.refresh_learning_follow_up_alerts(uuid,uuid,uuid,uuid)
  to authenticated;

comment on table public.learning_follow_up_targets is
  'Teacher-defined Quran memorization and revision assignments; unrecorded passages are not inferred as failures.';
comment on function public.get_learning_follow_up_dashboard(uuid,uuid,uuid,uuid,date,date,integer) is
  'Scoped teacher/staff dashboard for assigned targets, overdue work, weaknesses and attendance.';
comment on function public.get_my_guardian_learning_follow_up(uuid,uuid,integer) is
  'Read-only guardian progress limited to the caller active linked child.';

commit;