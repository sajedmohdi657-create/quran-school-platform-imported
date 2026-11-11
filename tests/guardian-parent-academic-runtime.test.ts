import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, test, vi } from "vitest";
import {
  fetchParentStudentAcademic,
  fetchParentStudentLearningFollowUp,
  listMyGuardianStudents,
} from "@/lib/parent-portal";

function buildClient(responses: Record<string, { data: unknown; error: unknown }>) {
  const rpc = vi.fn(async (name: string, args?: Record<string, unknown>) => {
    const response = responses[name];
    if (!response) throw new Error(`Unexpected RPC: ${name}`);
    return { ...response, args };
  });
  return { client: { rpc } as unknown as SupabaseClient, rpc };
}

describe("Guardian parent academic RPC client", () => {
  test("maps only students returned by the dedicated guardian directory RPC", async () => {
    const { client, rpc } = buildClient({
      list_my_guardian_students: {
        data: [
          {
            school_id: "school-a",
            school_name: "مدرسة أ",
            student_id: "student-a",
            student_first_name: "ساجد",
            student_last_name: "محمد",
            branch_id: "branch-a",
            branch_name: "الفرع الرئيسي",
            class_id: "class-a",
            class_name: "حلقة الفجر",
            relationship_type: "father",
            is_primary: true,
          },
        ],
        error: null,
      },
    });

    const students = await listMyGuardianStudents(client);

    expect(students).toEqual([
      {
        schoolId: "school-a",
        schoolName: "مدرسة أ",
        studentId: "student-a",
        firstName: "ساجد",
        lastName: "محمد",
        branchId: "branch-a",
        branchName: "الفرع الرئيسي",
        classId: "class-a",
        className: "حلقة الفجر",
        relationshipType: "father",
        isPrimary: true,
      },
    ]);
    expect(rpc).toHaveBeenCalledWith("list_my_guardian_students");
  });

  test("binds every academic RPC to the exact school and student pair", async () => {
    const { client, rpc } = buildClient({
      get_my_guardian_student_attendance_summary: {
        data: [
          {
            total_records: "3",
            present_count: "1",
            absent_count: "1",
            late_count: "1",
            excused_absence_count: "0",
            last_session_date: "2026-08-03",
          },
        ],
        error: null,
      },
      list_my_guardian_student_attendance: {
        data: [
          {
            attendance_record_id: "attendance-1",
            session_date: "2026-08-03",
            attendance_status: "late",
            arrival_time: "08:15:00",
          },
        ],
        error: null,
      },
      get_my_guardian_student_memorization_summary: {
        data: [
          {
            total_records: "2",
            average_rating: "4.50",
            total_errors: "1",
            last_record_date: "2026-08-03",
          },
        ],
        error: null,
      },
      list_my_guardian_student_memorization: {
        data: [
          {
            memorization_record_id: "mem-1",
            record_date: "2026-08-03",
            session_type: "near_revision",
            surah_number: 57,
            ayah_start: 1,
            ayah_end: 10,
            rating: 5,
            errors_count: 0,
            next_assignment: "إلى الآية 15",
          },
        ],
        error: null,
      },
    });

    const result = await fetchParentStudentAcademic("school-a", "student-a", client);

    expect(result.attendanceSummary).toEqual({
      totalRecords: 3,
      presentCount: 1,
      absentCount: 1,
      lateCount: 1,
      excusedAbsenceCount: 0,
      lastSessionDate: "2026-08-03",
    });
    expect(result.memorizationSummary.averageRating).toBe(4.5);
    expect(result.memorizationRecords[0]?.nextAssignment).toBe("إلى الآية 15");

    for (const [name, args] of rpc.mock.calls) {
      if (name === "list_my_guardian_students") continue;
      expect(args).toMatchObject({
        target_school_id: "school-a",
        target_student_id: "student-a",
      });
    }
    expect(rpc).toHaveBeenCalledWith(
      "list_my_guardian_student_attendance",
      expect.objectContaining({ target_limit: 30 })
    );
    expect(rpc).toHaveBeenCalledWith(
      "list_my_guardian_student_memorization",
      expect.objectContaining({ target_limit: 20 })
    );
  });

  test("fetches only assigned Quran targets and attendance follow-up for the linked child", async () => {
    const { client, rpc } = buildClient({
      get_my_guardian_learning_follow_up: {
        data: {
          targets: [
            {
              id: "target-1",
              target_kind: "revision",
              surah_number: 57,
              ayah_start: 1,
              ayah_end: 10,
              assigned_on: "2026-11-01",
              due_on: "2026-11-05",
              completed: false,
              overdue: true,
            },
          ],
          attendance: { absence_count: 2, late_count: 1 },
        },
        error: null,
      },
    });

    const result = await fetchParentStudentLearningFollowUp("school-a", "student-a", client);
    expect(result).toEqual({
      targets: [{
        id: "target-1",
        targetKind: "revision",
        surahNumber: 57,
        ayahStart: 1,
        ayahEnd: 10,
        assignedOn: "2026-11-01",
        dueOn: "2026-11-05",
        completed: false,
        overdue: true,
      }],
      attendance: { absenceCount: 2, lateCount: 1 },
    });
    expect(rpc).toHaveBeenCalledWith("get_my_guardian_learning_follow_up", {
      target_school_id: "school-a",
      target_student_id: "student-a",
      target_limit: 50,
    });
  });

  test("does not hide an authorization failure behind empty academic data", async () => {
    const denied = { code: "42501", message: "student access denied" };
    const { client } = buildClient({
      get_my_guardian_student_attendance_summary: { data: null, error: denied },
      list_my_guardian_student_attendance: { data: [], error: null },
      get_my_guardian_student_memorization_summary: { data: [], error: null },
      list_my_guardian_student_memorization: { data: [], error: null },
    });

    await expect(
      fetchParentStudentAcademic("school-a", "student-not-linked", client)
    ).rejects.toEqual(denied);
  });
});
