-- Store only the student's final average for each of the three school terms.
begin;

create table public.school_term_averages (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null,
  branch_id uuid not null,
  class_id uuid,
  student_id uuid not null,
  academic_year text not null,
  term text not null,
  average numeric(5,2) not null,
  notes text,
  created_by uuid not null default auth.uid() references public.profiles(id),
  updated_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint school_term_averages_student_scope_fk
    foreign key (school_id, branch_id, student_id)
    references public.students (school_id, branch_id, id),
  constraint school_term_averages_class_scope_fk
    foreign key (school_id, branch_id, class_id)
    references public.classes (school_id, branch_id, id),
  constraint school_term_averages_year_check
    check (academic_year ~ '^[0-9]{4}[-/][0-9]{4}$'),
  constraint school_term_averages_term_check
    check (term in ('الفصل الأول', 'الفصل الثاني', 'الفصل الثالث')),
  constraint school_term_averages_average_check
    check (average >= 0 and average <= 20),
  constraint school_term_averages_notes_check
    check (notes is null or char_length(notes) <= 1000),
  constraint school_term_averages_unique_term
    unique (school_id, student_id, academic_year, term)
);

comment on table public.school_term_averages is
  'Final student averages only: one average for each of the three academic terms; no per-subject records.';
comment on column public.school_term_averages.average is
  'Final term average on the Algerian 0–20 grading scale.';

create index school_term_averages_scope_idx
  on public.school_term_averages (school_id, branch_id, academic_year, term, student_id);

alter table public.school_term_averages enable row level security;
revoke all on public.school_term_averages from public, anon, authenticated;
grant select on public.school_term_averages to authenticated;
grant insert (
  school_id, branch_id, class_id, student_id, academic_year, term, average, notes
) on public.school_term_averages to authenticated;
grant update (
  academic_year, term, average, notes
) on public.school_term_averages to authenticated;

create policy school_term_averages_select_authorized
on public.school_term_averages
for select to authenticated
using (
  public.can_access_school_track_class(
    school_id, branch_id, class_id, 'school_track.view'
  )
  or public.can_access_school_track_class(
    school_id, branch_id, class_id, 'school_track.manage'
  )
);

create policy school_term_averages_insert_authorized
on public.school_term_averages
for insert to authenticated
with check (
  created_by = (select auth.uid())
  and updated_by = (select auth.uid())
  and public.can_access_school_track_class(
    school_id, branch_id, class_id, 'school_track.manage'
  )
);

create policy school_term_averages_update_authorized
on public.school_term_averages
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

create or replace function public.set_school_term_average_updated_at()
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

revoke all on function public.set_school_term_average_updated_at() from public, anon, authenticated;
create trigger school_term_averages_updated_at
before update on public.school_term_averages
for each row execute function public.set_school_term_average_updated_at();

commit;
