-- QuranOS: private writer for smart learning follow-up notifications.
-- It avoids widening the legacy notification helper's global category contract.

begin;

create or replace function public.create_learning_follow_up_notification(
  target_school_id uuid,
  target_branch_id uuid,
  target_class_id uuid,
  target_recipient_profile_id uuid,
  target_student_id uuid,
  target_category text,
  target_event_type text,
  target_title text,
  target_body text,
  target_path text,
  target_source_type text,
  target_source_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  created_notification_id uuid;
begin
  if target_school_id is null
    or target_branch_id is null
    or target_class_id is null
    or target_recipient_profile_id is null
    or target_student_id is null
    or target_source_id is null
    or target_category not in ('teachers', 'guardians')
    or target_event_type is null
    or target_event_type !~ '^[a-z][a-z0-9_]{1,63}$'
    or target_source_type is null
    or target_source_type !~ '^[a-z][a-z0-9_]{1,63}$'
    or target_title is null
    or char_length(btrim(target_title)) not between 1 and 160
    or target_body is null
    or char_length(btrim(target_body)) not between 1 and 700
    or target_path is null
    or target_path !~ '^/'
    or position('://' in target_path) > 0
  then
    raise exception using errcode = '22023', message = 'invalid learning follow-up notification';
  end if;

  if not exists (
    select 1
    from public.schools school
    join public.students student
      on student.school_id = school.id
     and student.id = target_student_id
     and student.branch_id = target_branch_id
     and student.class_id = target_class_id
    where school.id = target_school_id
      and school.status = 'active'
  ) or not exists (
    select 1 from public.profiles recipient
    where recipient.id = target_recipient_profile_id
      and recipient.status = 'active'
  ) then
    raise exception using errcode = '23514', message = 'learning notification scope mismatch';
  end if;

  if target_category = 'teachers' and not exists (
    select 1
    from public.teachers teacher
    join public.class_teachers class_teacher
      on class_teacher.school_id = teacher.school_id
     and class_teacher.branch_id = teacher.branch_id
     and class_teacher.teacher_id = teacher.id
     and class_teacher.class_id = target_class_id
     and class_teacher.status = 'active'
    where teacher.school_id = target_school_id
      and teacher.branch_id = target_branch_id
      and teacher.profile_id = target_recipient_profile_id
      and teacher.status = 'active'
  ) then
    raise exception using errcode = '42501', message = 'learning notification teacher scope denied';
  end if;

  if target_category = 'guardians' and not exists (
    select 1
    from public.student_guardians guardian
    where guardian.school_id = target_school_id
      and guardian.student_id = target_student_id
      and guardian.guardian_profile_id = target_recipient_profile_id
      and guardian.status = 'active'
  ) then
    raise exception using errcode = '42501', message = 'learning notification guardian scope denied';
  end if;

  insert into public.app_notifications (
    school_id,
    recipient_profile_id,
    sender_profile_id,
    student_id,
    category,
    event_type,
    title,
    body,
    target_path,
    source_type,
    source_id,
    recipient_audiences
  ) values (
    target_school_id,
    target_recipient_profile_id,
    null,
    target_student_id,
    target_category,
    target_event_type,
    btrim(target_title),
    btrim(target_body),
    target_path,
    target_source_type,
    target_source_id,
    case
      when target_category = 'teachers' then array['teacher']::text[]
      else array['guardian']::text[]
    end
  )
  on conflict (recipient_profile_id, source_type, source_id) do nothing
  returning id into created_notification_id;

  return created_notification_id;
end;
$$;

revoke all on function public.create_learning_follow_up_notification(
  uuid, uuid, uuid, uuid, uuid, text, text, text, text, text, text, uuid
) from public, anon, authenticated, service_role;

commit;
