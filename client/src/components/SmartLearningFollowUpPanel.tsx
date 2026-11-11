import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, BookOpenCheck, CalendarClock, CheckCircle2, RefreshCw, Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { fetchMemorizationClassTeachers, QURAN_SURAHS, type MemorizationTeacher } from "@/lib/memorization";
import { getSupabaseClient } from "@/lib/supabase";

type StudentChoice = { id: string; name: string; branchId: string; classId: string };
type TargetRow = {
  id: string;
  student_id: string;
  student_name: string;
  class_name: string;
  target_kind: "new_memorization" | "revision";
  surah_number: number;
  ayah_start: number;
  ayah_end: number;
  due_on: string;
  completed: boolean;
  overdue: boolean;
  has_open_weakness: boolean;
};

type Dashboard = {
  overview: {
    assigned_count: number;
    completed_count: number;
    overdue_count: number;
    not_completed_count: number;
    not_memorized_count: number;
    not_reviewed_count: number;
    weakness_count: number;
    absence_count: number;
    late_count: number;
  };
  targets: TargetRow[];
  attendance_by_student: Array<{ student_id: string; student_name: string; absence_count: number; late_count: number }>;
};

function todayValue() {
  const now = new Date();
  return [now.getFullYear(), String(now.getMonth() + 1).padStart(2, "0"), String(now.getDate()).padStart(2, "0")].join("-");
}

function surahName(number: number) {
  return QURAN_SURAHS.find(item => item.number === number)?.name ?? `السورة ${number}`;
}

export default function SmartLearningFollowUpPanel({
  schoolId,
  canManage,
  branchId,
  classId,
  studentId,
  students,
}: {
  schoolId: string;
  canManage: boolean;
  branchId: string;
  classId: string;
  studentId: string;
  students: StudentChoice[];
}) {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [selectedStudent, setSelectedStudent] = useState(studentId);
  const [teachers, setTeachers] = useState<MemorizationTeacher[]>([]);
  const [teacherId, setTeacherId] = useState("");
  const [kind, setKind] = useState<"new_memorization" | "revision">("new_memorization");
  const [surah, setSurah] = useState("1");
  const [ayahStart, setAyahStart] = useState("1");
  const [ayahEnd, setAyahEnd] = useState("7");
  const [dueOn, setDueOn] = useState(todayValue());

  const filteredStudents = useMemo(
    () => students.filter(item =>
      (!branchId || item.branchId === branchId) &&
      (!classId || item.classId === classId)
    ),
    [students, branchId, classId]
  );
  const selected = students.find(item => item.id === selectedStudent);
  const selectedSurah = QURAN_SURAHS.find(item => item.number === Number(surah));
  const maxAyah = selectedSurah?.ayahCount ?? 286;

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const { error: alertError } = await getSupabaseClient().rpc("refresh_learning_follow_up_alerts", {
        target_school_id: schoolId,
        target_branch_id: branchId || null,
        target_class_id: classId || null,
        target_student_id: studentId || null,
      });
      if (alertError) toast.error("تعذر تحديث التنبيهات داخل المنصة؛ ستظل لوحة التقارير متاحة.");
      const { data, error: rpcError } = await getSupabaseClient().rpc("get_learning_follow_up_dashboard", {
        target_school_id: schoolId,
        target_branch_id: branchId || null,
        target_class_id: classId || null,
        target_student_id: studentId || null,
        target_date_from: undefined,
        target_date_to: undefined,
        target_limit: 100,
      });
      if (rpcError) throw rpcError;
      setDashboard(data as Dashboard);
    } catch {
      setDashboard(null);
      setError("تعذر تحميل لوحة المتابعة الذكية. تحقق من تطبيق ترحيل قاعدة البيانات وصلاحيات الحساب.");
    } finally {
      setLoading(false);
    }
  }, [schoolId, branchId, classId, studentId]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (studentId) setSelectedStudent(studentId);
  }, [studentId]);

  useEffect(() => {
    if (!selected || !canManage) {
      setTeachers([]);
      setTeacherId("");
      return;
    }
    let cancelled = false;
    setTeacherId("");
    void fetchMemorizationClassTeachers(schoolId, selected.branchId, selected.classId)
      .then(result => { if (!cancelled) setTeachers(result); })
      .catch(() => { if (!cancelled) setTeachers([]); });
    return () => { cancelled = true; };
  }, [schoolId, canManage, selected?.branchId, selected?.classId]);

  async function createTarget(event: React.FormEvent) {
    event.preventDefault();
    if (!selected) {
      toast.error("اختر التلميذ أولًا");
      return;
    }
    if (Number(ayahStart) < 1 || Number(ayahEnd) < Number(ayahStart) || Number(ayahEnd) > maxAyah) {
      toast.error("تحقق من نطاق الآيات");
      return;
    }
    setSaving(true);
    try {
      const { error: rpcError } = await getSupabaseClient().rpc("create_learning_follow_up_target", {
        target_school_id: schoolId,
        target_branch_id: selected.branchId,
        target_class_id: selected.classId,
        target_student_id: selected.id,
        target_kind: kind,
        target_surah_number: Number(surah),
        target_ayah_start: Number(ayahStart),
        target_ayah_end: Number(ayahEnd),
        target_due_on: dueOn,
        target_teacher_id: teacherId || null,
        target_notes: null,
      });
      if (rpcError) throw rpcError;
      toast.success("تم تسجيل التكليف بنجاح");
      await load();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "";
      toast.error(message.includes("TEACHER_NOT_ASSIGNED")
        ? "لا يوجد معلم نشط مسند إلى هذه الحلقة."
        : message.includes("TEACHER_IDENTITY_MISMATCH")
          ? "لا يمكنك إسناد التكليف باسم معلم آخر."
          : "تعذر حفظ التكليف. تحقق من صلاحية إدارة متابعة الحفظ.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5" dir="rtl">
      <section className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Metric label="التكليفات" value={dashboard?.overview.assigned_count ?? 0} icon={BookOpenCheck} />
        <Metric label="المنجز" value={dashboard?.overview.completed_count ?? 0} icon={CheckCircle2} />
        <Metric label="متأخر" value={dashboard?.overview.overdue_count ?? 0} icon={AlertTriangle} danger />
        <Metric label="حفظ لم يكتمل" value={dashboard?.overview.not_memorized_count ?? 0} icon={BookOpenCheck} danger />
        <Metric label="مراجعة لم تكتمل" value={dashboard?.overview.not_reviewed_count ?? 0} icon={CalendarClock} danger />
        <Metric label="مواضع ضعف" value={dashboard?.overview.weakness_count ?? 0} icon={CalendarClock} />
      </section>

      {canManage ? (
      <Card className="space-y-4 border-[#DCE7DF] p-4 shadow-sm">
        <div>
          <h3 className="font-bold text-[#173B2D]">إسناد حفظ أو مراجعة</h3>
          <p className="mt-1 text-xs leading-6 text-[#718177]">حدد الموضع والموعد؛ سيظهر ضمن المتأخرات إذا لم تُسجل نتيجة نجاح مطابقة بعد الاستحقاق.</p>
        </div>
        <form onSubmit={createTarget} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="text-xs font-bold text-[#53675B]">التلميذ
            <select value={selectedStudent} onChange={e => setSelectedStudent(e.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-[#D6E2D9] bg-white px-3 text-sm" required>
              <option value="">اختر التلميذ</option>
              {filteredStudents.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label>
          <label className="text-xs font-bold text-[#53675B]">المعلم المسؤول
            <select value={teacherId} onChange={e => setTeacherId(e.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-[#D6E2D9] bg-white px-3 text-sm">
              <option value="">المعلم الحالي (للمعلم) / اختر للمدير</option>
              {teachers.map(item => <option key={item.id} value={item.id}>{item.fullName}</option>)}
            </select>
          </label>
          <label className="text-xs font-bold text-[#53675B]">نوع التكليف
            <select value={kind} onChange={e => setKind(e.target.value as typeof kind)} className="mt-1 min-h-11 w-full rounded-xl border border-[#D6E2D9] bg-white px-3 text-sm">
              <option value="new_memorization">حفظ الجديد</option>
              <option value="revision">مراجعة</option>
            </select>
          </label>
          <label className="text-xs font-bold text-[#53675B]">السورة
            <select value={surah} onChange={e => { setSurah(e.target.value); setAyahStart("1"); setAyahEnd("1"); }} className="mt-1 min-h-11 w-full rounded-xl border border-[#D6E2D9] bg-white px-3 text-sm">
              {QURAN_SURAHS.map(item => <option key={item.number} value={item.number}>{item.number}. {item.name}</option>)}
            </select>
          </label>
          <label className="text-xs font-bold text-[#53675B]">موعد الإنجاز
            <input type="date" min={todayValue()} value={dueOn} onChange={e => setDueOn(e.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-[#D6E2D9] bg-white px-3 text-sm" required />
          </label>
          <label className="text-xs font-bold text-[#53675B]">من الآية
            <input type="number" min="1" max={maxAyah} value={ayahStart} onChange={e => setAyahStart(e.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-[#D6E2D9] px-3 text-sm" required />
          </label>
          <label className="text-xs font-bold text-[#53675B]">إلى الآية
            <input type="number" min={ayahStart || "1"} max={maxAyah} value={ayahEnd} onChange={e => setAyahEnd(e.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-[#D6E2D9] px-3 text-sm" required />
          </label>
          <div className="flex items-end">
            <Button type="submit" disabled={saving || !selectedStudent} className="min-h-11 w-full gap-2 bg-[#0B4738] text-white">
              <Save size={16} /> {saving ? "جارٍ الحفظ..." : "إسناد التكليف"}
            </Button>
          </div>
        </form>
      </Card>
      ) : (
        <p className="rounded-xl border border-[#E5EDE7] bg-white p-4 text-sm text-[#718177]">يمكنك الاطلاع على المتابعة، لكن لا تملك صلاحية إسناد التكليفات.</p>
      )}


      <Card className="border-[#DCE7DF] p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div>
            <h3 className="font-bold text-[#173B2D]">مواضع الحفظ والمراجعة</h3>
            <p className="mt-1 text-xs text-[#718177]">تُحتسب النتيجة من سجلات التسميع الناجحة المطابقة للتكليف.</p>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={() => void load()} disabled={loading} className="gap-2">
            <RefreshCw size={15} className={loading ? "animate-spin" : ""} /> تحديث
          </Button>
        </div>
        {loading ? <p className="py-8 text-center text-sm text-[#718177]">جارٍ تحميل المتابعة...</p>
          : error ? <p role="alert" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{error}</p>
          : !dashboard?.targets.length ? <p className="py-8 text-center text-sm text-[#718177]">لا توجد تكليفات ضمن النطاق المحدد. ابدأ بإسناد أول تكليف.</p>
          : <div className="space-y-2">
            {dashboard.targets.map(item => <article key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#E5EDE7] p-3 text-sm">
              <div>
                <p className="font-bold text-[#173B2D]">{item.student_name} · {item.class_name}</p>
                <p className="mt-1 text-xs text-[#718177]">{item.target_kind === "new_memorization" ? "حفظ جديد" : "مراجعة"} · {surahName(item.surah_number)} · الآيات {item.ayah_start}–{item.ayah_end}</p>
                <p className="mt-1 text-xs text-[#718177]">موعد الإنجاز: {item.due_on}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {item.completed && <span className="rounded-full bg-[#E8F3EC] px-3 py-1 text-xs font-bold text-[#17663B]">مكتمل</span>}
                {!item.completed && item.overdue && <span className="rounded-full bg-[#FDECEC] px-3 py-1 text-xs font-bold text-[#B83A3A]">متأخر</span>}
                {item.has_open_weakness && <span className="rounded-full bg-[#FFF4DE] px-3 py-1 text-xs font-bold text-[#A76009]">يحتاج متابعة</span>}
                {!item.completed && !item.overdue && <span className="rounded-full bg-[#EEF2F0] px-3 py-1 text-xs font-bold text-[#55685E]">قيد الإنجاز</span>}
              </div>
            </article>)}
          </div>}
        {Boolean(dashboard?.attendance_by_student?.length) && (
          <div className="mt-4 border-t border-[#E5EDE7] pt-4">
            <h4 className="mb-2 text-sm font-bold text-[#173B2D]">الغياب حسب التلميذ</h4>
            <div className="grid gap-2 sm:grid-cols-2">
              {dashboard?.attendance_by_student.map(item => (
                <div key={item.student_id} className="flex items-center justify-between gap-3 rounded-lg bg-[#F7F9F7] px-3 py-2 text-xs">
                  <span className="font-semibold text-[#40564B]">{item.student_name}</span>
                  <span className="text-[#B83A3A]">غياب: {item.absence_count}</span>
                  <span className="text-[#A76009]">تأخر: {item.late_count}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        <p className="mt-4 text-xs leading-6 text-[#829087]">إحصاءات الحضور ضمن الفترة المختارة: غياب {dashboard?.overview.absence_count ?? 0} · تأخر {dashboard?.overview.late_count ?? 0}. لا تُرسل هذه المرحلة رسائل خارج المنصة.</p>
      </Card>
    </div>
  );
}

function Metric({ label, value, icon: Icon, danger = false }: { label: string; value: number; icon: typeof BookOpenCheck; danger?: boolean }) {
  return (
    <Card className={`border p-4 shadow-sm ${danger ? "border-red-200" : "border-[#DCE7DF]"}`}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold text-[#718177]">{label}</p>
        <Icon size={18} className={danger ? "text-red-600" : "text-[#17663B]"} />
      </div>
      <p className={`mt-2 text-2xl font-bold ${danger ? "text-red-700" : "text-[#173B2D]"}`}>{value}</p>
    </Card>
  );
}
