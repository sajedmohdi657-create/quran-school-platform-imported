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

commit;
