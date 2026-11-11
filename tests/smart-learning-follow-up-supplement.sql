-- Supplemental schema for the smart learning follow-up migration test.
alter table public.memorization_records
  add column session_type text,
  add column surah_number smallint,
  add column ayah_start smallint,
  add column ayah_end smallint,
  add column recitation_result text;

create table public.memorization_follow_up_notes (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null,
  branch_id uuid not null,
  class_id uuid not null,
  student_id uuid not null,
  surah_number smallint not null,
  ayah_start smallint not null,
  ayah_end smallint not null,
  status text not null,
  observed_on date not null
);

create table public.attendance_sessions (
  id uuid primary key,
  school_id uuid not null,
  branch_id uuid not null,
  class_id uuid not null,
  session_date date not null
);

create table public.attendance_records (
  id uuid primary key,
  school_id uuid not null,
  branch_id uuid not null,
  class_id uuid not null,
  session_id uuid not null,
  student_id uuid not null,
  status text not null
);

create or replace function public.can_access_attendance_class(
  target_school_id uuid,
  target_branch_id uuid,
  target_class_id uuid,
  target_permission_code text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select target_permission_code in ('attendance.view','attendance.manage')
    and public.can_access_memorization_class(
      target_school_id,target_branch_id,target_class_id,'memorization.view'
    );
$$;

create table public.student_guardians (
  school_id uuid not null,
  student_id uuid not null,
  guardian_profile_id uuid not null,
  status text not null
);

create or replace function public.is_active_guardian_of_student(
  target_school_id uuid,
  target_student_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.student_guardians g
    where g.school_id = target_school_id
      and g.student_id = target_student_id
      and g.guardian_profile_id = (select auth.uid())
      and g.status = 'active'
  );
$$;

create table public.app_notifications (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null,
  recipient_profile_id uuid not null,
  sender_profile_id uuid,
  student_id uuid,
  category text not null,
  event_type text not null,
  title text not null,
  body text not null,
  target_path text,
  source_type text not null,
  source_id uuid not null,
  recipient_audiences text[] not null,
  created_at timestamptz not null default now(),
  unique(recipient_profile_id,source_type,source_id),
  check (category in ('teachers','guardians')),
  check (recipient_audiences <@ array['teacher','guardian']::text[])
);

create or replace function public.create_app_notification_internal(
  target_school_id uuid,
  target_recipient_profile_id uuid,
  target_sender_profile_id uuid,
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
declare created_id uuid;
begin
  insert into public.app_notifications(
    school_id,recipient_profile_id,sender_profile_id,student_id,category,
    event_type,title,body,target_path,source_type,source_id,recipient_audiences
  ) values (
    target_school_id,target_recipient_profile_id,target_sender_profile_id,target_student_id,
    target_category,target_event_type,target_title,target_body,target_path,target_source_type,
    target_source_id,
    case when target_category = 'teachers' then array['teacher']::text[]
      else array['guardian']::text[] end
  )
  on conflict(recipient_profile_id,source_type,source_id) do nothing
  returning id into created_id;
  return created_id;
end;
$$;
