import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseClient } from "./supabase";

export type ParentStudent = {
  schoolId: string;
  schoolName: string;
  studentId: string;
  firstName: string;
  lastName: string;
  branchId: string;
  branchName: string;
  classId: string | null;
  className: string | null;
  relationshipType: string;
  isPrimary: boolean;
};

export type ParentAttendanceSummary = {
  totalRecords: number;
  presentCount: number;
  absentCount: number;
  lateCount: number;
  excusedAbsenceCount: number;
  lastSessionDate: string | null;
};

export type ParentAttendanceRecord = {
  id: string;
  date: string;
  status: string;
  arrivalTime: string | null;
};

export type ParentMemorizationSummary = {
  totalRecords: number;
  averageRating: number | null;
  totalErrors: number;
  lastRecordDate: string | null;
};

export type ParentMemorizationRecord = {
  id: string;
  date: string;
  sessionType: string;
  surahNumber: number;
  ayahStart: number;
  ayahEnd: number;
  rating: number;
  errorsCount: number;
  recitationResult: string | null;
  recitationAccuracy: string | null;
  focusWords: string | null;
  nextAssignment: string | null;
};

export type ParentStudentAcademicData = {
  attendanceSummary: ParentAttendanceSummary;
  attendanceRecords: ParentAttendanceRecord[];
  memorizationSummary: ParentMemorizationSummary;
  memorizationRecords: ParentMemorizationRecord[];
};

export type ParentLearningTarget = {
  id: string;
  targetKind: "new_memorization" | "revision";
  surahNumber: number;
  ayahStart: number;
  ayahEnd: number;
  assignedOn: string;
  dueOn: string;
  completed: boolean;
  overdue: boolean;
};

export type ParentLearningFollowUp = {
  targets: ParentLearningTarget[];
  attendance: { absenceCount: number; lateCount: number };
};

export type ParentFinanceSummary = {
  totalCharged: number;
  totalPaid: number;
  remainingAmount: number;
  overdueAmount: number;
  openChargesCount: number;
  lastPaymentDate: string | null;
};

export type ParentFinanceCharge = {
  id: string;
  chargeType: string;
  description: string;
  originalAmount: number;
  discountAmount: number;
  netAmount: number;
  dueDate: string;
  status: string;
  paidAmount: number;
  remainingAmount: number;
  isOverdue: boolean;
};

export type ParentFinancePayment = {
  id: string;
  chargeId: string;
  chargeDescription: string;
  amount: number;
  paymentMethod: string;
  paymentDate: string;
  status: string;
};

export type ParentStudentFinanceData = {
  summary: ParentFinanceSummary;
  charges: ParentFinanceCharge[];
  payments: ParentFinancePayment[];
};

function asNumber(value: unknown): number {
  const numberValue = Number(value ?? 0);
  return Number.isFinite(numberValue) ? numberValue : 0;
}

function asNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

export async function listMyGuardianStudents(
  client: SupabaseClient = getSupabaseClient()
): Promise<ParentStudent[]> {
  const { data, error } = await client.rpc("list_my_guardian_students");
  if (error) throw error;

  return (Array.isArray(data) ? data : []).map(row => ({
    schoolId: row.school_id,
    schoolName: row.school_name,
    studentId: row.student_id,
    firstName: row.student_first_name,
    lastName: row.student_last_name,
    branchId: row.branch_id,
    branchName: row.branch_name,
    classId: row.class_id ?? null,
    className: row.class_name ?? null,
    relationshipType: row.relationship_type,
    isPrimary: row.is_primary === true,
  }));
}

export async function fetchParentStudentAcademic(
  schoolId: string,
  studentId: string,
  client: SupabaseClient = getSupabaseClient()
): Promise<ParentStudentAcademicData> {
  const [attendanceSummaryResult, attendanceResult, memorizationSummaryResult, memorizationResult] =
    await Promise.all([
      client.rpc("get_my_guardian_student_attendance_summary", {
        target_school_id: schoolId,
        target_student_id: studentId,
      }),
      client.rpc("list_my_guardian_student_attendance", {
        target_school_id: schoolId,
        target_student_id: studentId,
        target_limit: 30,
      }),
      client.rpc("get_my_guardian_student_memorization_summary", {
        target_school_id: schoolId,
        target_student_id: studentId,
      }),
      client.rpc("list_my_guardian_student_memorization", {
        target_school_id: schoolId,
        target_student_id: studentId,
        target_limit: 20,
      }),
    ]);

  const firstError = [
    attendanceSummaryResult.error,
    attendanceResult.error,
    memorizationSummaryResult.error,
    memorizationResult.error,
  ].find(Boolean);
  if (firstError) throw firstError;

  const attendanceSummaryRow = Array.isArray(attendanceSummaryResult.data)
    ? attendanceSummaryResult.data[0]
    : null;
  const memorizationSummaryRow = Array.isArray(memorizationSummaryResult.data)
    ? memorizationSummaryResult.data[0]
    : null;

  return {
    attendanceSummary: {
      totalRecords: asNumber(attendanceSummaryRow?.total_records),
      presentCount: asNumber(attendanceSummaryRow?.present_count),
      absentCount: asNumber(attendanceSummaryRow?.absent_count),
      lateCount: asNumber(attendanceSummaryRow?.late_count),
      excusedAbsenceCount: asNumber(attendanceSummaryRow?.excused_absence_count),
      lastSessionDate: attendanceSummaryRow?.last_session_date ?? null,
    },
    attendanceRecords: (Array.isArray(attendanceResult.data)
      ? attendanceResult.data
      : []
    ).map(row => ({
      id: row.attendance_record_id,
      date: row.session_date,
      status: row.attendance_status,
      arrivalTime: row.arrival_time ?? null,
    })),
    memorizationSummary: {
      totalRecords: asNumber(memorizationSummaryRow?.total_records),
      averageRating: asNullableNumber(memorizationSummaryRow?.average_rating),
      totalErrors: asNumber(memorizationSummaryRow?.total_errors),
      lastRecordDate: memorizationSummaryRow?.last_record_date ?? null,
    },
    memorizationRecords: (Array.isArray(memorizationResult.data)
      ? memorizationResult.data
      : []
    ).map(row => ({
      id: row.memorization_record_id,
      date: row.record_date,
      sessionType: row.session_type,
      surahNumber: asNumber(row.surah_number),
      ayahStart: asNumber(row.ayah_start),
      ayahEnd: asNumber(row.ayah_end),
      rating: asNumber(row.rating),
      errorsCount: asNumber(row.errors_count),
      recitationResult: row.recitation_result ?? null,
      recitationAccuracy: row.recitation_accuracy ?? null,
      focusWords: row.focus_words ?? null,
      nextAssignment: row.next_assignment ?? null,
    })),
  };
}

export async function fetchParentStudentLearningFollowUp(
  schoolId: string,
  studentId: string,
  client: SupabaseClient = getSupabaseClient()
): Promise<ParentLearningFollowUp> {
  const { data, error } = await client.rpc("get_my_guardian_learning_follow_up", {
    target_school_id: schoolId,
    target_student_id: studentId,
    target_limit: 50,
  });
  if (error) throw error;
  const result = (data ?? {}) as Record<string, unknown>;
  const attendance = (result.attendance ?? {}) as Record<string, unknown>;
  return {
    targets: (Array.isArray(result.targets) ? result.targets : []).map(value => {
      const row = value as Record<string, unknown>;
      return {
        id: String(row.id ?? ""),
        targetKind: row.target_kind as ParentLearningTarget["targetKind"],
        surahNumber: asNumber(row.surah_number),
        ayahStart: asNumber(row.ayah_start),
        ayahEnd: asNumber(row.ayah_end),
        assignedOn: String(row.assigned_on ?? ""),
        dueOn: String(row.due_on ?? ""),
        completed: row.completed === true,
        overdue: row.overdue === true,
      };
    }),
    attendance: {
      absenceCount: asNumber(attendance.absence_count),
      lateCount: asNumber(attendance.late_count),
    },
  };
}

export async function fetchParentStudentFinance(
  schoolId: string,
  studentId: string,
  client: SupabaseClient = getSupabaseClient()
): Promise<ParentStudentFinanceData> {
  const [summaryResult, chargesResult, paymentsResult] = await Promise.all([
    client.rpc("get_my_guardian_student_finance_summary", {
      target_school_id: schoolId,
      target_student_id: studentId,
    }),
    client.rpc("list_my_guardian_student_charges", {
      target_school_id: schoolId,
      target_student_id: studentId,
      target_limit: 30,
    }),
    client.rpc("list_my_guardian_student_payments", {
      target_school_id: schoolId,
      target_student_id: studentId,
      target_limit: 30,
    }),
  ]);

  const firstError = [summaryResult.error, chargesResult.error, paymentsResult.error].find(Boolean);
  if (firstError) throw firstError;

  const summaryRow = Array.isArray(summaryResult.data) ? summaryResult.data[0] : null;

  return {
    summary: {
      totalCharged: asNumber(summaryRow?.total_charged),
      totalPaid: asNumber(summaryRow?.total_paid),
      remainingAmount: asNumber(summaryRow?.remaining_amount),
      overdueAmount: asNumber(summaryRow?.overdue_amount),
      openChargesCount: asNumber(summaryRow?.open_charges_count),
      lastPaymentDate: summaryRow?.last_payment_date ?? null,
    },
    charges: (Array.isArray(chargesResult.data) ? chargesResult.data : []).map(row => ({
      id: row.charge_id,
      chargeType: row.charge_type,
      description: row.description,
      originalAmount: asNumber(row.original_amount),
      discountAmount: asNumber(row.discount_amount),
      netAmount: asNumber(row.net_amount),
      dueDate: row.due_date,
      status: row.charge_status,
      paidAmount: asNumber(row.paid_amount),
      remainingAmount: asNumber(row.remaining_amount),
      isOverdue: row.is_overdue === true,
    })),
    payments: (Array.isArray(paymentsResult.data) ? paymentsResult.data : []).map(row => ({
      id: row.payment_id,
      chargeId: row.charge_id,
      chargeDescription: row.charge_description,
      amount: asNumber(row.amount),
      paymentMethod: row.payment_method,
      paymentDate: row.payment_date,
      status: row.payment_status,
    })),
  };
}
