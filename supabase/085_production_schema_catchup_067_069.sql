-- Forward-only production catch-up for schema features that exist in source
-- migrations 067-069 but are absent from the live production schema.
-- This is intentionally conditional: a clean repository replay already applies
-- 067-069, while the existing production database needs these definitions once.

do $catchup$
begin
  if to_regclass('public.school_track_results') is null then
    execute $migration_067$
-- School-track assessment results with branch/class authorization and append-only audit history.
begin;

-- The composite key keeps every result tied to the student's actual tenant and branch.
create unique index if not exists students_school_branch_id_unique_idx
  on public.students (school_id, branch_id, id);

insert into public.permissions (code, module, name_ar, description)
values
  (
    'school_track.view',
    'school_track',
    'عرض المسار المدرسي',
    'عرض نتائج الامتحانات والتقارير المدرسية ضمن الفرع أو الحلقة المصرح بها'
  ),
  (
    'school_track.manage',
    'school_track',
    'إدارة المسار المدرسي',
    'تسجيل نتائج الامتحانات وتصحيحها ضمن الفرع أو الحلقة المصرح بها'
  )
on conflict (code) do update
set module = excluded.module,
    name_ar = excluded.name_ar,
    description = excluded.description;

with grants (role_code, permission_code) as (
  values
    ('school_admin', 'school_track.view'),
    ('school_admin', 'school_track.manage'),
    ('branch_manager', 'school_track.view'),
    ('branch_manager', 'school_track.manage'),
    ('academic_supervisor', 'school_track.view'),
    ('academic_supervisor', 'school_track.manage'),
    ('teacher', 'school_track.view'),
    ('teacher', 'school_track.manage'),
    ('registrar', 'school_track.view'),
    ('registrar', 'school_track.manage')
)
insert into public.role_permissions (school_id, role_id, permission_id)
select role.school_id, role.id, permission.id
from grants as role_grant
join public.roles as role
  on role.code = role_grant.role_code
join public.permissions as permission
  on permission.code = role_grant.permission_code
on conflict (role_id, permission_id) do nothing;

create table public.school_track_results (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null,
  branch_id uuid not null,
  class_id uuid,
  student_id uuid not null,
  subject text not null,
  assessment_title text not null,
  assessment_type text not null default 'exam',
  academic_year text not null,
  term text not null,
  assessment_date date not null,
  score numeric(7,2) not null,
  max_score numeric(7,2) not null default 20,
  notes text,
  created_by uuid not null default auth.uid(),
  updated_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint school_track_results_student_scope_fk
    foreign key (school_id, branch_id, student_id)
    references public.students (school_id, branch_id, id),
  constraint school_track_results_class_scope_fk
    foreign key (school_id, branch_id, class_id)
    references public.classes (school_id, branch_id, id),
  constraint school_track_results_created_by_fk
    foreign key (created_by) references public.profiles(id),
  constraint school_track_results_updated_by_fk
    foreign key (updated_by) references public.profiles(id),
  constraint school_track_results_subject_check
    check (char_length(btrim(subject)) between 1 and 100),
  constraint school_track_results_title_check
    check (char_length(btrim(assessment_title)) between 1 and 120),
  constraint school_track_results_type_check
    check (assessment_type in ('quiz', 'test', 'exam', 'oral', 'continuous', 'other')),
  constraint school_track_results_year_check
    check (academic_year ~ '^[0-9]{4}[-/][0-9]{4}$'),
  constraint school_track_results_term_check
    check (char_length(btrim(term)) between 1 and 60),
  constraint school_track_results_score_check
    check (score >= 0 and max_score > 0 and max_score <= 1000 and score <= max_score),
  constraint school_track_results_notes_check
    check (notes is null or char_length(notes) <= 2000)
);

comment on table public.school_track_results is
  'Per-student school examinations and evaluations; Quran memorization data remains in its existing module.';
comment on column public.school_track_results.class_id is
  'Quran-school class snapshot at the time of the assessment, used to scope teacher access.';
comment on column public.school_track_results.max_score is
  'Configurable maximum score for this assessment; the UI defaults to 20 but does not enforce one grading scale.';

create index school_track_results_student_date_idx
  on public.school_track_results (school_id, branch_id, student_id, assessment_date desc);
create index school_track_results_report_idx
  on public.school_track_results (school_id, branch_id, academic_year, term, subject, assessment_date desc);
create index school_track_results_class_date_idx
  on public.school_track_results (school_id, branch_id, class_id, assessment_date desc);

create or replace function public.can_access_school_track_class(
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
  select
    target_permission_code in ('school_track.view', 'school_track.manage')
    and public.is_active_school_member(target_school_id)
    and exists (
      select 1
      from public.branches as target_branch
      where target_branch.school_id = target_school_id
        and target_branch.id = target_branch_id
    )
    and (
      exists (
        select 1
        from public.school_memberships as membership
        join public.membership_roles as membership_role
          on membership_role.school_id = membership.school_id
         and membership_role.membership_id = membership.id
        join public.roles as role
          on role.school_id = membership_role.school_id
         and role.id = membership_role.role_id
         and role.status = 'active'
        join public.role_permissions as role_permission
          on role_permission.school_id = role.school_id
         and role_permission.role_id = role.id
        join public.permissions as permission
          on permission.id = role_permission.permission_id
        where membership.school_id = target_school_id
          and membership.profile_id = (select auth.uid())
          and membership.status = 'active'
          and role.code <> 'teacher'
          and permission.code = target_permission_code
          and (
            membership_role.branch_id is null
            or membership_role.branch_id = target_branch_id
          )
      )
      or (
        target_class_id is not null
        and exists (
          select 1
          from public.school_memberships as membership
          join public.membership_roles as membership_role
            on membership_role.school_id = membership.school_id
           and membership_role.membership_id = membership.id
          join public.roles as role
            on role.school_id = membership_role.school_id
           and role.id = membership_role.role_id
           and role.status = 'active'
          join public.role_permissions as role_permission
            on role_permission.school_id = role.school_id
           and role_permission.role_id = role.id
          join public.permissions as permission
            on permission.id = role_permission.permission_id
          where membership.school_id = target_school_id
            and membership.profile_id = (select auth.uid())
            and membership.status = 'active'
            and role.code = 'teacher'
            and permission.code = target_permission_code
            and (
              membership_role.branch_id is null
              or membership_role.branch_id = target_branch_id
            )
        )
        and exists (
          select 1
          from public.teachers as teacher
          join public.class_teachers as class_teacher
            on class_teacher.school_id = teacher.school_id
           and class_teacher.branch_id = teacher.branch_id
           and class_teacher.teacher_id = teacher.id
           and class_teacher.status = 'active'
          where teacher.school_id = target_school_id
            and teacher.branch_id = target_branch_id
            and teacher.profile_id = (select auth.uid())
            and teacher.status = 'active'
            and class_teacher.class_id = target_class_id
        )
      )
    );
$$;

revoke all on function public.can_access_school_track_class(uuid, uuid, uuid, text)
  from public, anon;
grant execute on function public.can_access_school_track_class(uuid, uuid, uuid, text)
  to authenticated;

create table public.school_track_result_history (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null,
  branch_id uuid not null,
  class_id uuid,
  result_id uuid not null references public.school_track_results(id) on delete restrict,
  operation text not null check (operation in ('insert', 'update')),
  old_values jsonb,
  new_values jsonb not null,
  changed_by uuid not null default auth.uid(),
  changed_at timestamptz not null default now(),
  constraint school_track_result_history_actor_fk
    foreign key (changed_by) references public.profiles(id)
);
create index school_track_result_history_result_idx
  on public.school_track_result_history (school_id, result_id, changed_at desc);

create or replace function public.set_school_track_result_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  new.updated_by := (select auth.uid());
  return new;
end;
$$;

create or replace function public.audit_school_track_result()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.school_track_result_history (
      school_id, branch_id, class_id, result_id, operation, old_values, new_values, changed_by
    ) values (
      new.school_id, new.branch_id, new.class_id, new.id, 'insert', null,
      to_jsonb(new), (select auth.uid())
    );
  else
    insert into public.school_track_result_history (
      school_id, branch_id, class_id, result_id, operation, old_values, new_values, changed_by
    ) values (
      new.school_id, new.branch_id, new.class_id, new.id, 'update', to_jsonb(old),
      to_jsonb(new), (select auth.uid())
    );
  end if;
  return new;
end;
$$;

revoke all on function public.set_school_track_result_updated_at() from public, anon;
revoke all on function public.audit_school_track_result() from public, anon;

create trigger school_track_results_set_updated_at
before update on public.school_track_results
for each row execute function public.set_school_track_result_updated_at();
create trigger school_track_results_audit
 after insert or update on public.school_track_results
for each row execute function public.audit_school_track_result();

alter table public.school_track_results enable row level security;
alter table public.school_track_result_history enable row level security;

revoke all on public.school_track_results,
  public.school_track_result_history
from public, anon, authenticated;

grant select on public.school_track_results to authenticated;
grant insert (
  school_id, branch_id, class_id, student_id, subject, assessment_title,
  assessment_type, academic_year, term, assessment_date, score, max_score, notes
) on public.school_track_results to authenticated;
grant update (
  subject, assessment_title, assessment_type, academic_year, term,
  assessment_date, score, max_score, notes
) on public.school_track_results to authenticated;
grant select on public.school_track_result_history to authenticated;

create policy school_track_results_select_authorized
on public.school_track_results
for select to authenticated
using (
  public.can_access_school_track_class(
    school_id, branch_id, class_id, 'school_track.view'
  )
  or public.can_access_school_track_class(
    school_id, branch_id, class_id, 'school_track.manage'
  )
);

create policy school_track_results_insert_authorized
on public.school_track_results
for insert to authenticated
with check (
  created_by = (select auth.uid())
  and updated_by = (select auth.uid())
  and public.can_access_school_track_class(
    school_id, branch_id, class_id, 'school_track.manage'
  )
);

create policy school_track_results_update_authorized
on public.school_track_results
for update to authenticated
using (
  public.can_access_school_track_class(
    school_id, branch_id, class_id, 'school_track.manage'
  )
)
with check (
  updated_by = (select auth.uid())
  and public.can_access_school_track_class(
    school_id, branch_id, class_id, 'school_track.manage'
  )
);

create policy school_track_history_select_managers
on public.school_track_result_history
for select to authenticated
using (
  public.can_access_school_track_class(
    school_id, branch_id, class_id, 'school_track.manage'
  )
);

-- Assessment rows are corrected through audited UPDATE operations. No browser
-- DELETE or history-write privileges are granted.
$migration_067$;
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'student_guardians'
      and column_name = 'guardian_name_override'
  ) then
    execute $migration_068$
-- QuranOS V2 - scoped editing for student/guardian relationship records.
-- Contact overrides are relationship-local: a guardian may share one profile
-- across students and schools, so school staff must not edit the global profile.

begin;

alter table public.student_guardians
  add column guardian_name_override text,
  add column guardian_phone_override text,
  add column guardian_phone_override_set boolean not null default false,
  add constraint student_guardians_name_override_check
    check (
      guardian_name_override is null
      or char_length(btrim(guardian_name_override)) between 2 and 150
    ),
  add constraint student_guardians_phone_override_check
    check (
      not guardian_phone_override_set
      or guardian_phone_override is null
      or char_length(btrim(guardian_phone_override)) between 1 and 40
    );

comment on column public.student_guardians.guardian_name_override is
  'Optional name override scoped to this student relationship; never changes the shared profile.';
comment on column public.student_guardians.guardian_phone_override is
  'Optional phone override scoped to this student relationship; never changes the shared profile.';
comment on column public.student_guardians.guardian_phone_override_set is
  'Distinguishes using the shared profile phone from an explicitly cleared relationship-local phone.';

create or replace function public.list_school_guardians(
  target_school_id uuid
)
returns table (
  relationship_id uuid,
  student_id uuid,
  student_name text,
  branch_id uuid,
  branch_name text,
  class_name text,
  guardian_profile_id uuid,
  guardian_name text,
  guardian_email text,
  guardian_phone text,
  relationship_type text,
  is_primary boolean,
  relationship_status text,
  invitation_status text,
  created_at timestamptz,
  activated_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    relationship.id,
    student.id,
    concat_ws(' ', student.first_name, student.last_name),
    student.branch_id,
    branch.name,
    class.name,
    relationship.guardian_profile_id,
    coalesce(relationship.guardian_name_override, guardian_profile.full_name),
    case
      when public.can_manage_student_guardian(
        relationship.school_id,
        relationship.student_id,
        'guardians.view_contacts'
      ) then lower(btrim(auth_user.email))
      else null
    end,
    case
      when public.can_manage_student_guardian(
        relationship.school_id,
        relationship.student_id,
        'guardians.view_contacts'
      ) then case
        when relationship.guardian_phone_override_set then relationship.guardian_phone_override
        else guardian_profile.phone
      end
      else null
    end,
    relationship.relationship_type,
    relationship.is_primary,
    relationship.status,
    latest_invitation.status,
    relationship.created_at,
    relationship.activated_at
  from public.student_guardians as relationship
  join public.students as student
    on student.school_id = relationship.school_id
   and student.id = relationship.student_id
  join public.branches as branch
    on branch.school_id = student.school_id
   and branch.id = student.branch_id
  left join public.classes as class
    on class.school_id = student.school_id
   and class.branch_id = student.branch_id
   and class.id = student.class_id
  join public.profiles as guardian_profile
    on guardian_profile.id = relationship.guardian_profile_id
  left join auth.users as auth_user
    on auth_user.id = relationship.guardian_profile_id
  left join lateral (
    select invitation.status
    from public.guardian_invitations as invitation
    where invitation.student_guardian_id = relationship.id
    order by invitation.created_at desc, invitation.id desc
    limit 1
  ) as latest_invitation on true
  where relationship.school_id = target_school_id
    and public.can_manage_student_guardian(
      relationship.school_id,
      relationship.student_id,
      'guardians.view'
    )
  order by student.last_name, student.first_name, relationship.is_primary desc,
    relationship.created_at desc;
$$;

create or replace function public.update_student_guardian_link(
  target_school_id uuid,
  target_student_guardian_id uuid,
  target_guardian_name text,
  target_guardian_phone text,
  target_relationship_type text,
  target_is_primary boolean
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  relationship_record public.student_guardians%rowtype;
  guardian_profile_name text;
  guardian_profile_phone text;
  normalized_name text := nullif(regexp_replace(btrim(target_guardian_name), '[[:space:]]+', ' ', 'g'), '');
  normalized_phone text := nullif(btrim(target_guardian_phone), '');
  can_view_contacts boolean;
  changed_fields text[] := array[]::text[];
begin
  if current_user_id is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;

  if target_school_id is null
    or target_student_guardian_id is null
    or normalized_name is null
    or char_length(normalized_name) not between 2 and 150
    or target_relationship_type is null
    or target_relationship_type not in ('father', 'mother', 'legal_guardian', 'relative', 'other')
    or target_is_primary is null
    or (target_guardian_phone is not null and char_length(btrim(target_guardian_phone)) > 40)
  then
    raise exception using errcode = '22023', message = 'invalid guardian relationship input';
  end if;

  select relationship.*
  into relationship_record
  from public.student_guardians as relationship
  where relationship.school_id = target_school_id
    and relationship.id = target_student_guardian_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'guardian relationship not found';
  end if;

  if not public.can_manage_student_guardian(
    relationship_record.school_id,
    relationship_record.student_id,
    'guardians.link'
  ) then
    raise exception using errcode = '42501', message = 'permission denied';
  end if;

  if relationship_record.status not in ('pending', 'active') then
    raise exception using errcode = '23514', message = 'revoked guardian relationships are immutable';
  end if;

  select profile.full_name, profile.phone
  into guardian_profile_name, guardian_profile_phone
  from public.profiles as profile
  where profile.id = relationship_record.guardian_profile_id;

  can_view_contacts := public.can_manage_student_guardian(
    relationship_record.school_id,
    relationship_record.student_id,
    'guardians.view_contacts'
  );

  if normalized_name is distinct from coalesce(
    relationship_record.guardian_name_override,
    guardian_profile_name
  ) then
    changed_fields := array_append(changed_fields, 'guardian_name');
  end if;

  if target_relationship_type is distinct from relationship_record.relationship_type then
    changed_fields := array_append(changed_fields, 'relationship_type');
  end if;

  if target_is_primary is distinct from relationship_record.is_primary then
    changed_fields := array_append(changed_fields, 'is_primary');
  end if;

  if can_view_contacts then
    if relationship_record.guardian_phone_override_set then
      if normalized_phone is distinct from relationship_record.guardian_phone_override then
        changed_fields := array_append(changed_fields, 'guardian_phone');
      end if;
    else
      if normalized_phone is distinct from guardian_profile_phone then
        changed_fields := array_append(changed_fields, 'guardian_phone');
      end if;
    end if;
  end if;

  if cardinality(changed_fields) = 0 then
    return true;
  end if;

  -- Demote any other live primary link before promoting this one. The unique
  -- partial index remains the final guard against concurrent duplicate primaries.
  if target_is_primary and not relationship_record.is_primary then
    with demoted as (
      update public.student_guardians as other
      set is_primary = false
      where other.school_id = relationship_record.school_id
        and other.student_id = relationship_record.student_id
        and other.id <> relationship_record.id
        and other.status in ('pending', 'active')
        and other.is_primary
      returning other.id, other.school_id, other.student_id, other.guardian_profile_id
    )
    insert into public.guardian_access_events (
      school_id,
      student_id,
      student_guardian_id,
      guardian_profile_id,
      event_type,
      actor_profile_id,
      reason_code,
      metadata
    )
    select
      demoted.school_id,
      demoted.student_id,
      demoted.id,
      demoted.guardian_profile_id,
      'primary_changed',
      current_user_id,
      'manual_update',
      jsonb_build_object('fields', jsonb_build_array('is_primary'))
    from demoted;
  end if;

  update public.student_guardians as relationship
  set guardian_name_override = normalized_name,
      guardian_phone_override = case
        when can_view_contacts then normalized_phone
        else relationship.guardian_phone_override
      end,
      guardian_phone_override_set = case
        when can_view_contacts then true
        else relationship.guardian_phone_override_set
      end,
      relationship_type = target_relationship_type,
      is_primary = target_is_primary
  where relationship.school_id = relationship_record.school_id
    and relationship.id = relationship_record.id
    and relationship.status in ('pending', 'active');

  if not found then
    raise exception using errcode = '40001', message = 'guardian relationship state changed concurrently';
  end if;

  insert into public.guardian_access_events (
    school_id,
    student_id,
    student_guardian_id,
    guardian_profile_id,
    event_type,
    actor_profile_id,
    reason_code,
    metadata
  ) values (
    relationship_record.school_id,
    relationship_record.student_id,
    relationship_record.id,
    relationship_record.guardian_profile_id,
    case
      when target_is_primary is distinct from relationship_record.is_primary then 'primary_changed'
      else 'relationship_updated'
    end,
    current_user_id,
    'manual_update',
    jsonb_build_object('fields', to_jsonb(changed_fields))
  );

  return true;
end;
$$;

revoke all on function public.update_student_guardian_link(uuid, uuid, text, text, text, boolean)
from public, anon;
grant execute on function public.update_student_guardian_link(uuid, uuid, text, text, text, boolean)
to authenticated;
$migration_068$;
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'registration_leads'
      and column_name = 'education_level'
  ) then
    execute $migration_069$
-- QuranOS V2 - progressive registration details captured from the first stage.
-- These details remain optional so a lead can be saved with only essential contact data.

begin;

alter table public.registration_leads
  add column education_level text,
  add column previous_memorization_outcome text,
  add constraint registration_leads_education_level_check
    check (education_level is null or education_level in ('primary', 'middle', 'secondary', 'university')),
  add constraint registration_leads_previous_memorization_check
    check (
      previous_memorization_outcome is null
      or char_length(btrim(previous_memorization_outcome)) between 1 and 1000
    );

comment on column public.registration_leads.education_level is
  'Optional school education level captured during initial registration intake.';
comment on column public.registration_leads.previous_memorization_outcome is
  'Optional bounded summary of Quran memorization achieved before joining the school.';

alter table public.registration_lead_events
  drop constraint registration_lead_events_type_check;

alter table public.registration_lead_events
  add constraint registration_lead_events_type_check
    check (event_type in ('created', 'pipeline_updated', 'waitlist_updated', 'student_details_updated'));

alter table public.registration_lead_events
  drop constraint registration_lead_events_status_shape_check;

alter table public.registration_lead_events
  add constraint registration_lead_events_status_shape_check
  check (
    (
      event_type = 'created'
      and previous_status is null
      and new_status = 'new'
    )
    or
    (
      event_type = 'pipeline_updated'
      and previous_status in (
        'new', 'contacted', 'qualified', 'visit_scheduled',
        'awaiting_documents', 'waitlisted', 'accepted', 'lost'
      )
      and new_status in (
        'new', 'contacted', 'qualified', 'visit_scheduled',
        'awaiting_documents', 'waitlisted', 'accepted', 'lost'
      )
    )
    or
    (
      event_type = 'waitlist_updated'
      and previous_status = 'waitlisted'
      and new_status = 'waitlisted'
    )
    or
    (
      event_type = 'student_details_updated'
      and previous_status in (
        'new', 'contacted', 'qualified', 'visit_scheduled',
        'awaiting_documents', 'waitlisted', 'accepted', 'lost'
      )
      and new_status = previous_status
    )
  );

-- RETURNS TABLE cannot be changed with CREATE OR REPLACE; recreate the scoped,
-- permission-checked RPC and preserve the waitlist rank behavior.
drop function if exists public.list_registration_leads(uuid, text, integer);

create function public.list_registration_leads(
  target_school_id uuid,
  target_status text default null,
  target_limit integer default 200
)
returns table (
  lead_id uuid,
  branch_id uuid,
  branch_name text,
  branch_code text,
  prospect_first_name text,
  prospect_last_name text,
  birth_date date,
  gender text,
  education_level text,
  previous_memorization_outcome text,
  guardian_name text,
  guardian_phone text,
  guardian_email text,
  source text,
  lead_status text,
  waitlisted_at timestamptz,
  waitlist_priority smallint,
  waitlist_reason text,
  desired_level text,
  waitlist_rank bigint,
  next_follow_up_at timestamptz,
  notes text,
  created_by_name text,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if target_school_id is null then
    raise exception using errcode = '22023', message = 'registration_crm_invalid_school';
  end if;

  if target_status is not null
     and target_status not in (
       'new', 'contacted', 'qualified', 'visit_scheduled',
       'awaiting_documents', 'waitlisted', 'accepted', 'lost'
     ) then
    raise exception using errcode = '22023', message = 'registration_crm_invalid_status';
  end if;

  if target_limit is null or target_limit < 1 or target_limit > 500 then
    raise exception using errcode = '22023', message = 'registration_crm_invalid_limit';
  end if;

  return query
  with scoped as (
    select
      lead.id,
      lead.branch_id,
      branch.name as branch_name,
      branch.code as branch_code,
      lead.prospect_first_name,
      lead.prospect_last_name,
      lead.birth_date,
      lead.gender,
      lead.education_level,
      lead.previous_memorization_outcome,
      lead.guardian_name,
      lead.guardian_phone,
      lead.guardian_email,
      lead.source,
      lead.status,
      lead.waitlisted_at,
      lead.waitlist_priority,
      lead.waitlist_reason,
      lead.desired_level,
      case
        when lead.status = 'waitlisted' then
          row_number() over (
            partition by lead.school_id, lead.branch_id, lead.status
            order by
              lead.waitlist_priority asc,
              lead.waitlisted_at asc,
              lead.created_at asc,
              lead.id asc
          )
        else null
      end as waitlist_rank,
      lead.next_follow_up_at,
      lead.notes,
      creator.full_name as created_by_name,
      lead.created_at,
      lead.updated_at
    from public.registration_leads as lead
    join public.branches as branch
      on branch.school_id = lead.school_id and branch.id = lead.branch_id
    join public.profiles as creator on creator.id = lead.created_by
    where lead.school_id = target_school_id
      and (target_status is null or lead.status = target_status)
      and (
        public.has_branch_permission(lead.school_id, lead.branch_id, 'registrations.view')
        or public.has_branch_permission(lead.school_id, lead.branch_id, 'registrations.manage')
      )
  )
  select
    scoped.id,
    scoped.branch_id,
    scoped.branch_name,
    scoped.branch_code,
    scoped.prospect_first_name,
    scoped.prospect_last_name,
    scoped.birth_date,
    scoped.gender,
    scoped.education_level,
    scoped.previous_memorization_outcome,
    scoped.guardian_name,
    scoped.guardian_phone,
    scoped.guardian_email,
    scoped.source,
    scoped.status,
    scoped.waitlisted_at,
    scoped.waitlist_priority,
    scoped.waitlist_reason,
    scoped.desired_level,
    scoped.waitlist_rank,
    scoped.next_follow_up_at,
    scoped.notes,
    scoped.created_by_name,
    scoped.created_at,
    scoped.updated_at
  from scoped
  order by
    case when target_status = 'waitlisted' then scoped.waitlist_rank end asc nulls last,
    scoped.next_follow_up_at asc nulls last,
    scoped.created_at desc,
    scoped.id
  limit target_limit;
end;
$$;

revoke all on function public.list_registration_leads(uuid, text, integer)
from public, anon;
grant execute on function public.list_registration_leads(uuid, text, integer)
to authenticated;

-- First-stage creation is atomic: call the existing hardened creator, then set
-- the additional optional student details in the same database transaction.
create or replace function public.create_registration_lead_with_details(
  target_school_id uuid,
  target_branch_id uuid,
  target_prospect_first_name text,
  target_prospect_last_name text,
  target_birth_date date,
  target_guardian_name text,
  target_guardian_phone text,
  target_source text,
  target_next_follow_up_at timestamptz,
  target_notes text,
  target_education_level text,
  target_previous_memorization_outcome text
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  normalized_education_level text := nullif(lower(btrim(target_education_level)), '');
  normalized_memorization_outcome text := nullif(btrim(target_previous_memorization_outcome), '');
  new_lead_id uuid;
begin
  if (normalized_education_level is not null and normalized_education_level not in ('primary', 'middle', 'secondary', 'university'))
     or (normalized_memorization_outcome is not null and char_length(normalized_memorization_outcome) > 1000) then
    raise exception using errcode = '22023', message = 'registration_student_details_invalid_input';
  end if;

  new_lead_id := public.create_registration_lead(
    target_school_id,
    target_branch_id,
    target_prospect_first_name,
    target_prospect_last_name,
    target_birth_date,
    null,
    target_guardian_name,
    target_guardian_phone,
    null,
    target_source,
    target_next_follow_up_at,
    target_notes
  );

  update public.registration_leads
  set education_level = normalized_education_level,
      previous_memorization_outcome = normalized_memorization_outcome,
      updated_by = (select auth.uid())
  where school_id = target_school_id
    and id = new_lead_id;

  return new_lead_id;
end;
$$;

revoke all on function public.create_registration_lead_with_details(uuid, uuid, text, text, date, text, text, text, timestamptz, text, text, text)
from public, anon;
grant execute on function public.create_registration_lead_with_details(uuid, uuid, text, text, date, text, text, text, timestamptz, text, text, text)
to authenticated;

create or replace function public.update_registration_lead_student_details(
  target_lead_id uuid,
  target_birth_date date,
  target_education_level text,
  target_previous_memorization_outcome text
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  lead_row public.registration_leads%rowtype;
  normalized_education_level text := nullif(lower(btrim(target_education_level)), '');
  normalized_memorization_outcome text := nullif(btrim(target_previous_memorization_outcome), '');
begin
  if actor_id is null or not public.current_profile_is_active() then
    raise exception using errcode = '42501', message = 'registration_crm_unauthorized';
  end if;

  if target_lead_id is null
     or (target_birth_date is not null and target_birth_date > current_date)
     or (normalized_education_level is not null and normalized_education_level not in ('primary', 'middle', 'secondary', 'university'))
     or (normalized_memorization_outcome is not null and char_length(normalized_memorization_outcome) > 1000) then
    raise exception using errcode = '22023', message = 'registration_student_details_invalid_input';
  end if;

  select lead.* into lead_row
  from public.registration_leads as lead
  where lead.id = target_lead_id
  for update;

  if not found
     or not exists (
       select 1
       from public.branches as branch
       join public.schools as school on school.id = branch.school_id
       where branch.school_id = lead_row.school_id
         and branch.id = lead_row.branch_id
         and branch.status = 'active'
         and school.status = 'active'
     )
     or not public.has_branch_permission(lead_row.school_id, lead_row.branch_id, 'registrations.manage') then
    raise exception using errcode = '42501', message = 'registration_crm_unauthorized';
  end if;

  update public.registration_leads
  set birth_date = target_birth_date,
      education_level = normalized_education_level,
      previous_memorization_outcome = normalized_memorization_outcome,
      updated_by = actor_id
  where id = lead_row.id;

  if lead_row.birth_date is distinct from target_birth_date
     or lead_row.education_level is distinct from normalized_education_level
     or lead_row.previous_memorization_outcome is distinct from normalized_memorization_outcome then
    insert into public.registration_lead_events (
      school_id, branch_id, lead_id, event_type, previous_status, new_status, actor_id
    ) values (
      lead_row.school_id,
      lead_row.branch_id,
      lead_row.id,
      'student_details_updated',
      lead_row.status,
      lead_row.status,
      actor_id
    );
  end if;

  return true;
end;
$$;

revoke all on function public.update_registration_lead_student_details(uuid, date, text, text)
from public, anon;
grant execute on function public.update_registration_lead_student_details(uuid, date, text, text)
to authenticated;
$migration_069$;
  end if;
end;
$catchup$;
