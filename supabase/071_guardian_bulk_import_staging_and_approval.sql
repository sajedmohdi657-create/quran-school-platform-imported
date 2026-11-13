-- Restored from the live production catalog (migration history:
-- guardian_bulk_import_staging_and_approval, 2026-10-02).
-- Keep this file before 072_guardian_bulk_import_rpc_execute_lockdown.sql.

begin;

create table public.guardian_import_batches (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  file_name text not null,
  file_sha256 text not null,
  status text not null default 'staged',
  total_count integer not null default 0,
  ready_count integer not null default 0,
  warning_count integer not null default 0,
  duplicate_count integer not null default 0,
  error_count integer not null default 0,
  created_count integer not null default 0,
  invitation_count integer not null default 0,
  failed_count integer not null default 0,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  approved_at timestamptz,
  committed_at timestamptz,
  rolled_back_at timestamptz,
  constraint guardian_import_batches_file_name_check
    check (char_length(btrim(file_name)) between 1 and 180),
  constraint guardian_import_batches_file_sha256_check
    check (file_sha256 ~ '^[0-9a-f]{64}$'),
  constraint guardian_import_batches_status_check
    check (status in ('staged', 'approving', 'committed', 'partially_committed', 'rolled_back')),
  constraint guardian_import_batches_total_count_check check (total_count >= 0),
  constraint guardian_import_batches_ready_count_check check (ready_count >= 0),
  constraint guardian_import_batches_warning_count_check check (warning_count >= 0),
  constraint guardian_import_batches_duplicate_count_check check (duplicate_count >= 0),
  constraint guardian_import_batches_error_count_check check (error_count >= 0),
  constraint guardian_import_batches_created_count_check check (created_count >= 0),
  constraint guardian_import_batches_invitation_count_check check (invitation_count >= 0),
  constraint guardian_import_batches_failed_count_check check (failed_count >= 0)
);

create table public.guardian_import_rows (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.guardian_import_batches(id) on delete cascade,
  row_number integer not null,
  payload jsonb not null,
  row_status text not null,
  issues text[] not null default '{}',
  student_id uuid references public.students(id) on delete restrict,
  guardian_profile_id uuid references public.profiles(id) on delete restrict,
  student_guardian_id uuid references public.student_guardians(id) on delete restrict,
  invitation_id uuid references public.guardian_invitations(id) on delete restrict,
  failure_code text,
  created_at timestamptz not null default now(),
  constraint guardian_import_rows_batch_id_row_number_key unique (batch_id, row_number),
  constraint guardian_import_rows_row_number_check check (row_number >= 1),
  constraint guardian_import_rows_payload_check check (jsonb_typeof(payload) = 'object'),
  constraint guardian_import_rows_row_status_check
    check (row_status in ('ready', 'warning', 'duplicate', 'error', 'created', 'failed', 'skipped')),
  constraint guardian_import_rows_failure_code_check
    check (failure_code is null or failure_code ~ '^[a-z][a-z0-9_]{2,63}$')
);

create index guardian_import_batches_school_created_idx
  on public.guardian_import_batches (school_id, created_at desc);
create index guardian_import_rows_batch_status_idx
  on public.guardian_import_rows (batch_id, row_status, row_number);
create index guardian_import_rows_student_idx
  on public.guardian_import_rows (student_id);

alter table public.guardian_import_batches enable row level security;
alter table public.guardian_import_rows enable row level security;

revoke all on public.guardian_import_batches, public.guardian_import_rows
  from public, anon, authenticated;
grant all on public.guardian_import_batches, public.guardian_import_rows to service_role;

create or replace function public.guardian_import_recount(target_batch_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
begin
  update public.guardian_import_batches b
  set total_count = (select count(*) from public.guardian_import_rows r where r.batch_id = b.id),
      ready_count = (select count(*) from public.guardian_import_rows r where r.batch_id = b.id and r.row_status = 'ready'),
      warning_count = (select count(*) from public.guardian_import_rows r where r.batch_id = b.id and r.row_status = 'warning'),
      duplicate_count = (select count(*) from public.guardian_import_rows r where r.batch_id = b.id and r.row_status = 'duplicate'),
      error_count = (select count(*) from public.guardian_import_rows r where r.batch_id = b.id and r.row_status in ('error', 'failed')),
      created_count = (select count(*) from public.guardian_import_rows r where r.batch_id = b.id and r.row_status = 'created'),
      invitation_count = (select count(*) from public.guardian_import_rows r where r.batch_id = b.id and r.invitation_id is not null),
      failed_count = (select count(*) from public.guardian_import_rows r where r.batch_id = b.id and r.row_status = 'failed')
  where b.id = target_batch_id;
end;
$function$;

create or replace function public.stage_guardian_import_batch(
  target_school_id uuid,
  target_actor_id uuid,
  target_file_name text,
  target_file_sha256 text,
  target_rows jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  batch_id uuid;
  item jsonb;
  row_no integer := 0;
  resolved_student_id uuid;
  resolved_branch_id uuid;
  guardian_email text;
  guardian_name text;
  relationship_type text;
  is_primary_value boolean;
  issues text[];
  row_status_value text;
  duplicate_found boolean;
  student_id_text text;
  student_national_id text;
  student_first_name text;
  student_last_name text;
  student_birth_date text;
begin
  if target_school_id is null or target_actor_id is null or target_rows is null
     or jsonb_typeof(target_rows) <> 'array'
     or jsonb_array_length(target_rows) < 1
     or jsonb_array_length(target_rows) > 5000
     or target_file_sha256 is null
     or target_file_sha256 !~ '^[0-9a-fA-F]{64}$' then
    raise exception using errcode = '22023', message = 'guardian_import_invalid_input';
  end if;

  if not exists (
    select 1
    from public.profiles p
    join public.school_memberships m
      on m.profile_id = p.id and m.school_id = target_school_id and m.status = 'active'
    join public.schools s on s.id = m.school_id and s.status = 'active'
    where p.id = target_actor_id and p.status = 'active'
  ) then
    raise exception using errcode = '42501', message = 'guardian_import_actor_unavailable';
  end if;

  insert into public.guardian_import_batches (school_id, file_name, file_sha256, created_by)
  values (
    target_school_id,
    left(btrim(coalesce(target_file_name, 'guardians-import')), 180),
    lower(target_file_sha256),
    target_actor_id
  )
  returning id into batch_id;

  for item in select value from jsonb_array_elements(target_rows)
  loop
    row_no := row_no + 1;
    issues := '{}';
    resolved_student_id := null;
    resolved_branch_id := null;
    guardian_email := lower(btrim(coalesce(item->>'guardian_email', item->>'email', '')));
    guardian_name := btrim(coalesce(item->>'guardian_name', item->>'full_name', ''));
    relationship_type := lower(btrim(coalesce(item->>'relationship_type', item->>'relationship', '')));
    is_primary_value := coalesce(nullif(item->>'is_primary', '')::boolean, false);
    student_id_text := btrim(coalesce(item->>'student_id', ''));
    student_national_id := nullif(btrim(coalesce(item->>'student_national_id', item->>'national_id', '')), '');
    student_first_name := lower(btrim(coalesce(item->>'student_first_name', '')));
    student_last_name := lower(btrim(coalesce(item->>'student_last_name', '')));
    student_birth_date := btrim(coalesce(item->>'student_birth_date', item->>'birth_date', ''));

    if student_id_text <> '' then
      begin
        resolved_student_id := student_id_text::uuid;
      exception when others then
        issues := array_append(issues, 'student_id_invalid');
      end;
    end if;

    if resolved_student_id is null and student_national_id is not null then
      select s.id into resolved_student_id
      from public.students s
      where s.school_id = target_school_id and btrim(s.national_id) = student_national_id
      limit 1;
    end if;

    if resolved_student_id is null
       and student_first_name <> ''
       and student_last_name <> ''
       and student_birth_date ~ '^\\d{4}-\\d{2}-\\d{2}$' then
      begin
        select s.id into resolved_student_id
        from public.students s
        where s.school_id = target_school_id
          and lower(btrim(s.first_name)) = student_first_name
          and lower(btrim(s.last_name)) = student_last_name
          and s.birth_date = student_birth_date::date
        limit 1;
      exception when others then
        null;
      end;
    end if;

    if resolved_student_id is null then
      issues := array_append(issues, 'student_not_found');
    end if;

    if resolved_student_id is not null then
      select s.branch_id into resolved_branch_id
      from public.students s
      where s.school_id = target_school_id
        and s.id = resolved_student_id
        and s.status not in ('transferred', 'graduated', 'withdrawn');

      if resolved_branch_id is null then
        issues := array_append(issues, 'student_inactive_or_wrong_school');
      end if;
      if not public.has_branch_permission(target_school_id, resolved_branch_id, 'guardians.link') then
        issues := array_append(issues, 'link_permission_denied');
      end if;
      if not public.has_branch_permission(target_school_id, resolved_branch_id, 'guardians.invite') then
        issues := array_append(issues, 'invite_permission_denied');
      end if;
    end if;

    if char_length(guardian_name) < 2 or char_length(guardian_name) > 150 then
      issues := array_append(issues, 'guardian_name_invalid');
    end if;
    if guardian_email !~ '^[^[:space:]@]+@[^[:space:]@]+\\.[^[:space:]@]+$'
       or char_length(guardian_email) > 254 then
      issues := array_append(issues, 'guardian_email_invalid');
    end if;
    if relationship_type not in ('father', 'mother', 'legal_guardian', 'relative', 'other') then
      issues := array_append(issues, 'relationship_invalid');
    end if;

    duplicate_found := false;
    if resolved_student_id is not null
       and guardian_email ~ '^[^[:space:]@]+@[^[:space:]@]+\\.[^[:space:]@]+$' then
      duplicate_found :=
        exists (
          select 1
          from public.guardian_invitations gi
          join public.student_guardians sg
            on sg.id = gi.student_guardian_id
           and sg.school_id = gi.school_id
           and sg.student_id = gi.student_id
          where gi.school_id = target_school_id
            and gi.student_id = resolved_student_id
            and lower(gi.target_email) = guardian_email
            and gi.status in ('prepared', 'sent', 'accepted')
        )
        or exists (
          select 1
          from public.student_guardians sg
          join public.profiles p on p.id = sg.guardian_profile_id
          join auth.users u on u.id = p.id
          where sg.school_id = target_school_id
            and sg.student_id = resolved_student_id
            and lower(u.email) = guardian_email
            and sg.status in ('pending', 'active')
        );
    end if;

    if duplicate_found then
      issues := array_append(issues, 'live_invitation_or_link_exists');
    end if;

    if exists (
      select 1
      from public.guardian_import_rows r
      where r.batch_id = batch_id
        and r.row_status in ('ready', 'warning')
        and r.student_id = resolved_student_id
        and lower(coalesce(r.payload->>'guardian_email', r.payload->>'email', '')) = guardian_email
    ) then
      issues := array_append(issues, 'duplicate_in_file');
    end if;

    if issues && array[
      'student_not_found', 'student_id_invalid', 'student_inactive_or_wrong_school',
      'link_permission_denied', 'invite_permission_denied', 'guardian_name_invalid',
      'guardian_email_invalid', 'relationship_invalid', 'live_invitation_or_link_exists'
    ] then
      row_status_value := 'error';
    elsif 'duplicate_in_file' = any(issues) then
      row_status_value := 'duplicate';
    else
      row_status_value := 'ready';
    end if;

    insert into public.guardian_import_rows (batch_id, row_number, payload, row_status, issues, student_id)
    values (batch_id, row_no, item, row_status_value, issues, resolved_student_id);
  end loop;

  perform public.guardian_import_recount(batch_id);
  return batch_id;
end;
$function$;

create or replace function public.begin_guardian_import_approval(target_batch_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor uuid := (select auth.uid());
  batch public.guardian_import_batches%rowtype;
begin
  select * into batch
  from public.guardian_import_batches
  where id = target_batch_id
  for update;

  if not found or batch.created_by <> actor or batch.status <> 'staged' then
    raise exception using errcode = '42501', message = 'guardian_import_approval_denied';
  end if;

  if batch.error_count > 0 or batch.duplicate_count > 0
     or batch.ready_count + batch.warning_count = 0 then
    raise exception using errcode = '42201', message = 'guardian_import_batch_not_approvable';
  end if;

  update public.guardian_import_batches
  set status = 'approving', approved_at = now()
  where id = target_batch_id;
  return true;
end;
$function$;

create or replace function public.finish_guardian_import_approval(target_batch_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor uuid := (select auth.uid());
  b public.guardian_import_batches%rowtype;
begin
  select * into b
  from public.guardian_import_batches
  where id = target_batch_id and created_by = actor
  for update;

  if not found or b.status <> 'approving' then
    raise exception using errcode = '42501', message = 'guardian_import_approval_denied';
  end if;

  perform public.guardian_import_recount(target_batch_id);

  update public.guardian_import_batches
  set status = case
        when exists (
          select 1 from public.guardian_import_rows
          where batch_id = target_batch_id and row_status = 'failed'
        ) then 'partially_committed'
        else 'committed'
      end,
      committed_at = now()
  where id = target_batch_id;
  return true;
end;
$function$;

create or replace function public.fail_guardian_import_row(
  target_batch_id uuid,
  target_row_id uuid,
  target_failure_code text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor uuid := (select auth.uid());
  affected integer;
begin
  if target_failure_code is null or target_failure_code !~ '^[a-z][a-z0-9_]{2,63}$' then
    raise exception using errcode = '22023', message = 'invalid_failure_code';
  end if;

  update public.guardian_import_rows r
  set row_status = 'failed',
      failure_code = target_failure_code,
      issues = array_append(r.issues, target_failure_code)
  from public.guardian_import_batches b
  where r.id = target_row_id
    and r.batch_id = target_batch_id
    and b.id = r.batch_id
    and b.created_by = actor
    and b.status = 'approving';

  get diagnostics affected = row_count;
  return affected > 0;
end;
$function$;

create or replace function public.finalize_guardian_import_row(
  target_batch_id uuid,
  target_row_id uuid,
  target_guardian_profile_id uuid,
  target_idempotency_key_hash text,
  target_request_payload_hash text,
  target_requires_password_setup boolean
)
returns table(invitation_id uuid, invitation_status text)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor uuid := (select auth.uid());
  b public.guardian_import_batches%rowtype;
  r public.guardian_import_rows%rowtype;
  invitation_record record;
begin
  select * into b
  from public.guardian_import_batches
  where id = target_batch_id and created_by = actor
  for update;

  if not found or b.status <> 'approving' then
    raise exception using errcode = '42501', message = 'guardian_import_approval_denied';
  end if;

  select * into r
  from public.guardian_import_rows
  where id = target_row_id and batch_id = target_batch_id
  for update;

  if not found or r.row_status not in ('ready', 'warning') or r.student_id is null then
    raise exception using errcode = '42201', message = 'guardian_import_row_not_eligible';
  end if;

  select * into invitation_record
  from public.prepare_guardian_invitation(
    b.school_id,
    r.student_id,
    null,
    target_guardian_profile_id,
    lower(btrim(coalesce(r.payload->>'guardian_email', r.payload->>'email', ''))),
    lower(btrim(coalesce(r.payload->>'relationship_type', r.payload->>'relationship', ''))),
    coalesce(nullif(r.payload->>'is_primary', '')::boolean, false),
    target_idempotency_key_hash,
    target_request_payload_hash,
    target_requires_password_setup
  );

  update public.guardian_import_rows
  set guardian_profile_id = target_guardian_profile_id,
      student_guardian_id = (
        select student_guardian_id
        from public.guardian_invitations
        where id = invitation_record.invitation_id
      ),
      invitation_id = invitation_record.invitation_id,
      row_status = 'created',
      failure_code = null
  where id = r.id;

  return query
  select invitation_record.invitation_id, invitation_record.invitation_status;
end;
$function$;

create or replace function public.get_guardian_import_batch(target_batch_id uuid)
returns table (
  batch_id uuid,
  school_id uuid,
  file_name text,
  status text,
  total_count integer,
  ready_count integer,
  warning_count integer,
  duplicate_count integer,
  error_count integer,
  created_count integer,
  invitation_count integer,
  failed_count integer,
  created_at timestamptz,
  approved_at timestamptz,
  committed_at timestamptz,
  rolled_back_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $function$
  select b.id, b.school_id, b.file_name, b.status, b.total_count, b.ready_count,
         b.warning_count, b.duplicate_count, b.error_count, b.created_count,
         b.invitation_count, b.failed_count, b.created_at, b.approved_at,
         b.committed_at, b.rolled_back_at
  from public.guardian_import_batches b
  where b.id = target_batch_id
    and b.created_by = (select auth.uid())
    and public.is_active_school_member(b.school_id);
$function$;

create or replace function public.list_guardian_import_rows(target_batch_id uuid)
returns table (
  row_id uuid,
  row_number integer,
  payload jsonb,
  row_status text,
  issues text[],
  student_id uuid,
  guardian_profile_id uuid,
  student_guardian_id uuid,
  invitation_id uuid,
  failure_code text
)
language sql
stable
security definer
set search_path = ''
as $function$
  select r.id, r.row_number, r.payload, r.row_status, r.issues, r.student_id,
         r.guardian_profile_id, r.student_guardian_id, r.invitation_id, r.failure_code
  from public.guardian_import_rows r
  join public.guardian_import_batches b on b.id = r.batch_id
  where r.batch_id = target_batch_id
    and b.created_by = (select auth.uid())
    and public.is_active_school_member(b.school_id)
  order by r.row_number;
$function$;

create or replace function public.rollback_guardian_import_batch(target_batch_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor uuid := (select auth.uid());
begin
  if not exists (
    select 1
    from public.guardian_import_batches
    where id = target_batch_id
      and created_by = actor
      and status in ('committed', 'partially_committed')
  ) then
    raise exception using errcode = '42501', message = 'guardian_import_rollback_denied';
  end if;

  update public.guardian_import_batches
  set status = 'rolled_back', rolled_back_at = now()
  where id = target_batch_id;
  return 0;
end;
$function$;

commit;
