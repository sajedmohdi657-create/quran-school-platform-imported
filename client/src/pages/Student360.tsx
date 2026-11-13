import { useCallback, useEffect, useMemo, useState } from "react";
import { formatCurrency } from "@/lib/currency";
import {
  ArrowRight,
  BookOpenCheck,
  CalendarDays,
  CheckCircle2,
  CircleDollarSign,
  Clock3,
  GraduationCap,
  RefreshCw,
  UserRound,
  XCircle,
} from "lucide-react";
import { useLocation, useRoute } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import {
  fetchStudent360,
  type Student360Data,
} from "@/lib/student-360";
import {
  getMemorizationSessionLabel,
  getMemorizationRatingLabel,
  getMemorizationResultLabel,
  getMemorizationAccuracyLabel,
  getSurahByNumber,
} from "@/lib/memorization";
import { formatEducation, translateStudentStatus } from "@/lib/students";
import { StudentAlertSummary } from "@/components/StudentAlertSummary";
import {
  EmptyState,
  PageHeader,
  SectionHeader,
  StatCard,
} from "@/components/ui/app-primitives";
import { Button } from "@/components/ui/button";

function formatDate(value: string): string {
  if (!value) return "—";
  const date = new Date(value.length === 10 ? `${value}T00:00:00` : value);
  return Number.isNaN(date.getTime())
    ? "—"
    : new Intl.DateTimeFormat("ar-DZ-u-nu-latn", { dateStyle: "medium" }).format(date);
}

function attendanceLabel(status: string): string {
  return (
    {
      present: "حاضر",
      absent: "غائب",
      late: "متأخر",
      excused_absence: "غياب بعذر",
    }[status] ?? status
  );
}

function attendanceTone(status: string): string {
  return (
    {
      present: "bg-[#E8F3EC] text-[#17663B]",
      absent: "bg-[#FDECEC] text-[#B83A3A]",
      late: "bg-[#FFF4DE] text-[#A76009]",
      excused_absence: "bg-[#EAF3FA] text-[#256D95]",
    }[status] ?? "bg-[#F1F4F2] text-[#607368]"
  );
}

type Activity = {
  id: string;
  date: string;
  label: string;
  detail: string;
};

export default function Student360() {
  const [, params] = useRoute("/students/:studentId");
  const [, setLocation] = useLocation();
  const { school } = useAuth();
  const studentId = params?.studentId ?? "";
  const [data, setData] = useState<Student360Data | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "missing" | "error">(
    "loading"
  );

  const load = useCallback(async () => {
    if (!school?.id || !studentId) {
      setState("missing");
      return;
    }

    setState("loading");
    try {
      const nextData = await fetchStudent360(school.id, studentId);
      setData(nextData);
      setState(nextData ? "ready" : "missing");
    } catch {
      setState("error");
    }
  }, [school?.id, studentId]);

  useEffect(() => {
    void load();
  }, [load]);

  const activities = useMemo<Activity[]>(() => {
    if (!data) return [];

    const nextActivities: Activity[] = [];
    if (data.attendance.state === "ready") {
      data.attendance.data.forEach(record => {
        nextActivities.push({
          id: `attendance-${record.id}`,
          date: record.date,
          label: "حضور",
          detail: attendanceLabel(record.status),
        });
      });
    }
    if (data.memorization.state === "ready") {
      data.memorization.data.forEach(record => {
        const surah = getSurahByNumber(record.surahNumber);
        nextActivities.push({
          id: `memorization-${record.id}`,
          date: record.recordDate,
          label: "حفظ ومراجعة",
          detail: `${surah.name} — آية ${record.ayahStart} إلى ${record.ayahEnd}`,
        });
      });
    }
    if (data.schoolTrack.state === "ready") {
      data.schoolTrack.data.forEach(record => {
        nextActivities.push({
          id: `school-track-${record.id}`,
          date: record.updated_at,
          label: "معدل فصلي",
          detail: record.term + " · " + record.average.toFixed(2) + "/20",
        });
      });
    }
    if (data.finance.state === "ready") {
      data.finance.data.recentPayments.forEach(payment => {
        nextActivities.push({
          id: `payment-${payment.id}`,
          date: payment.payment_date,
          label: "دفعة مالية",
          detail: formatCurrency(
            typeof payment.amount === "number"
              ? payment.amount
              : Number(payment.amount) || 0
          ),
        });
      });
    }

    return nextActivities
      .sort((left, right) => right.date.localeCompare(left.date))
      .slice(0, 8);
  }, [data]);

  if (state === "loading") {
    return (
      <section className="flex min-h-56 items-center justify-center" role="status">
        <RefreshCw className="size-5 animate-spin text-[#17663B]" />
        <span className="mr-3 text-sm font-medium text-[#607368]">
          جارٍ تحميل ملف الطالب...
        </span>
      </section>
    );
  }

  if (state === "missing") {
    return (
      <EmptyState
        icon={UserRound}
        title="تعذر العثور على ملف الطالب"
        description="قد لا يكون الطالب موجودًا ضمن مدرستك أو لا تملك صلاحية عرضه."
        action={
          <Button variant="outline" onClick={() => setLocation("/students")}>
            العودة إلى الطلاب
          </Button>
        }
      />
    );
  }

  if (state === "error" || !data) {
    return (
      <EmptyState
        icon={XCircle}
        title="تعذر تحميل ملف الطالب"
        description="حدث خطأ أثناء جلب البيانات المسموح بها. يمكنك المحاولة مرة أخرى."
        action={
          <Button variant="outline" onClick={() => void load()}>
            <RefreshCw className="size-4" />
            إعادة المحاولة
          </Button>
        }
      />
    );
  }

  const { profile } = data;
  const attendance =
    data.attendance.state === "ready" ? data.attendance.data : null;
  const memorization =
    data.memorization.state === "ready" ? data.memorization.data : null;
  const schoolTrack =
    data.schoolTrack.state === "ready" ? data.schoolTrack.data : null;
  const finance = data.finance.state === "ready" ? data.finance.data : null;
  const attendancePresent =
    attendance?.filter(record => record.status === "present").length ?? 0;
  const attendanceAbsent =
    attendance?.filter(record => record.status === "absent").length ?? 0;
  const latestMemorization = memorization?.[0] ?? null;
  const schoolTrackAverage = schoolTrack?.length
    ? schoolTrack.reduce((total, record) => total + record.average, 0) / schoolTrack.length
    : null;

  return (
    <div className="space-y-8" dir="rtl">
      <PageHeader
        eyebrow="STUDENT 360"
        title="ملف الطالب"
        description="عرض موحد للبيانات المتاحة حسب صلاحياتك الحالية."
        action={
          <div className="flex flex-wrap gap-2">
            {data.schoolTrack.state === "ready" && (
              <Button variant="outline" onClick={() => setLocation("/school-track?studentId=" + profile.id)} className="min-h-11">
                <GraduationCap className="size-4" />
                المسار الدراسي
              </Button>
            )}
            <Button
              variant="outline"
              onClick={() => setLocation("/students")}
              className="min-h-11"
            >
              <ArrowRight className="size-4" />
              الطلاب
            </Button>
          </div>
        }
      />

      <section className="rounded-2xl border border-[#E5EDE7] bg-white p-5 shadow-[0_1px_2px_rgba(23,59,45,0.04)]">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 items-center gap-4">
            <span aria-hidden="true" className="grid size-20 shrink-0 place-items-center overflow-hidden rounded-2xl border border-[#DCE9E0] bg-[#E8F3EC] text-[#17663B]">
              {profile.photoUrl ? (
                <img src={profile.photoUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                <UserRound className="size-8" />
              )}
            </span>
            <div className="min-w-0">
              <h2 className="truncate text-xl font-extrabold text-[#173B2D]">
                {profile.firstName} {profile.lastName}
              </h2>
              <p className="mt-1 text-sm text-[#607368]">
                {profile.branchName ?? "الفرع غير متاح"}
                {profile.className ? ` · ${profile.className}` : " · بلا حلقة حالية"}
              </p>
              {profile.educationLevel && (
                <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-[#EEF4FA] px-2.5 py-1 text-xs font-bold text-[#315F7D]">
                  <GraduationCap className="size-3.5" />
                  {formatEducation(profile.educationLevel, profile.educationYear)}
                </p>
              )}
            </div>
          </div>
          <span className="inline-flex w-fit rounded-full bg-[#E8F3EC] px-3 py-1 text-xs font-bold text-[#17663B]">
            {translateStudentStatus(profile.status)}
          </span>
        </div>
        <dl className="mt-5 grid gap-3 border-t border-[#EEF3EF] pt-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <dt className="text-xs font-semibold text-[#718377]">تاريخ التسجيل</dt>
            <dd className="mt-1 font-medium text-[#244E3B]">
              {formatDate(profile.startDate)}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold text-[#718377]">المستوى التعليمي</dt>
            <dd className="mt-1 font-medium text-[#244E3B]">
              {formatEducation(profile.educationLevel, profile.educationYear)}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold text-[#718377]">الفرع</dt>
            <dd className="mt-1 font-medium text-[#244E3B]">
              {profile.branchName ?? "لا توجد بيانات"}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold text-[#718377]">الحلقة الحالية</dt>
            <dd className="mt-1 font-medium text-[#244E3B]">
              {profile.className ?? "لا توجد حلقة معيّنة"}
            </dd>
          </div>
        </dl>
      </section>

      <StudentAlertSummary attendance={attendance} memorization={memorization} />

      <section>
        <SectionHeader title="ملخص سريع" />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {attendance && (
            <>
              <StatCard
                label="حضور مسجل"
                value={String(attendancePresent)}
                hint={`من آخر ${attendance.length} سجل`}
                icon={CheckCircle2}
              />
              <StatCard
                label="غياب مسجل"
                value={String(attendanceAbsent)}
                hint={`من آخر ${attendance.length} سجل`}
                icon={XCircle}
                tone="red"
              />
            </>
          )}
          {memorization && (
            <StatCard
              label="سجلات الحفظ والمراجعة"
              value={String(memorization.length)}
              hint={
                latestMemorization
                  ? `آخر متابعة: ${formatDate(latestMemorization.recordDate)}`
                  : "لا توجد متابعة مسجلة"
              }
              icon={BookOpenCheck}
              tone="blue"
            />
          )}
          {schoolTrack && (
            <StatCard
              label="معدلات الفصول"
              value={String(schoolTrack.length)}
              hint={schoolTrackAverage === null ? "لا توجد معدلات" : `متوسط المعدلات: ${schoolTrackAverage.toFixed(2)}/20`}
              icon={GraduationCap}
              tone="green"
            />
          )}
          {finance && (
            <StatCard
              label="المتبقي المالي"
              value={formatCurrency(finance.remaining)}
              hint={`المستحق: ${formatCurrency(finance.totalDue)}`}
              icon={CircleDollarSign}
              tone="amber"
            />
          )}
          {!attendance && !memorization && !schoolTrack && !finance && (
            <EmptyState
              title="لا توجد بيانات ملخصة متاحة"
              description="تظهر الوحدات التي تملك صلاحية عرضها فقط."
            />
          )}
        </div>
      </section>

      {data.attendance.state !== "hidden" && (
        <section>
          <SectionHeader
            title="الحضور"
            description="آخر سجلات الحضور ضمن الحلقة المصرح بها."
          />
          {data.attendance.state === "error" ? (
            <EmptyState
              title="تعذر تحميل الحضور"
              description="لم يؤثر هذا الخطأ على بقية ملف الطالب."
            />
          ) : attendance && attendance.length > 0 ? (
            <div className="overflow-hidden rounded-2xl border border-[#E5EDE7] bg-white">
              <div className="divide-y divide-[#EEF3EF]">
                {attendance.map(record => (
                  <div
                    key={record.id}
                    className="flex items-center justify-between gap-4 px-4 py-3"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-[#244E3B]">
                        {formatDate(record.date)}
                      </p>
                    </div>
                    <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-bold ${attendanceTone(record.status)}`}>
                      {attendanceLabel(record.status)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <EmptyState
              icon={CalendarDays}
              title="لا توجد سجلات حضور"
              description="لا توجد سجلات حضور متاحة لهذا الطالب في الوقت الحالي."
            />
          )}
        </section>
      )}

      {data.memorization.state !== "hidden" && (
        <section>
          <SectionHeader
            title="الحفظ والمراجعة"
            description="آخر المتابعات ضمن الحلقة المصرح بها."
          />
          {data.memorization.state === "error" ? (
            <EmptyState
              title="تعذر تحميل الحفظ والمراجعة"
              description="لم يؤثر هذا الخطأ على بقية ملف الطالب."
            />
          ) : memorization && memorization.length > 0 ? (
            <div className="space-y-3">
              {memorization.slice(0, 8).map(record => {
                const surah = getSurahByNumber(record.surahNumber);
                return (
                  <article
                    key={record.id}
                    className="rounded-2xl border border-[#E5EDE7] bg-white p-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-bold text-[#244E3B]">
                          {surah.name} — آية {record.ayahStart} إلى {record.ayahEnd}
                        </p>
                        <p className="mt-1 text-xs text-[#718377]">
                          {getMemorizationSessionLabel(record.sessionType)} · {formatDate(record.recordDate)}
                        </p>
                        <div className="mt-2 flex flex-wrap gap-2 text-xs">
                          {record.recitationResult && <span className="rounded-full bg-[#E8F3EC] px-2.5 py-1 font-bold text-[#17663B]">{getMemorizationResultLabel(record.recitationResult)}</span>}
                          <span className="rounded-full bg-[#EAF3FA] px-2.5 py-1 font-bold text-[#256D95]">{getMemorizationRatingLabel(record.rating)}</span>
                          {record.recitationAccuracy && <span className="rounded-full bg-[#F1F4F2] px-2.5 py-1 font-bold text-[#607368]">{getMemorizationAccuracyLabel(record.recitationAccuracy)}</span>}
                        </div>
                        {record.focusWords && <p className="mt-2 text-xs leading-6 text-[#A76009]">مواضع التركيز: {record.focusWords}</p>}
                      </div>
                      <span className="shrink-0 rounded-full bg-[#EAF3FA] px-2.5 py-1 text-xs font-bold text-[#256D95]">
                        {getMemorizationRatingLabel(record.rating)} · {record.rating}/5
                      </span>
                    </div>
                    {record.notes && (
                      <p className="mt-3 text-sm leading-6 text-[#607368]">
                        {record.notes}
                      </p>
                    )}
                  </article>
                );
              })}
            </div>
          ) : (
            <EmptyState
              icon={BookOpenCheck}
              title="لا توجد متابعات حفظ أو مراجعة"
              description="تظهر هنا السجلات عند إضافتها ضمن الحلقة المصرح بها."
            />
          )}
        </section>
      )}

      {data.schoolTrack.state !== "hidden" && (
        <section>
          <SectionHeader
            title="المسار الدراسي"
            description="معدلات الفصول الدراسية الثلاثة فقط، دون عرض المواد أو علامات الاختبارات."
          />
          {data.schoolTrack.state === "error" ? (
            <EmptyState
              title="تعذر تحميل معدلات الفصول"
              description="لم يؤثر هذا الخطأ على سجل الحفظ أو بقية ملف الطالب."
            />
          ) : schoolTrack && schoolTrack.length > 0 ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {schoolTrack.map(record => (
                <article key={record.id} className="rounded-2xl border border-[#E5EDE7] bg-white p-4 shadow-sm">
                  <p className="text-xs font-semibold text-[#718377]">{record.academic_year}</p>
                  <p className="mt-1 font-bold text-[#244E3B]">{record.term}</p>
                  <p className="mt-3 text-2xl font-extrabold text-[#17663B]">{record.average.toFixed(2)} <span className="text-sm font-semibold text-[#718377]">/ 20</span></p>
                </article>
              ))}
            </div>
          ) : (
            <EmptyState
              icon={GraduationCap}
              title="لا توجد معدلات فصول مسجلة"
              description="تظهر هنا معدلات الفصول الأول والثاني والثالث عند تسجيلها."
            />
          )}
        </section>
      )}
      {data.finance.state !== "hidden" && (
        <section>
          <SectionHeader
            title="المالية"
            description="ملخص مالي متاح بحسب صلاحيات المالية الحالية."
          />
          {data.finance.state === "error" ? (
            <EmptyState
              title="تعذر تحميل المالية"
              description="لم يؤثر هذا الخطأ على بقية ملف الطالب."
            />
          ) : finance ? (
            <div className="grid gap-3 sm:grid-cols-3">
              <StatCard
                label="إجمالي المستحق"
                value={formatCurrency(finance.totalDue)}
                icon={CircleDollarSign}
                tone="amber"
              />
              <StatCard
                label="إجمالي المدفوع"
                value={formatCurrency(finance.paid)}
                icon={CheckCircle2}
              />
              <StatCard
                label="المتبقي"
                value={formatCurrency(finance.remaining)}
                icon={Clock3}
                tone="red"
              />
            </div>
          ) : null}
        </section>
      )}

      {activities.length > 0 && (
        <section>
          <SectionHeader
            title="آخر النشاطات"
            description="مجمعة من البيانات المسموح بعرضها في هذا الملف."
          />
          <div className="overflow-hidden rounded-2xl border border-[#E5EDE7] bg-white">
            <div className="divide-y divide-[#EEF3EF]">
              {activities.map(activity => (
                <div
                  key={activity.id}
                  className="flex items-center justify-between gap-4 px-4 py-3"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-[#244E3B]">{activity.label}</p>
                    <p className="truncate text-xs text-[#718377]">{activity.detail}</p>
                  </div>
                  <span className="shrink-0 text-xs font-medium text-[#718377]">
                    {formatDate(activity.date)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
