import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseClient } from "./supabase.ts";

export const SCHOOL_ASSESSMENT_TYPES = [
  "quiz",
  "test",
  "exam",
  "oral",
  "continuous",
  "other",
] as const;
export type SchoolAssessmentType = (typeof SCHOOL_ASSESSMENT_TYPES)[number];

export type SchoolTrackBranch = {
  id: string;
  name: string;
  isMain: boolean;
};
export type SchoolTrackClass = {
  id: string;
  branchId: string;
  name: string;
  scheduleLabel: string | null;
};
export type SchoolTrackScope = {
  branches: SchoolTrackBranch[];
  classes: SchoolTrackClass[];
  viewBranchIds: string[];
  manageBranchIds: string[];
  viewClassIds: string[];
  manageClassIds: string[];
  canView: boolean;
  canManage: boolean;
};

export type SchoolTrackStudent = {
  id: string;
  branch_id: string;
  class_id: string | null;
  first_name: string;
  last_name: string;
  education_level: string | null;
  education_year: number | null;
};

export type SchoolTrackResult = {
  id: string;
  school_id: string;
  branch_id: string;
  class_id: string | null;
  student_id: string;
  subject: string;
  assessment_title: string;
  assessment_type: SchoolAssessmentType;
  academic_year: string;
  term: string;
  assessment_date: string;
  score: number;
  max_score: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type SchoolTrackResultInput = {
  branchId: string;
  classId: string | null;
  studentId: string;
  subject: string;
  assessmentTitle: string;
  assessmentType: SchoolAssessmentType;
  academicYear: string;
  term: string;
  assessmentDate: string;
  score: number;
  maxScore: number;
  notes: string;
};

export type SchoolTrackFilters = {
  branchId: string;
  classId: string;
  studentId: string;
  academicYear: string;
  term: string;
  subject: string;
};

type BranchRow = { id: string; name: string; is_main: boolean };
type ClassRow = {
  id: string;
  branch_id: string;
  name: string;
  schedule_label: string | null;
};

const RESULT_COLUMNS =
  "id, school_id, branch_id, class_id, student_id, subject, assessment_title, assessment_type, academic_year, term, assessment_date, score, max_score, notes, created_at, updated_at";

async function permission(
  client: SupabaseClient,
  schoolId: string,
  branchId: string,
  classId: string | null,
  permissionCode: "school_track.view" | "school_track.manage"
): Promise<boolean> {
  if (classId) {
    const { data, error } = await client.rpc("can_access_school_track_class", {
      target_school_id: schoolId,
      target_branch_id: branchId,
      target_class_id: classId,
      target_permission_code: permissionCode,
    });
    if (error) throw error;
    return data === true;
  }

  const { data, error } = await client.rpc("has_branch_permission", {
    target_school_id: schoolId,
    target_branch_id: branchId,
    target_permission_code: permissionCode,
  });
  if (error) throw error;
  return data === true;
}

/** Loads the exact branch/class scope enforced again by database RLS. */
export async function fetchSchoolTrackScope(
  schoolId: string,
  client: SupabaseClient = getSupabaseClient()
): Promise<SchoolTrackScope> {
  const [branchResult, classResult] = await Promise.all([
    client
      .from("branches")
      .select("id, name, is_main")
      .eq("school_id", schoolId)
      .eq("status", "active")
      .order("is_main", { ascending: false })
      .order("name", { ascending: true }),
    client
      .from("classes")
      .select("id, branch_id, name, schedule_label")
      .eq("school_id", schoolId)
      .eq("status", "active")
      .order("name", { ascending: true }),
  ]);
  if (branchResult.error) throw branchResult.error;
  if (classResult.error) throw classResult.error;

  const branchRows = (branchResult.data ?? []) as BranchRow[];
  const classRows = (classResult.data ?? []) as ClassRow[];
  const branchChecks = await Promise.all(
    branchRows.map(async branch => {
      const [canView, canManage] = await Promise.all([
        permission(client, schoolId, branch.id, null, "school_track.view"),
        permission(client, schoolId, branch.id, null, "school_track.manage"),
      ]);
      return { branch, canView: canView || canManage, canManage };
    })
  );

  const viewBranchIds = branchChecks
    .filter(item => item.canView)
    .map(item => item.branch.id);
  const manageBranchIds = branchChecks
    .filter(item => item.canManage)
    .map(item => item.branch.id);
  const viewClassIds = new Set<string>();
  const manageClassIds = new Set<string>();

  for (const check of branchChecks) {
    const classesInBranch = classRows.filter(
      item => item.branch_id === check.branch.id
    );
    if (check.canView) {
      classesInBranch.forEach(item => viewClassIds.add(item.id));
      if (check.canManage) {
        classesInBranch.forEach(item => manageClassIds.add(item.id));
      }
      continue;
    }
    const classChecks = await Promise.all(
      classesInBranch.map(async item => {
        const [canView, canManage] = await Promise.all([
          permission(client, schoolId, item.branch_id, item.id, "school_track.view"),
          permission(client, schoolId, item.branch_id, item.id, "school_track.manage"),
        ]);
        return { id: item.id, canView: canView || canManage, canManage };
      })
    );
    classChecks.forEach(item => {
      if (item.canView) viewClassIds.add(item.id);
      if (item.canManage) manageClassIds.add(item.id);
    });
  }

  const visibleBranchIds = new Set([
    ...viewBranchIds,
    ...classRows
      .filter(item => viewClassIds.has(item.id))
      .map(item => item.branch_id),
  ]);
  return {
    branches: branchRows
      .filter(item => visibleBranchIds.has(item.id))
      .map(item => ({ id: item.id, name: item.name, isMain: item.is_main })),
    classes: classRows
      .filter(item => viewClassIds.has(item.id))
      .map(item => ({
        id: item.id,
        branchId: item.branch_id,
        name: item.name,
        scheduleLabel: item.schedule_label,
      })),
    viewBranchIds,
    manageBranchIds,
    viewClassIds: [...viewClassIds],
    manageClassIds: [...manageClassIds],
    canView: viewBranchIds.length > 0 || viewClassIds.size > 0,
    canManage: manageBranchIds.length > 0 || manageClassIds.size > 0,
  };
}

export function canViewSchoolTrackStudent(
  scope: SchoolTrackScope,
  student: Pick<SchoolTrackStudent, "branch_id" | "class_id">
): boolean {
  return (
    scope.viewBranchIds.includes(student.branch_id) ||
    (student.class_id !== null && scope.viewClassIds.includes(student.class_id))
  );
}

export function canManageSchoolTrackStudent(
  scope: SchoolTrackScope,
  student: Pick<SchoolTrackStudent, "branch_id" | "class_id">
): boolean {
  return (
    scope.manageBranchIds.includes(student.branch_id) ||
    (student.class_id !== null && scope.manageClassIds.includes(student.class_id))
  );
}

export function getCurrentAcademicYear(now = new Date()): string {
  const startYear = now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1;
  return `${startYear}/${startYear + 1}`;
}

export function getCurrentTerm(now = new Date()): string {
  const month = now.getMonth() + 1;
  if (month >= 9) return "الفصل الأول";
  if (month <= 3) return "الفصل الثاني";
  return "الفصل الثالث";
}

export function getDefaultSchoolTrackFilters(now = new Date()): SchoolTrackFilters {
  return {
    branchId: "",
    classId: "",
    studentId: "",
    academicYear: getCurrentAcademicYear(now),
    term: "",
    subject: "",
  };
}

export function getSchoolTrackPercentage(
  score: number,
  maxScore: number
): number {
  if (!Number.isFinite(score) || !Number.isFinite(maxScore) || maxScore <= 0) {
    return 0;
  }
  return Math.min(100, Math.max(0, (score / maxScore) * 100));
}

export type SchoolTrackEvaluation =
  | "excellent"
  | "very_good"
  | "good"
  | "acceptable"
  | "needs_support";

const SCHOOL_TRACK_EVALUATION_LABELS = {
  ar: {
    excellent: "ممتاز",
    very_good: "جيد جدًا",
    good: "جيد",
    acceptable: "مقبول",
    needs_support: "يحتاج متابعة",
  },
  en: {
    excellent: "Excellent",
    very_good: "Very good",
    good: "Good",
    acceptable: "Satisfactory",
    needs_support: "Needs support",
  },
} as const;

export function getSchoolTrackEvaluationLabel(
  evaluation: SchoolTrackEvaluation,
  locale: "ar" | "en" = "ar"
): string {
  return SCHOOL_TRACK_EVALUATION_LABELS[locale][evaluation];
}

export function evaluateSchoolTrackScore(
  score: number,
  maxScore: number
): SchoolTrackEvaluation {
  const percentage = getSchoolTrackPercentage(score, maxScore);
  if (percentage >= 90) return "excellent";
  if (percentage >= 80) return "very_good";
  if (percentage >= 70) return "good";
  if (percentage >= 50) return "acceptable";
  return "needs_support";
}

export function validateSchoolTrackResult(
  input: SchoolTrackResultInput
): string | null {
  const academicYear = input.academicYear.trim();
  const term = input.term.trim();
  const subject = input.subject.trim();
  const title = input.assessmentTitle.trim();
  if (!input.branchId || !input.studentId) return "student_required";
  if (!subject || subject.length > 100) return "subject_invalid";
  if (!title || title.length > 120) return "assessment_title_invalid";
  if (!/^\d{4}[-/]\d{4}$/.test(academicYear)) return "academic_year_invalid";
  if (!term || term.length > 60) return "term_invalid";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.assessmentDate)) return "date_invalid";
  const parsedDate = new Date(`${input.assessmentDate}T00:00:00.000Z`);
  if (
    Number.isNaN(parsedDate.getTime()) ||
    parsedDate.toISOString().slice(0, 10) !== input.assessmentDate
  ) return "date_invalid";
  if (!SCHOOL_ASSESSMENT_TYPES.includes(input.assessmentType)) return "assessment_type_invalid";
  if (
    !Number.isFinite(input.score) ||
    !Number.isFinite(input.maxScore) ||
    input.score < 0 ||
    input.maxScore <= 0 ||
    input.maxScore > 1000 ||
    input.score > input.maxScore
  ) {
    return "score_invalid";
  }
  if (input.notes.length > 2000) return "notes_too_long";
  return null;
}

function normalizeResult(row: Record<string, unknown>): SchoolTrackResult {
  return {
    ...(row as unknown as SchoolTrackResult),
    score: Number(row.score),
    max_score: Number(row.max_score),
  };
}

export async function fetchSchoolTrackResults(
  schoolId: string,
  filters: SchoolTrackFilters,
  client: SupabaseClient = getSupabaseClient()
): Promise<SchoolTrackResult[]> {
  let query = client
    .from("school_track_results")
    .select(RESULT_COLUMNS)
    .eq("school_id", schoolId)
    .order("assessment_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1000);
  if (filters.branchId) query = query.eq("branch_id", filters.branchId);
  if (filters.classId) query = query.eq("class_id", filters.classId);
  if (filters.studentId) query = query.eq("student_id", filters.studentId);
  if (filters.academicYear.trim()) {
    query = query.eq("academic_year", filters.academicYear.trim());
  }
  if (filters.term.trim()) query = query.eq("term", filters.term.trim());
  if (filters.subject.trim()) query = query.ilike("subject", `%${filters.subject.trim()}%`);

  const { data, error } = await query;
  if (error) throw error;
  return ((data ?? []) as Array<Record<string, unknown>>).map(normalizeResult);
}

export async function fetchStudentSchoolTrackResults(
  schoolId: string,
  branchId: string,
  classId: string | null,
  studentId: string,
  client: SupabaseClient = getSupabaseClient()
): Promise<SchoolTrackResult[] | null> {
  const [canView, canManage] = await Promise.all([
    permission(client, schoolId, branchId, classId, "school_track.view"),
    permission(client, schoolId, branchId, classId, "school_track.manage"),
  ]);
  if (!canView && !canManage) return null;
  const { data, error } = await client
    .from("school_track_results")
    .select(RESULT_COLUMNS)
    .eq("school_id", schoolId)
    .eq("branch_id", branchId)
    .eq("student_id", studentId)
    .order("assessment_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(10);
  if (error) throw error;
  return ((data ?? []) as Array<Record<string, unknown>>).map(normalizeResult);
}


export type SchoolTermAverage = {
  id: string;
  school_id: string;
  branch_id: string;
  class_id: string | null;
  student_id: string;
  academic_year: string;
  term: string;
  average: number;
  updated_at: string;
};

const TERM_ORDER = new Map([
  ["الفصل الأول", 1],
  ["الفصل الثاني", 2],
  ["الفصل الثالث", 3],
]);

export async function fetchStudentSchoolTrackAverages(
  schoolId: string,
  branchId: string,
  classId: string | null,
  studentId: string,
  client: SupabaseClient = getSupabaseClient()
): Promise<SchoolTermAverage[] | null> {
  const [canView, canManage] = await Promise.all([
    permission(client, schoolId, branchId, classId, "school_track.view"),
    permission(client, schoolId, branchId, classId, "school_track.manage"),
  ]);
  if (!canView && !canManage) return null;

  const { data, error } = await client
    .from("school_term_averages")
    .select("id, school_id, branch_id, class_id, student_id, academic_year, term, average, updated_at")
    .eq("school_id", schoolId)
    .eq("branch_id", branchId)
    .eq("student_id", studentId)
    .order("academic_year", { ascending: false })
    .limit(12);
  if (error) throw error;

  return ((data ?? []) as Array<Record<string, unknown>>)
    .map(row => ({
      id: String(row.id),
      school_id: String(row.school_id),
      branch_id: String(row.branch_id),
      class_id: typeof row.class_id === "string" ? row.class_id : null,
      student_id: String(row.student_id),
      academic_year: String(row.academic_year),
      term: String(row.term),
      average: Number(row.average),
      updated_at: String(row.updated_at),
    }))
    .sort((left, right) =>
      right.academic_year.localeCompare(left.academic_year) ||
      (TERM_ORDER.get(left.term) ?? 99) - (TERM_ORDER.get(right.term) ?? 99)
    );
}

export async function createSchoolTrackResult(
  schoolId: string,
  input: SchoolTrackResultInput,
  client: SupabaseClient = getSupabaseClient()
): Promise<SchoolTrackResult> {
  const invalid = validateSchoolTrackResult(input);
  if (invalid) throw new Error(invalid);
  const { data, error } = await client
    .from("school_track_results")
    .insert({
      school_id: schoolId,
      branch_id: input.branchId,
      class_id: input.classId,
      student_id: input.studentId,
      subject: input.subject.trim(),
      assessment_title: input.assessmentTitle.trim(),
      assessment_type: input.assessmentType,
      academic_year: input.academicYear.trim(),
      term: input.term.trim(),
      assessment_date: input.assessmentDate,
      score: input.score,
      max_score: input.maxScore,
      notes: input.notes.trim() || null,
    })
    .select(RESULT_COLUMNS)
    .single();
  if (error) throw error;
  return normalizeResult(data as Record<string, unknown>);
}

export async function updateSchoolTrackResult(
  resultId: string,
  input: Pick<
    SchoolTrackResultInput,
    | "subject"
    | "assessmentTitle"
    | "assessmentType"
    | "academicYear"
    | "term"
    | "assessmentDate"
    | "score"
    | "maxScore"
    | "notes"
  >,
  branchId: string,
  classId: string | null,
  studentId: string,
  client: SupabaseClient = getSupabaseClient()
): Promise<SchoolTrackResult> {
  const invalid = validateSchoolTrackResult({ ...input, branchId, classId, studentId });
  if (invalid) throw new Error(invalid);
  const { data, error } = await client
    .from("school_track_results")
    .update({
      subject: input.subject.trim(),
      assessment_title: input.assessmentTitle.trim(),
      assessment_type: input.assessmentType,
      academic_year: input.academicYear.trim(),
      term: input.term.trim(),
      assessment_date: input.assessmentDate,
      score: input.score,
      max_score: input.maxScore,
      notes: input.notes.trim() || null,
    })
    .eq("id", resultId)
    .select(RESULT_COLUMNS)
    .single();
  if (error) throw error;
  return normalizeResult(data as Record<string, unknown>);
}

export function summarizeSchoolTrackResults(results: SchoolTrackResult[]) {
  const percentages = results.map(item =>
    getSchoolTrackPercentage(item.score, item.max_score)
  );
  const average = percentages.length
    ? percentages.reduce((total, value) => total + value, 0) / percentages.length
    : null;
  const bySubject = new Map<string, { sum: number; count: number }>();
  results.forEach(item => {
    const key = item.subject.trim();
    const value = bySubject.get(key) ?? { sum: 0, count: 0 };
    value.sum += getSchoolTrackPercentage(item.score, item.max_score);
    value.count += 1;
    bySubject.set(key, value);
  });
  return {
    count: results.length,
    studentCount: new Set(results.map(item => item.student_id)).size,
    averagePercentage: average,
    needsSupportCount: results.filter(
      item => getSchoolTrackPercentage(item.score, item.max_score) < 50
    ).length,
    subjects: [...bySubject.entries()]
      .map(([subject, value]) => ({
        subject,
        averagePercentage: value.sum / value.count,
        count: value.count,
      }))
      .sort((left, right) => left.subject.localeCompare(right.subject, "ar")),
  };
}

export function buildSchoolTrackCsv(results: SchoolTrackResult[]): string {
  const rows = [
    ["student_id", "subject", "assessment_title", "assessment_type", "academic_year", "term", "assessment_date", "score", "max_score", "percentage", "notes"],
    ...results.map(item => [
      item.student_id,
      item.subject,
      item.assessment_title,
      item.assessment_type,
      item.academic_year,
      item.term,
      item.assessment_date,
      String(item.score),
      String(item.max_score),
      getSchoolTrackPercentage(item.score, item.max_score).toFixed(1),
      item.notes ?? "",
    ]),
  ];
  return "\uFEFF" + rows.map(row => row.map(csvCell).join(",")).join("\r\n");
}

function csvCell(value: string): string {
  let safe = value.replace(/[\r\n]+/g, " ");
  if (/^[=+@\-]/.test(safe)) safe = `'${safe}`;
  return `"${safe.replace(/"/g, '""')}"`;
}
