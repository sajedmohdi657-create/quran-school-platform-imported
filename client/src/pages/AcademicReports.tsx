import {
  BookOpenCheck,
  CalendarDays,
  Download,
  GraduationCap,
  Printer,
  RefreshCw,
  Users,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import MemorizationAnalyticsPanel from "@/components/MemorizationAnalyticsPanel";
import SmartLearningFollowUpPanel from "@/components/SmartLearningFollowUpPanel";
import { useAuth } from "@/contexts/AuthContext";
import {
  AcademicReportsPermissionError,
  AcademicReportsValidationError,
  buildAcademicReportsCsv,
  fetchAcademicReportsAccess,
  fetchAcademicReportsData,
  getAttendanceStatusLabel,
  getDefaultAcademicReportFilters,
  getMemorizationSessionTypeLabel,
  getSurahLabel,
  hasAnyAcademicReportsAccess,
  type AcademicCsvKind,
  type AcademicReportFilters,
  type AcademicReportsAccess,
  type AcademicReportsData,
} from "@/lib/academic-reports";
import {
  EmptyState,
  PageHeader,
  SectionHeader,
  StatCard,
} from "@/components/ui/app-primitives";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type LoadState = "loading" | "ready" | "forbidden" | "error";
type ReportTab = "overview" | "attendance" | "memorization" | "analytics" | "smart" | "classes";

const arabicDateFormatter = new Intl.DateTimeFormat("ar-DZ-u-nu-latn", {
  dateStyle: "medium",
});

function formatDate(value: string | null): string {
  if (!value) return "لا توجد بيانات";
  return arabicDateFormatter.format(new Date(value + "T12:00:00"));
}

function StudentLink({
  studentId,
  studentName,
}: {
  studentId: string;
  studentName: string;
}) {
  const [, setLocation] = useLocation();
  return (
    <button
      type="button"
      onClick={() => setLocation("/students/" + studentId)}
      className="font-bold text-[#17663B] underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2F855A]"
    >
      {studentName}
    </button>
  );
}

function ModuleError({ label }: { label: string }) {
  return (
    <section
      role="alert"
      className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm leading-7 text-amber-900"
    >
      تعذر تحميل {label}. بقيت بقية التقارير متاحة ولم تُرسل أي تغييرات.
    </section>
  );
}

function downloadCsv(kind: AcademicCsvKind, data: AcademicReportsData) {
  const csv = buildAcademicReportsCsv(kind, data);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "academic-" + kind + ".csv";
  anchor.click();
  URL.revokeObjectURL(url);
}

export default function AcademicReports() {
  const { school } = useAuth();
  const [access, setAccess] = useState<AcademicReportsAccess | null>(null);
  const [data, setData] = useState<AcademicReportsData | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [dataLoading, setDataLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<ReportTab>("overview");
  const [draftFilters, setDraftFilters] = useState<AcademicReportFilters>(
    getDefaultAcademicReportFilters
  );
  const [filters, setFilters] = useState<AcademicReportFilters>(
    getDefaultAcademicReportFilters
  );
  const [filterError, setFilterError] = useState("");

  useEffect(() => {
    if (!school?.id) return;
    let cancelled = false;
    setLoadState("loading");
    void fetchAcademicReportsAccess(school.id)
      .then(result => {
        if (cancelled) return;
        setAccess(result);
        if (!hasAnyAcademicReportsAccess(result)) {
          const bothFailed =
            result.attendance.state === "error" &&
            result.memorization.state === "error";
          setLoadState(bothFailed ? "error" : "forbidden");
          return;
        }
        setLoadState("ready");
      })
      .catch(() => {
        if (!cancelled) setLoadState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [school?.id]);

  useEffect(() => {
    if (!school?.id || !access || !hasAnyAcademicReportsAccess(access)) return;
    let cancelled = false;
    setDataLoading(true);
    setFilterError("");
    void fetchAcademicReportsData(school.id, filters, access)
      .then(result => {
        if (!cancelled) setData(result);
      })
      .catch(error => {
        if (cancelled) return;
        setData(null);
        if (error instanceof AcademicReportsPermissionError) {
          setFilterError("الفلتر المختار خارج نطاق صلاحياتك الحالية.");
        } else if (error instanceof AcademicReportsValidationError) {
          setFilterError("تحقق من فترة التقرير: يجب أن يكون تاريخ البداية قبل النهاية.");
        } else {
          setFilterError("تعذر تحميل بيانات التقرير المفلترة.");
        }
      })
      .finally(() => {
        if (!cancelled) setDataLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [access, filters, school?.id]);

  const availableClasses = useMemo(
    () =>
      (data?.classes ?? []).filter(
        item => !draftFilters.branchId || item.branchId === draftFilters.branchId
      ),
    [data?.classes, draftFilters.branchId]
  );
  const availableStudents = useMemo(
    () =>
      (data?.students ?? []).filter(
        item =>
          (!draftFilters.branchId ||
            item.branchId === draftFilters.branchId) &&
          (!draftFilters.classId || item.classId === draftFilters.classId)
      ),
    [data?.students, draftFilters.branchId, draftFilters.classId]
  );
  const branchLabel =
    data?.branches.find(item => item.id === filters.branchId)?.name ?? "كل الفروع";
  const classLabel =
    data?.classes.find(item => item.id === filters.classId)?.name ?? "كل الحلقات";
  const csvKind: AcademicCsvKind =
    activeTab === "attendance"
      ? "attendance"
      : activeTab === "memorization"
        ? "memorization"
        : "student_summary";

  const applyFilters = (event: React.FormEvent) => {
    event.preventDefault();
    setFilters({ ...draftFilters });
  };

  if (loadState === "loading") {
    return (
      <section className="grid min-h-[50vh] place-items-center" role="status">
        <span className="flex items-center gap-3 text-sm font-semibold">
          <RefreshCw className="size-5 animate-spin" />
          جارٍ التحقق من صلاحيات التقارير التعليمية...
        </span>
      </section>
    );
  }

  if (loadState === "forbidden") {
    return (
      <EmptyState
        title="لا توجد وحدات تعليمية متاحة"
        description="يلزم وصول فعلي إلى الحضور أو الحفظ والمراجعة. صلاحيات المالية وحدها لا تفتح هذا المركز."
      />
    );
  }

  if (loadState === "error" || !access) {
    return (
      <ModuleError label="صلاحيات التقارير التعليمية" />
    );
  }

  return (
    <div className="space-y-5" dir="rtl">
      <div className="print:hidden">
        <PageHeader
          eyebrow="مركز التقارير"
          title="التقارير التعليمية"
          description="ملخصات قراءة فقط للحضور والحفظ والحلقات وتحليلات أخطاء التسميع ضمن صلاحياتك الحالية."
          action={
            data && (
              <div className="flex flex-wrap gap-2">
                {activeTab !== "analytics" && (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={dataLoading}
                    onClick={() => downloadCsv(csvKind, data)}
                    className="gap-2"
                  >
                    <Download size={16} />
                    CSV
                  </Button>
                )}
                <Button
                  type="button"
                  variant="outline"
                  disabled={dataLoading}
                  onClick={() => window.print()}
                  className="gap-2"
                >
                  <Printer size={16} />
                  طباعة
                </Button>
              </div>
            )
          }
        />
      </div>

      <header className="hidden border-b border-[#D9E5DC] pb-4 print:block">
        <h1 className="text-xl font-bold">{school?.name ?? "المدرسة القرآنية"}</h1>
        <p className="mt-1 font-semibold">التقارير التعليمية</p>
        <p className="mt-2 text-sm">
          الفترة: {formatDate(filters.dateFrom)} — {formatDate(filters.dateTo)}
          {" · "}الفرع: {branchLabel}{" · "}الحلقة: {classLabel}
        </p>
        <p className="mt-1 text-xs">
          تاريخ الطباعة: {new Intl.DateTimeFormat("ar-DZ-u-nu-latn", {
            dateStyle: "medium",
            timeStyle: "short",
          }).format(new Date())}
        </p>
      </header>

      <form
        onSubmit={applyFilters}
        className="grid gap-3 rounded-2xl border border-[#E2EAE4] bg-white p-4 shadow-sm print:hidden sm:grid-cols-2 lg:grid-cols-6"
      >
        <label className="text-xs font-bold text-[#53675B]">
          التاريخ من
          <input
            type="date"
            value={draftFilters.dateFrom}
            onChange={event =>
              setDraftFilters(current => ({
                ...current,
                dateFrom: event.target.value,
              }))
            }
            className="mt-1 min-h-11 w-full rounded-xl border border-[#D6E2D9] px-3 text-sm"
          />
        </label>
        <label className="text-xs font-bold text-[#53675B]">
          التاريخ إلى
          <input
            type="date"
            value={draftFilters.dateTo}
            onChange={event =>
              setDraftFilters(current => ({
                ...current,
                dateTo: event.target.value,
              }))
            }
            className="mt-1 min-h-11 w-full rounded-xl border border-[#D6E2D9] px-3 text-sm"
          />
        </label>
        <label className="text-xs font-bold text-[#53675B]">
          الفرع
          <select
            value={draftFilters.branchId}
            onChange={event =>
              setDraftFilters(current => ({
                ...current,
                branchId: event.target.value,
                classId: "",
                studentId: "",
              }))
            }
            className="mt-1 min-h-11 w-full rounded-xl border border-[#D6E2D9] bg-white px-3 text-sm"
          >
            <option value="">كل الفروع</option>
            {data?.branches.map(branch => (
              <option key={branch.id} value={branch.id}>
                {branch.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs font-bold text-[#53675B]">
          الحلقة
          <select
            value={draftFilters.classId}
            onChange={event =>
              setDraftFilters(current => ({
                ...current,
                classId: event.target.value,
                studentId: "",
              }))
            }
            className="mt-1 min-h-11 w-full rounded-xl border border-[#D6E2D9] bg-white px-3 text-sm"
          >
            <option value="">كل الحلقات</option>
            {availableClasses.map(item => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs font-bold text-[#53675B]">
          الطالب
          <select
            value={draftFilters.studentId}
            onChange={event =>
              setDraftFilters(current => ({
                ...current,
                studentId: event.target.value,
              }))
            }
            className="mt-1 min-h-11 w-full rounded-xl border border-[#D6E2D9] bg-white px-3 text-sm"
          >
            <option value="">كل الطلاب</option>
            {availableStudents.map(student => (
              <option key={student.id} value={student.id}>
                {student.fullName}
              </option>
            ))}
          </select>
        </label>
        <Button type="submit" disabled={dataLoading} className="min-h-11 self-end">
          {dataLoading ? "جارٍ التحديث..." : "تطبيق الفلاتر"}
        </Button>
      </form>

      {filterError && (
        <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">
          {filterError}
        </p>
      )}

      {data && (
        <>
          <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard
              label="سجلات الحضور"
              value={String(data.overview.attendanceCount)}
              icon={CalendarDays}
              tone="green"
              hint={"حاضر " + data.overview.presentCount + " · غائب " + data.overview.absentCount}
            />
            <StatCard
              label="متابعات الحفظ"
              value={String(data.overview.memorizationCount)}
              icon={BookOpenCheck}
              tone="blue"
            />
            <StatCard
              label="الطلاب في النتائج"
              value={String(data.overview.studentCount)}
              icon={Users}
              tone="amber"
            />
            <StatCard
              label="آخر نشاط"
              value={formatDate(data.overview.latestActivity)}
              icon={GraduationCap}
              tone="green"
            />
          </section>

          <Tabs
            value={activeTab}
            onValueChange={value => setActiveTab(value as ReportTab)}
            className="gap-4"
          >
            <TabsList className="h-auto max-w-full justify-start gap-1 overflow-x-auto bg-white p-2 print:hidden">
              <TabsTrigger value="overview" className="min-h-10 shrink-0">نظرة عامة</TabsTrigger>
              {data.attendance.state !== "hidden" && (
                <TabsTrigger value="attendance" className="min-h-10 shrink-0">الحضور</TabsTrigger>
              )}
              {data.memorization.state !== "hidden" && (
                <TabsTrigger value="memorization" className="min-h-10 shrink-0">الحفظ والمراجعة</TabsTrigger>
              )}
              {access.memorization.state === "ready" && (
                <>
                  <TabsTrigger value="analytics" className="min-h-10 shrink-0">تحليلات المتابعة</TabsTrigger>
                  <TabsTrigger value="smart" className="min-h-10 shrink-0">المتابعة الذكية</TabsTrigger>
                </>
              )}
              <TabsTrigger value="classes" className="min-h-10 shrink-0">الحلقات</TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="space-y-4">
              <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <StatCard label="غائب" value={String(data.overview.absentCount)} icon={Users} tone="red" />
                <StatCard label="متأخر" value={String(data.overview.lateCount)} icon={CalendarDays} tone="amber" />
                <StatCard label="بعذر" value={String(data.overview.excusedCount)} icon={CalendarDays} tone="blue" />
                <StatCard label="الحلقات الظاهرة" value={String(data.classesSummary.length)} icon={GraduationCap} tone="green" />
              </section>
              {data.attendance.state === "error" && <ModuleError label="تقرير الحضور" />}
              {data.memorization.state === "error" && <ModuleError label="تقرير الحفظ والمراجعة" />}
              {data.overview.attendanceCount === 0 &&
                data.overview.memorizationCount === 0 && (
                  <EmptyState
                    title="لا توجد بيانات في الفترة"
                    description="غيّر الفترة أو الفرع أو الحلقة لعرض النتائج المتاحة."
                  />
                )}
            </TabsContent>

            <TabsContent value="attendance">
              {data.attendance.state === "error" ? (
                <ModuleError label="تقرير الحضور" />
              ) : data.attendance.state === "ready" &&
                data.attendance.data.records.length > 0 ? (
                <div className="space-y-5">
                  <AttendanceStudentTable data={data} />
                  <AttendanceDailyTable data={data} />
                </div>
              ) : (
                <EmptyState title="لا توجد سجلات حضور" description="لا توجد سجلات ضمن الفلاتر والفترة المحددة." />
              )}
            </TabsContent>

            <TabsContent value="memorization">
              {data.memorization.state === "error" ? (
                <ModuleError label="تقرير الحفظ والمراجعة" />
              ) : data.memorization.state === "ready" &&
                data.memorization.data.records.length > 0 ? (
                <MemorizationTable data={data} />
              ) : (
                <EmptyState title="لا توجد متابعات حفظ" description="لا توجد متابعات ضمن الفلاتر والفترة المحددة." />
              )}
            </TabsContent>

            <TabsContent value="analytics">
              {access.memorization.state === "ready" && school?.id ? (
                <MemorizationAnalyticsPanel
                  schoolId={school.id}
                  branchId={filters.branchId}
                  classId={filters.classId}
                  studentId={filters.studentId}
                  dateFrom={filters.dateFrom}
                  dateTo={filters.dateTo}
                />
              ) : (
                <ModuleError label="تحليلات متابعة الحفظ" />
              )}
            </TabsContent>

            <TabsContent value="smart">
              {access.memorization.state === "ready" && school?.id ? (
                <SmartLearningFollowUpPanel
                  schoolId={school.id}
                  canManage={access.memorization.scope.canManage}
                  branchId={filters.branchId}
                  classId={filters.classId}
                  studentId={filters.studentId}
                  students={data.students.map(item => ({ id: item.id, name: item.fullName, branchId: item.branchId, classId: item.classId }))}
                />
              ) : (
                <ModuleError label="المتابعة الذكية" />
              )}
            </TabsContent>

            <TabsContent value="classes">
              <ClassesSummary data={data} />
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  );
}

function AttendanceStudentTable({ data }: { data: AcademicReportsData }) {
  if (data.attendance.state !== "ready") return null;
  return (
    <section className="rounded-2xl border border-[#E2EAE4] bg-white p-4">
      <SectionHeader title="ملخص حضور الطلاب" description="عدادات مباشرة دون احتساب نسبة حضور جديدة." />
      <div className="grid gap-3 md:hidden">
        {data.attendance.data.students.map(row => (
          <article key={row.studentId} className="rounded-xl border border-[#E5EDE7] p-4 text-sm">
            <StudentLink studentId={row.studentId} studentName={row.studentName} />
            <p className="mt-1 text-xs text-[#718377]">{row.className}</p>
            <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
              <span>حاضر <b>{row.present}</b></span>
              <span>غائب <b>{row.absent}</b></span>
              <span>متأخر <b>{row.late}</b></span>
              <span>بعذر <b>{row.excused}</b></span>
              <span>الإجمالي <b>{row.total}</b></span>
              <span>الأخير <b>{formatDate(row.latestDate)}</b></span>
            </div>
          </article>
        ))}
      </div>
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full min-w-[760px] text-right text-sm">
          <thead className="bg-[#F5F8F5] text-xs text-[#607368]"><tr>
            <th className="p-3">الطالب</th><th className="p-3">الحلقة</th>
            <th className="p-3">حاضر</th><th className="p-3">غائب</th>
            <th className="p-3">متأخر</th><th className="p-3">بعذر</th>
            <th className="p-3">الإجمالي</th><th className="p-3">آخر سجل</th>
          </tr></thead>
          <tbody className="divide-y divide-[#EDF2EE]">
            {data.attendance.data.students.map(row => <tr key={row.studentId}>
              <td className="p-3"><StudentLink studentId={row.studentId} studentName={row.studentName} /></td>
              <td className="p-3">{row.className}</td><td className="p-3">{row.present}</td>
              <td className="p-3">{row.absent}</td><td className="p-3">{row.late}</td>
              <td className="p-3">{row.excused}</td><td className="p-3">{row.total}</td>
              <td className="p-3">{formatDate(row.latestDate)}</td>
            </tr>)}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function AttendanceDailyTable({ data }: { data: AcademicReportsData }) {
  if (data.attendance.state !== "ready") return null;
  return (
    <section className="rounded-2xl border border-[#E2EAE4] bg-white p-4">
      <SectionHeader title="السجلات اليومية" description="سجلات الحضور حسب التاريخ والفلاتر الحالية." />
      <div className="grid gap-2 md:hidden">
        {data.attendance.data.records.map(row => <article key={row.id} className="flex items-center justify-between gap-3 rounded-xl border p-3 text-sm">
          <div><StudentLink studentId={row.studentId} studentName={row.studentName} /><p className="text-xs text-[#718377]">{row.className} · {formatDate(row.date)}</p></div>
          <b>{getAttendanceStatusLabel(row.status)}</b>
        </article>)}
      </div>
      <div className="hidden overflow-x-auto md:block"><table className="w-full text-right text-sm">
        <thead className="bg-[#F5F8F5] text-xs text-[#607368]"><tr><th className="p-3">التاريخ</th><th className="p-3">الطالب</th><th className="p-3">الحالة</th><th className="p-3">الحلقة</th></tr></thead>
        <tbody className="divide-y">{data.attendance.data.records.map(row => <tr key={row.id}><td className="p-3">{formatDate(row.date)}</td><td className="p-3"><StudentLink studentId={row.studentId} studentName={row.studentName} /></td><td className="p-3">{getAttendanceStatusLabel(row.status)}</td><td className="p-3">{row.className}</td></tr>)}</tbody>
      </table></div>
    </section>
  );
}

function MemorizationTable({ data }: { data: AcademicReportsData }) {
  if (data.memorization.state !== "ready") return null;
  return (
    <section className="rounded-2xl border border-[#E2EAE4] bg-white p-4">
      <SectionHeader title="ملخص الحفظ والمراجعة" description="آخر جلسة وقيم التقييم الموجودة دون متوسط مركب." />
      <div className="grid gap-3 md:hidden">
        {data.memorization.data.students.map(row => <article key={row.studentId} className="rounded-xl border p-4 text-sm">
          <StudentLink studentId={row.studentId} studentName={row.studentName} />
          <p className="mt-1 text-xs text-[#718377]">{row.className}</p>
          <p className="mt-3">حفظ: <b>{row.memorizationCount}</b> · مراجعة: <b>{row.reviewCount}</b></p>
          <p className="mt-1 text-xs">آخر متابعة: {formatDate(row.latestDate)} · {row.latestSurahNumber ? getSurahLabel(row.latestSurahNumber) : "لا توجد بيانات"} {row.latestAyahStart ? "من " + row.latestAyahStart + " إلى " + row.latestAyahEnd : ""}</p>
          <p className="mt-1 text-xs">التقييم الأخير: {row.latestRating ?? "لا توجد بيانات"}</p>
        </article>)}
      </div>
      <div className="hidden overflow-x-auto md:block"><table className="w-full min-w-[800px] text-right text-sm">
        <thead className="bg-[#F5F8F5] text-xs text-[#607368]"><tr><th className="p-3">الطالب</th><th className="p-3">الحلقة</th><th className="p-3">الحفظ</th><th className="p-3">المراجعة</th><th className="p-3">آخر متابعة</th><th className="p-3">آخر جلسة</th><th className="p-3">السورة والآيات</th><th className="p-3">التقييم</th></tr></thead>
        <tbody className="divide-y">{data.memorization.data.students.map(row => <tr key={row.studentId}><td className="p-3"><StudentLink studentId={row.studentId} studentName={row.studentName} /></td><td className="p-3">{row.className}</td><td className="p-3">{row.memorizationCount}</td><td className="p-3">{row.reviewCount}</td><td className="p-3">{formatDate(row.latestDate)}</td><td className="p-3">{row.latestSessionType ? getMemorizationSessionTypeLabel(row.latestSessionType) : "لا توجد بيانات"}</td><td className="p-3">{row.latestSurahNumber ? getSurahLabel(row.latestSurahNumber) + " · " + row.latestAyahStart + "–" + row.latestAyahEnd : "لا توجد بيانات"}</td><td className="p-3">{row.latestRating ?? "لا توجد بيانات"}</td></tr>)}</tbody>
      </table></div>
    </section>
  );
}

function ClassesSummary({ data }: { data: AcademicReportsData }) {
  if (data.classesSummary.length === 0) {
    return <EmptyState title="لا توجد حلقات متاحة" description="لا توجد حلقات ضمن النطاق والفلاتر الحالية." />;
  }
  return (
    <section>
      <SectionHeader title="ملخص الحلقات" description="تجميع مشتق من بيانات الفترة الحالية فقط." />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {data.classesSummary.map(row => <article key={row.classId} className="rounded-2xl border border-[#E2EAE4] bg-white p-4">
          <h3 className="font-bold">{row.className}</h3>
          <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
            <div><dt className="text-[#718377]">الطلاب</dt><dd className="font-bold">{row.studentCount}</dd></div>
            <div><dt className="text-[#718377]">سجلات الحضور</dt><dd className="font-bold">{row.attendanceCount}</dd></div>
            <div><dt className="text-[#718377]">الغياب</dt><dd className="font-bold">{row.absentCount}</dd></div>
            <div><dt className="text-[#718377]">التأخر</dt><dd className="font-bold">{row.lateCount}</dd></div>
            <div><dt className="text-[#718377]">متابعات الحفظ</dt><dd className="font-bold">{row.memorizationCount}</dd></div>
            <div><dt className="text-[#718377]">آخر نشاط</dt><dd className="font-bold">{formatDate(row.latestActivity)}</dd></div>
          </dl>
        </article>)}
      </div>
    </section>
  );
}
