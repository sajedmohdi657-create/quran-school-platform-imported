import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseClient } from "./supabase";
import {
  canAccessAttendanceClass,
  type AttendanceStatus,
} from "./attendance";
import {
  canAccessMemorizationClass,
  fetchStudentMemorizationRecords,
  type MemorizationRecord,
} from "./memorization";
import {
  buildChargeBalances,
  type PaymentCharge,
  type PaymentRow,
} from "./payments";
import {
  createStudentPhotoUrlMap,
  type EducationLevel,
  type StudentStatus,
} from "./students";
import {
  fetchStudentSchoolTrackAverages,
  type SchoolTermAverage,
} from "./school-track";

export type Student360Profile = {
  id: string;
  branchId: string;
  classId: string | null;
  firstName: string;
  lastName: string;
  educationLevel: EducationLevel | null;
  educationYear: number | null;
  photoUrl: string | null;
  startDate: string;
  status: StudentStatus;
  branchName: string | null;
  className: string | null;
};

export type Student360AttendanceRecord = {
  id: string;
  date: string;
  status: AttendanceStatus;
};

export type Student360Finance = {
  totalDue: number;
  paid: number;
  remaining: number;
  recentPayments: Array<Pick<PaymentRow, "id" | "amount" | "payment_date" | "status">>;
};

export type Student360Section<T> =
  | { state: "hidden" }
  | { state: "ready"; data: T }
  | { state: "error" };

export type Student360Data = {
  profile: Student360Profile;
  attendance: Student360Section<Student360AttendanceRecord[]>;
  memorization: Student360Section<MemorizationRecord[]>;
  schoolTrack: Student360Section<SchoolTermAverage[]>;
  finance: Student360Section<Student360Finance>;
};

type StudentRow = {
  id: string;
  branch_id: string;
  class_id: string | null;
  first_name: string;
  last_name: string;
  education_level: EducationLevel | null;
  education_year: number | null;
  photo_path: string | null;
  start_date: string;
  status: StudentStatus;
};

type LookupRow = {
  id: string;
  name: string;
};

type AttendanceSessionRow = {
  id: string;
  session_date: string;
};

type AttendanceRecordRow = {
  id: string;
  session_id: string;
  status: AttendanceStatus;
};

function sectionFrom<T>(
  result: PromiseSettledResult<T | null>
): Student360Section<T> {
  if (result.status === "rejected") return { state: "error" };
  if (result.value === null) return { state: "hidden" };
  return { state: "ready", data: result.value };
}

const financePermissionCodes = ["finance.view", "finance.manage"] as const;

async function hasAnyFinanceAccess(
  client: SupabaseClient,
  schoolId: string,
  branchId: string
): Promise<boolean> {
  const checks = await Promise.all(
    financePermissionCodes.flatMap(permissionCode => [
      client.rpc("has_school_permission", {
        target_school_id: schoolId,
        target_permission_code: permissionCode,
      }),
      client.rpc("has_branch_permission", {
        target_school_id: schoolId,
        target_branch_id: branchId,
        target_permission_code: permissionCode,
      }),
    ])
  );

  for (const check of checks) {
    if (check.error) throw check.error;
    if (check.data === true) return true;
  }

  return false;
}

async function fetchAttendanceRecords(
  client: SupabaseClient,
  schoolId: string,
  branchId: string,
  classId: string,
  studentId: string
): Promise<Student360AttendanceRecord[] | null> {
  const [canView, canManage] = await Promise.all([
    canAccessAttendanceClass(
      client,
      schoolId,
      branchId,
      classId,
      "attendance.view"
    ),
    canAccessAttendanceClass(
      client,
      schoolId,
      branchId,
      classId,
      "attendance.manage"
    ),
  ]);

  if (!canView && !canManage) return null;

  const { data: sessions, error: sessionsError } = await client
    .from("attendance_sessions")
    .select("id, session_date")
    .eq("school_id", schoolId)
    .eq("branch_id", branchId)
    .eq("class_id", classId)
    .order("session_date", { ascending: false })
    .limit(12);

  if (sessionsError) throw sessionsError;

  const sessionRows = (sessions ?? []) as AttendanceSessionRow[];
  if (sessionRows.length === 0) return [];

  const { data: records, error: recordsError } = await client
    .from("attendance_records")
    .select("id, session_id, status")
    .eq("school_id", schoolId)
    .eq("branch_id", branchId)
    .eq("class_id", classId)
    .eq("student_id", studentId)
    .in(
      "session_id",
      sessionRows.map(session => session.id)
    );

  if (recordsError) throw recordsError;

  const dateBySession = new Map(
    sessionRows.map(session => [session.id, session.session_date])
  );

  return ((records ?? []) as AttendanceRecordRow[])
    .map(record => ({
      id: record.id,
      date: dateBySession.get(record.session_id) ?? "",
      status: record.status,
    }))
    .sort((left, right) => right.date.localeCompare(left.date));
}

async function fetchFinance(
  client: SupabaseClient,
  schoolId: string,
  branchId: string,
  studentId: string
): Promise<Student360Finance | null> {
  if (!(await hasAnyFinanceAccess(client, schoolId, branchId))) return null;

  const [chargesResult, paymentsResult] = await Promise.all([
    client
      .from("student_charges")
      .select(
        "id, branch_id, student_id, fee_plan_id, description, original_amount, net_amount, due_date, status"
      )
      .eq("school_id", schoolId)
      .eq("branch_id", branchId)
      .eq("student_id", studentId)
      .order("due_date", { ascending: false }),
    client
      .from("payments")
      .select(
        "id, school_id, branch_id, student_id, charge_id, amount, payment_method, payment_date, reference_number, notes, status, created_at"
      )
      .eq("school_id", schoolId)
      .eq("branch_id", branchId)
      .eq("student_id", studentId)
      .order("payment_date", { ascending: false })
      .order("created_at", { ascending: false }),
  ]);

  if (chargesResult.error) throw chargesResult.error;
  if (paymentsResult.error) throw paymentsResult.error;

  const charges = (chargesResult.data ?? []) as PaymentCharge[];
  const payments = (paymentsResult.data ?? []) as PaymentRow[];
  const billableCharges = charges.filter(
    charge => charge.status !== "waived" && charge.status !== "cancelled"
  );
  const balances = buildChargeBalances(billableCharges, payments);
  const toAmount = (value: number | string) =>
    typeof value === "number" ? value : Number(value) || 0;

  return {
    totalDue: balances.reduce(
      (total, balance) => total + toAmount(balance.charge.net_amount),
      0
    ),
    paid: balances.reduce((total, balance) => total + balance.paid, 0),
    remaining: balances.reduce(
      (total, balance) => total + balance.remaining,
      0
    ),
    recentPayments: payments.slice(0, 5).map(payment => ({
      id: payment.id,
      amount: payment.amount,
      payment_date: payment.payment_date,
      status: payment.status,
    })),
  };
}

/**
 * Loads a read-only student profile with only the sections whose existing
 * RLS-backed module permissions allow access. It performs no writes.
 */
export async function fetchStudent360(
  schoolId: string,
  studentId: string,
  client: SupabaseClient = getSupabaseClient()
): Promise<Student360Data | null> {
  const { data: student, error: studentError } = await client
    .from("students")
    .select(
      "id, branch_id, class_id, first_name, last_name, education_level, education_year, photo_path, start_date, status"
    )
    .eq("school_id", schoolId)
    .eq("id", studentId)
    .maybeSingle();

  if (studentError) throw studentError;
  if (!student) return null;

  const studentRow = student as StudentRow;
  const [branchResult, classResult, photoUrls] = await Promise.all([
    client
      .from("branches")
      .select("id, name")
      .eq("school_id", schoolId)
      .eq("id", studentRow.branch_id)
      .maybeSingle(),
    studentRow.class_id
      ? client
          .from("classes")
          .select("id, name")
          .eq("school_id", schoolId)
          .eq("branch_id", studentRow.branch_id)
          .eq("id", studentRow.class_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    createStudentPhotoUrlMap([studentRow], client),
  ]);

  if (branchResult.error) throw branchResult.error;
  if (classResult.error) throw classResult.error;

  const profile: Student360Profile = {
    id: studentRow.id,
    branchId: studentRow.branch_id,
    classId: studentRow.class_id,
    firstName: studentRow.first_name,
    lastName: studentRow.last_name,
    educationLevel: studentRow.education_level,
    educationYear: studentRow.education_year,
    photoUrl: photoUrls.get(studentRow.id) ?? null,
    startDate: studentRow.start_date,
    status: studentRow.status,
    branchName: (branchResult.data as LookupRow | null)?.name ?? null,
    className: (classResult.data as LookupRow | null)?.name ?? null,
  };

  const classId = profile.classId;
  if (!classId) {
    const results = await Promise.allSettled([
      fetchFinance(client, schoolId, profile.branchId, profile.id),
      fetchStudentSchoolTrackAverages(
        schoolId,
        profile.branchId,
        null,
        profile.id,
        client
      ),
    ]);

    return {
      profile,
      attendance: { state: "hidden" },
      memorization: { state: "hidden" },
      finance: sectionFrom(results[0]),
      schoolTrack: sectionFrom(results[1]),
    };
  }

  const results = await Promise.allSettled([
    fetchAttendanceRecords(
      client,
      schoolId,
      profile.branchId,
      classId,
      profile.id
    ),
    (async () => {
      const [canView, canManage] = await Promise.all([
        canAccessMemorizationClass(
          client,
          schoolId,
          profile.branchId,
          classId,
          "memorization.view"
        ),
        canAccessMemorizationClass(
          client,
          schoolId,
          profile.branchId,
          classId,
          "memorization.manage"
        ),
      ]);

      if (!canView && !canManage) return null;
      return fetchStudentMemorizationRecords(
        schoolId,
        profile.branchId,
        classId,
        profile.id,
        null,
        client
      );
    })(),
    fetchFinance(client, schoolId, profile.branchId, profile.id),
    fetchStudentSchoolTrackAverages(
      schoolId,
      profile.branchId,
      classId,
      profile.id,
      client
    ),
  ]);

  return {
    profile,
    attendance: sectionFrom(results[0]),
    memorization: sectionFrom(results[1]),
    finance: sectionFrom(results[2]),
    schoolTrack: sectionFrom(results[3]),
  };
}
