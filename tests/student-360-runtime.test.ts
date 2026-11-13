import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  attendanceAccess: vi.fn(),
  memorizationAccess: vi.fn(),
  memorizationRecords: vi.fn(),
  schoolTrackAverages: vi.fn(async (..._args: unknown[]) => null as unknown),
}));

vi.mock("@/lib/attendance", () => ({
  canAccessAttendanceClass: mocks.attendanceAccess,
}));

vi.mock("@/lib/memorization", () => ({
  canAccessMemorizationClass: mocks.memorizationAccess,
  fetchStudentMemorizationRecords: mocks.memorizationRecords,
}));

vi.mock("@/lib/school-track", () => ({
  fetchStudentSchoolTrackAverages: mocks.schoolTrackAverages,
}));

import { fetchStudent360 } from "@/lib/student-360";

function resultQuery<T>(result: { data: T; error: null }) {
  const promise = Promise.resolve(result);
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue(result),
    then: promise.then.bind(promise),
  };
}

function buildClient(options: {
  student: Record<string, unknown> | null;
  financeAccess?: boolean;
  charges?: Record<string, unknown>[];
  payments?: Record<string, unknown>[];
}) {
  const studentQuery = resultQuery({ data: options.student, error: null });
  const branchQuery = resultQuery({ data: { id: "branch-1", name: "الفرع" }, error: null });
  const classQuery = resultQuery({ data: { id: "class-1", name: "حلقة الفجر" }, error: null });
  const chargesQuery = resultQuery({ data: options.charges ?? [], error: null });
  const paymentsQuery = resultQuery({ data: options.payments ?? [], error: null });
  const from = vi.fn((table: string) => {
    if (table === "students") return studentQuery;
    if (table === "branches") return branchQuery;
    if (table === "classes") return classQuery;
    if (table === "student_charges") return chargesQuery;
    if (table === "payments") return paymentsQuery;
    throw new Error(`Unexpected table: ${table}`);
  });
  const rpc = vi.fn(async () => ({
    data: options.financeAccess === true,
    error: null,
  }));

  return {
    client: { from, rpc } as unknown as SupabaseClient,
    studentQuery,
    chargesQuery,
    paymentsQuery,
    from,
    rpc,
  };
}

describe("Student 360 read-only access boundaries", () => {
  test("includes only the school-track records returned by the authorized reader", async () => {
    const schoolResult = {
      id: "school-result-1",
      school_id: "school-1",
      branch_id: "branch-1",
      class_id: null,
      student_id: "student-1",
      academic_year: "2026/2027",
      term: "الفصل الأول",
      average: 16.5,
      updated_at: "2026-10-03T09:00:00Z",
    };
    mocks.schoolTrackAverages.mockResolvedValueOnce([schoolResult]);
    const { client } = buildClient({
      student: {
        id: "student-1",
        branch_id: "branch-1",
        class_id: null,
        first_name: "طالب",
        last_name: "اختبار",
        start_date: "2026-08-01",
        status: "active",
      },
    });

    const data = await fetchStudent360("school-1", "student-1", client);

    expect(data?.schoolTrack).toEqual({ state: "ready", data: [schoolResult] });
    expect(data?.attendance).toEqual({ state: "hidden" });
    expect(data?.memorization).toEqual({ state: "hidden" });
  });

  test("uses the supplied school and student id without cross-school fallback", async () => {
    const { client, studentQuery } = buildClient({
      student: {
        id: "student-1",
        branch_id: "branch-1",
        class_id: null,
        first_name: "طالب",
        last_name: "اختبار",
        start_date: "2026-08-01",
        status: "active",
      },
    });

    const data = await fetchStudent360("school-1", "student-1", client);

    expect(data?.profile.id).toBe("student-1");
    expect(studentQuery.eq).toHaveBeenCalledWith("school_id", "school-1");
    expect(studentQuery.eq).toHaveBeenCalledWith("id", "student-1");
    expect(mocks.attendanceAccess).not.toHaveBeenCalled();
    expect(mocks.memorizationRecords).not.toHaveBeenCalled();
  });

  test("treats a non-visible student as missing instead of exposing another school record", async () => {
    const { client } = buildClient({ student: null });

    await expect(fetchStudent360("school-1", "student-from-school-2", client))
      .resolves.toBeNull();
  });

  test("hides finance and memorization when existing permissions do not allow them", async () => {
    mocks.attendanceAccess.mockResolvedValue(false);
    mocks.memorizationAccess.mockResolvedValue(false);
    const { client, from, rpc } = buildClient({
      financeAccess: false,
      student: {
        id: "student-1",
        branch_id: "branch-1",
        class_id: "class-1",
        first_name: "طالب",
        last_name: "اختبار",
        start_date: "2026-08-01",
        status: "active",
      },
    });

    const data = await fetchStudent360("school-1", "student-1", client);

    expect(data?.memorization).toEqual({ state: "hidden" });
    expect(data?.finance).toEqual({ state: "hidden" });
    expect(mocks.memorizationRecords).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalled();
    expect(from).not.toHaveBeenCalledWith("student_charges");
    expect(from).not.toHaveBeenCalledWith("payments");
  });

  test("excludes waived and cancelled charges from totals while keeping five recent payments", async () => {
    const payments = Array.from({ length: 7 }, (_, index) => ({
      id: `payment-${7 - index}`,
      school_id: "school-1",
      branch_id: "branch-1",
      student_id: "student-1",
      charge_id: "charge-1",
      amount: 100,
      payment_method: "cash",
      payment_date: `2026-08-${String(7 - index).padStart(2, "0")}`,
      reference_number: null,
      notes: null,
      status: "completed",
      created_at: `2026-08-${String(7 - index).padStart(2, "0")}T09:00:00Z`,
    }));
    const { client, paymentsQuery } = buildClient({
      financeAccess: true,
      student: {
        id: "student-1",
        branch_id: "branch-1",
        class_id: null,
        first_name: "طالب",
        last_name: "اختبار",
        start_date: "2026-08-01",
        status: "active",
      },
      charges: [
        {
          id: "charge-1",
          branch_id: "branch-1",
          student_id: "student-1",
          fee_plan_id: null,
          description: "رسوم شهرية",
          original_amount: 700,
          net_amount: 700,
          due_date: "2026-08-01",
          status: "partially_paid",
        },
        {
          id: "charge-waived",
          branch_id: "branch-1",
          student_id: "student-1",
          fee_plan_id: null,
          description: "رسوم معفاة",
          original_amount: 200,
          net_amount: 200,
          due_date: "2026-08-01",
          status: "waived",
        },
        {
          id: "charge-cancelled",
          branch_id: "branch-1",
          student_id: "student-1",
          fee_plan_id: null,
          description: "رسوم ملغاة",
          original_amount: 300,
          net_amount: 300,
          due_date: "2026-08-01",
          status: "cancelled",
        },
      ],
      payments,
    });

    const data = await fetchStudent360("school-1", "student-1", client);

    expect(data?.finance).toMatchObject({
      state: "ready",
      data: {
        totalDue: 700,
        paid: 700,
        remaining: 0,
      },
    });
    if (data?.finance.state !== "ready") throw new Error("Expected finance data");
    expect(data.finance.data.recentPayments).toHaveLength(5);
    expect(data.finance.data.recentPayments.map(payment => payment.id)).toEqual([
      "payment-7",
      "payment-6",
      "payment-5",
      "payment-4",
      "payment-3",
    ]);
    expect(paymentsQuery.eq).toHaveBeenCalledWith("school_id", "school-1");
    expect(paymentsQuery.eq).toHaveBeenCalledWith("branch_id", "branch-1");
    expect(paymentsQuery.eq).toHaveBeenCalledWith("student_id", "student-1");
  });
});
