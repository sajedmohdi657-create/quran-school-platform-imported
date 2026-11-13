import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [migration, handler, services, app, config, page, profile] = await Promise.all([
  read("supabase/067_school_track_results.sql"),
  read("supabase/functions/analyze-school-track/handler.ts"),
  read("supabase/functions/analyze-school-track/services.ts"),
  read("client/src/App.tsx"),
  read("supabase/config.toml"),
  read("client/src/pages/SchoolTrackAverages.tsx"),
  read("client/src/lib/student-360.ts"),
]);

test("creates branch-scoped school assessment results with configurable maximums", () => {
  assert.match(migration, /create table public\.school_track_results/);
  assert.match(migration, /foreign key \(school_id, branch_id, student_id\)/);
  assert.match(migration, /foreign key \(school_id, branch_id, class_id\)/);
  assert.match(migration, /check \(score >= 0 and max_score > 0/);
  assert.match(migration, /score <= max_score/);
  assert.match(migration, /assessment_type in \('quiz', 'test', 'exam', 'oral', 'continuous', 'other'\)/);
});

test("protects result reads and audited corrections through RLS without browser delete", () => {
  assert.match(migration, /alter table public\.school_track_results enable row level security/);
  assert.match(migration, /school_track_results_select_authorized/);
  assert.match(migration, /school_track_results_insert_authorized/);
  assert.match(migration, /school_track_results_update_authorized/);
  assert.match(migration, /create table public\.school_track_result_history/);
  assert.match(migration, /create trigger school_track_results_audit/);
  assert.match(migration, /from public, anon, authenticated/);
  assert.doesNotMatch(migration, /grant delete on public\.school_track_results/i);
  assert.doesNotMatch(page, /\.delete\(/);
});

test("limits AI analysis to authenticated, authorized pseudonymous data", () => {
  assert.match(handler, /getBearerToken/);
  assert.match(handler, /canViewSchoolTrack/);
  assert.match(handler, /listTermAverages/);
  assert.match(handler, /termAverages/);
  assert.doesNotMatch(handler, /SchoolAssessmentSignal|schoolResults|subject|assessmentType|score|maxScore/);
  assert.match(handler, /canViewQuranProgress/);
  assert.match(handler, /MAX_REQUESTS_PER_WINDOW/);
  assert.match(handler, /slice\(0, 40\)/);
  assert.match(services, /Authorization: `Bearer \$\{token\}`/);
  assert.match(services, /can_access_school_track_class/);
  assert.match(services, /from\("school_term_averages"\)/);
  assert.doesNotMatch(services, /school_track_results|subject|assessment_type|score|max_score/);
  assert.match(services, /can_access_memorization_class/);
  assert.match(services, /OPENAI_API_KEY/);
  assert.doesNotMatch(services, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(handler, /studentName|fullName|national_id|email/);
});

test("registers a separately guarded route and combines results in student profile", () => {
  assert.match(app, /path="\/school-track"/);
  assert.match(app, /<SchoolTrackRoute>/);
  assert.match(config, /\[functions\.analyze-school-track\]\s+verify_jwt = true/);
  assert.match(profile, /fetchStudentSchoolTrackAverages/);
  assert.match(page, /الدراسية الثلاثة فقط/);
  assert.doesNotMatch(page, /المادة|subject|assessment_title/);
});
