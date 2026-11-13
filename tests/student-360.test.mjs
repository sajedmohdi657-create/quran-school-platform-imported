import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const [app, students, profile, page] = await Promise.all([
  read("client/src/App.tsx"),
  read("client/src/pages/StudentsList.tsx"),
  read("client/src/lib/student-360.ts"),
  read("client/src/pages/Student360.tsx"),
]);

test("registers Student 360 inside the existing protected app shell", () => {
  assert.match(app, /const Student360 = lazy/);
  assert.match(app, /path="\/students\/:studentId"/);
  assert.match(app, /<ProtectedRoute>[\s\S]*?<Shell>[\s\S]*?<Student360 \/>/);
});

test("uses the requested student id and school tenant boundary", () => {
  assert.match(profile, /export async function fetchStudent360/);
  assert.match(profile, /\.eq\("school_id", schoolId\)/);
  assert.match(profile, /\.eq\("id", studentId\)/);
  assert.match(profile, /\.eq\("branch_id", studentRow\.branch_id\)/);
});

test("keeps attendance and memorization scoped to existing module access", () => {
  assert.match(profile, /canAccessAttendanceClass/);
  assert.match(profile, /canAccessMemorizationClass/);
  assert.match(profile, /if \(!canView && !canManage\) return null/);
  assert.match(profile, /fetchStudentMemorizationRecords/);
  assert.match(page, /data\.memorization\.state !== "hidden"/);
  assert.match(profile, /fetchStudentSchoolTrackAverages/);
  assert.match(page, /data\.schoolTrack\.state !== "hidden"/);
  assert.match(page, /معدلات الفصول الدراسية الثلاثة فقط/);
});

test("shows finance only after existing finance permissions succeed", () => {
  assert.match(profile, /has_school_permission/);
  assert.match(profile, /has_branch_permission/);
  assert.match(profile, /if \(!\(await hasAnyFinanceAccess/);
  assert.doesNotMatch(profile, /teacher/);
  assert.match(page, /data\.finance\.state !== "hidden"/);
});

test("covers empty, missing, and isolated section-error states", () => {
  assert.match(page, /تعذر العثور على ملف الطالب/);
  assert.match(page, /لا توجد سجلات حضور/);
  assert.match(page, /لا توجد متابعات حفظ أو مراجعة/);
  assert.match(page, /لم يؤثر هذا الخطأ على بقية ملف الطالب/);
  assert.match(profile, /Promise\.allSettled/);
});

test("links StudentsList entries to the Student 360 route", () => {
  assert.match(students, /setLocation\(\`\/students\/\$\{student\.id\}\`\)/);
  assert.match(students, /viewProfile/);
});

test("contains no privileged client access or Student 360 writes", () => {
  const source = [profile, page].join("\n");
  assert.doesNotMatch(source, /service_role/i);
  assert.doesNotMatch(source, /\.insert\(/);
  assert.doesNotMatch(source, /\.update\(/);
  assert.doesNotMatch(source, /\.delete\(/);
});
