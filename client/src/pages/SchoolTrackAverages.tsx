import { useEffect, useMemo, useState, type FormEvent } from "react";
import { GraduationCap, Save, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { EmptyState, PageHeader, SectionHeader } from "@/components/ui/app-primitives";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import {
  canManageSchoolTrackStudent,
  canViewSchoolTrackStudent,
  fetchSchoolTrackScope,
  getCurrentAcademicYear,
  type SchoolTrackScope,
  type SchoolTrackStudent,
} from "@/lib/school-track";
import { getSupabaseClient } from "@/lib/supabase";

const TERMS = ["الفصل الأول", "الفصل الثاني", "الفصل الثالث"] as const;
type Term = (typeof TERMS)[number];
type AverageRow = {
  id: string;
  student_id: string;
  branch_id: string;
  class_id: string | null;
  academic_year: string;
  term: Term;
  average: number;
  notes: string | null;
  updated_at: string;
};

function formatAverage(value: number) {
  return new Intl.NumberFormat("ar-DZ-u-nu-latn", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export default function SchoolTrackAverages() {
  const { school } = useAuth();
  const [scope, setScope] = useState<SchoolTrackScope | null>(null);
  const [students, setStudents] = useState<SchoolTrackStudent[]>([]);
  const [rows, setRows] = useState<AverageRow[]>([]);
  const [studentId, setStudentId] = useState("");
  const [academicYear, setAcademicYear] = useState(getCurrentAcademicYear());
  const [term, setTerm] = useState<Term>("الفصل الأول");
  const [average, setAverage] = useState("");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [canManage, setCanManage] = useState(false);

  const studentsById = useMemo(() => new Map(students.map(student => [student.id, student])), [students]);
  const selectedStudent = studentsById.get(studentId) ?? null;
  const manageableStudents = useMemo(
    () => students.filter(student => scope && canManageSchoolTrackStudent(scope, student)),
    [scope, students],
  );

  async function loadAverages(currentSchoolId: string, year: string) {
    const { data, error } = await getSupabaseClient()
      .from("school_term_averages")
      .select("id, student_id, branch_id, class_id, academic_year, term, average, notes, updated_at")
      .eq("school_id", currentSchoolId)
      .eq("academic_year", year)
      .order("student_id")
      .order("term");
    if (error) throw error;
    setRows((data ?? []).map(row => ({ ...row, average: Number(row.average) })) as AverageRow[]);
  }

  useEffect(() => {
    if (!school?.id) return;
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const nextScope = await fetchSchoolTrackScope(school.id);
        const { data, error } = await getSupabaseClient()
          .from("students")
          .select("id, branch_id, class_id, first_name, last_name, education_level, education_year")
          .eq("school_id", school.id)
          .order("last_name")
          .order("first_name");
        if (error) throw error;
        if (cancelled) return;
        const visible = ((data ?? []) as SchoolTrackStudent[]).filter(student =>
          canViewSchoolTrackStudent(nextScope, student)
        );
        setScope(nextScope);
        setStudents(visible);
        setCanManage(nextScope.canManage);
        const initial = visible.find(student => canManageSchoolTrackStudent(nextScope, student)) ?? visible[0];
        if (initial) setStudentId(initial.id);
        await loadAverages(school.id, academicYear);
      } catch {
        if (!cancelled) toast.error("تعذر تحميل معدلات الفصول ضمن الصلاحيات الحالية.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [school?.id]);

  async function refresh() {
    if (!school?.id) return;
    setLoading(true);
    try {
      await loadAverages(school.id, academicYear);
    } catch {
      toast.error("تعذر تحديث المعدلات.");
    } finally {
      setLoading(false);
    }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!school?.id || !selectedStudent || !scope) return;
    const value = Number(average);
    if (!Number.isFinite(value) || value < 0 || value > 20) {
      toast.error("يجب أن يكون المعدل بين 0 و20.");
      return;
    }
    if (!canManageSchoolTrackStudent(scope, selectedStudent)) {
      toast.error("لا تملك صلاحية تسجيل معدل هذا الطالب.");
      return;
    }
    setSaving(true);
    const { error } = await getSupabaseClient()
      .from("school_term_averages")
      .upsert({
        school_id: school.id,
        branch_id: selectedStudent.branch_id,
        class_id: selectedStudent.class_id,
        student_id: selectedStudent.id,
        academic_year: academicYear.trim(),
        term,
        average: value,
        notes: notes.trim() || null,
      }, { onConflict: "school_id,student_id,academic_year,term" });
    setSaving(false);
    if (error) {
      toast.error("تعذر حفظ المعدل. تحقق من صلاحياتك ومن السنة الدراسية.");
      return;
    }
    toast.success("تم حفظ معدل الفصل.");
    setAverage("");
    setNotes("");
    await refresh();
  }

  const studentRows = rows.filter(row => row.student_id === studentId);
  const termValues = TERMS.map(currentTerm => ({
    term: currentTerm,
    row: studentRows.find(row => row.term === currentTerm) ?? null,
  }));
  const classNames = new Map((scope?.classes ?? []).map(item => [item.id, item.name]));
  const branchNames = new Map((scope?.branches ?? []).map(item => [item.id, item.name]));

  return (
    <div className="space-y-6" dir="rtl">
      <PageHeader
        title="المسار الدراسي"
        description="المعدلات النهائية للفصول الدراسية الثلاثة فقط، دون إدراج المواد أو تفاصيل علاماتها."
        icon={GraduationCap}
      />
      <section className="grid gap-3 sm:grid-cols-3">
        {termValues.map(({ term: label, row }) => (
          <article key={label} className="rounded-2xl border border-[#DCE8E0] bg-white p-5 shadow-sm">
            <p className="text-sm font-semibold text-[#607368]">{label}</p>
            <p className="mt-3 text-3xl font-bold text-[#17663B]">{row ? formatAverage(row.average) : "—"}</p>
            <p className="mt-1 text-xs text-[#718377]">من 20</p>
          </article>
        ))}
      </section>
      <section className="rounded-2xl border border-[#E2EAE4] bg-white p-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="min-w-48 flex-1 text-sm font-semibold">السنة الدراسية
            <input value={academicYear} onChange={event => setAcademicYear(event.target.value)} placeholder="2026/2027" dir="ltr" className="mt-1 min-h-11 w-full rounded-xl border border-[#D6E2D9] px-3" />
          </label>
          <label className="min-w-56 flex-1 text-sm font-semibold">الطالب
            <select value={studentId} onChange={event => setStudentId(event.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-[#D6E2D9] bg-white px-3">
              {students.map(student => <option key={student.id} value={student.id}>{student.first_name} {student.last_name}</option>)}
            </select>
          </label>
          <Button type="button" variant="outline" onClick={() => void refresh()} disabled={loading} className="min-h-11 gap-2"><RefreshCw size={16} />تحديث</Button>
        </div>
        {selectedStudent && <p className="mt-3 text-xs text-[#718377]">
          {branchNames.get(selectedStudent.branch_id) ?? "—"}{selectedStudent.class_id ? ` · ${classNames.get(selectedStudent.class_id) ?? "حلقة"}` : ""}
        </p>}
      </section>
      {canManage && (
        <section className="rounded-2xl border border-[#DCE8E0] bg-[#F8FBF8] p-4 sm:p-5">
          <SectionHeader title="تسجيل معدل فصل" description="أدخل المعدل النهائي للفصل من 20 فقط." />
          <form onSubmit={save} className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="text-sm font-semibold">الفصل الدراسي
              <select value={term} onChange={event => setTerm(event.target.value as Term)} className="mt-1 min-h-11 w-full rounded-xl border border-[#D6E2D9] bg-white px-3">
                {TERMS.map(item => <option key={item} value={item}>{item}</option>)}
              </select>
            </label>
            <label className="text-sm font-semibold">المعدل النهائي (من 20)
              <input type="number" min="0" max="20" step="0.01" value={average} onChange={event => setAverage(event.target.value)} required className="mt-1 min-h-11 w-full rounded-xl border border-[#D6E2D9] px-3" />
            </label>
            <label className="text-sm font-semibold sm:col-span-2">ملاحظة عامة (اختيارية)
              <textarea value={notes} onChange={event => setNotes(event.target.value)} maxLength={1000} rows={2} className="mt-1 w-full rounded-xl border border-[#D6E2D9] p-3" />
            </label>
            <div className="sm:col-span-2">
              <Button type="submit" disabled={saving || !selectedStudent || !manageableStudents.some(item => item.id === studentId)} className="min-h-11 gap-2"><Save size={16} />{saving ? "جارٍ الحفظ..." : "حفظ معدل الفصل"}</Button>
            </div>
          </form>
        </section>
      )}
      <section className="rounded-2xl border border-[#E2EAE4] bg-white p-4">
        <SectionHeader title="سجل معدلات الفصول" description="سجل واحد لكل طالب ولكل فصل من الفصول الثلاثة في السنة الدراسية." />
        {loading ? <p role="status" className="py-6 text-sm text-[#718377]">جارٍ تحميل المعدلات...</p>
          : studentRows.length === 0 ? <EmptyState title="لا توجد معدلات مسجلة" description="سجّل معدل الفصل الأول أو الثاني أو الثالث لهذا الطالب." />
          : <div className="mt-3 divide-y divide-[#EDF2EE]">
            {termValues.filter(item => item.row).map(({ term: label, row }) => (
              <div key={label} className="flex items-center justify-between gap-3 py-3">
                <span className="font-semibold">{label}</span>
                <strong className="text-lg text-[#17663B]">{formatAverage(row!.average)} / 20</strong>
              </div>
            ))}
          </div>}
      </section>
    </div>
  );
}
