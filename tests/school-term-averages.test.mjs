import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [migration, page, app] = await Promise.all([
  read("supabase/086_school_term_averages.sql"),
  read("client/src/pages/SchoolTrackAverages.tsx"),
  read("client/src/App.tsx"),
]);

test("stores only one final average per student for each of the three terms", () => {
  assert.match(migration, /create table public\.school_term_averages/);
  assert.match(migration, /term in \('الفصل الأول', 'الفصل الثاني', 'الفصل الثالث'\)/);
  assert.match(migration, /average >= 0 and average <= 20/);
  assert.match(migration, /unique \(school_id, student_id, academic_year, term\)/);
  assert.doesNotMatch(migration, /subject|assessment_title|assessment_type/i);
});

test("protects term averages with branch and class authorization", () => {
  assert.match(migration, /enable row level security/);
  assert.match(migration, /can_access_school_track_class/);
  assert.match(migration, /for insert to authenticated/);
  assert.match(migration, /for update to authenticated/);
  assert.doesNotMatch(migration, /for delete/i);
});

test("renders only the three term averages without subject controls or columns", () => {
  assert.match(page, /الفصل الأول/);
  assert.match(page, /الفصل الثاني/);
  assert.match(page, /الفصل الثالث/);
  assert.match(page, /معدل الفصل/);
  assert.doesNotMatch(page, /المادة|المواد|subject|assessment_title/i);
  assert.match(app, /import\("\.\/pages\/SchoolTrackAverages"\)/);
});
