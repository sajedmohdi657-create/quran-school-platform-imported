import { useCallback, useEffect, useMemo, useState } from "react";
import { formatCurrency } from "@/lib/currency";
import {
  AlertTriangle,
  ArrowRight,
  BookOpenCheck,
  CalendarCheck2,
  CheckCircle2,
  CircleDollarSign,
  Clock3,
  ReceiptText,
  RefreshCw,
  Star,
  XCircle,
} from "lucide-react";
import { useLocation, useRoute } from "wouter";
import { Button } from "@/components/ui/button";
import { QURAN_SURAHS } from "@/lib/memorization";
import {
  fetchParentStudentAcademic,
  fetchParentStudentFinance,
  fetchParentStudentLearningFollowUp,
  listMyGuardianStudents,
  type ParentStudent,
  type ParentStudentAcademicData,
  type ParentStudentFinanceData,
  type ParentLearningFollowUp,
} from "@/lib/parent-portal";

function formatDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(`${value}T00:00:00`);
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

function sessionLabel(value: string): string {
  return (
    {
      new_memorization: "التسميع الجديد",
      new_hifz: "حفظ الجديد",
      near_revision: "مراجعة قريبة",
      distant_revision: "مراجعة بعيدة",
      assessment: "تقييم",
    }[value] ?? value
  );
}

function recitationResultLabel(value: string | null): string {
  return ({ memorized: "استظهر", not_memorized: "لم يستظهر", revised: "راجع", not_revised: "لم يراجع" }[value ?? ""] ?? "غير مسجل");
}

function memorizationGradeLabel(value: number): string {
  return ({ 5: "ممتاز", 4: "جيد", 3: "حسن", 2: "متوسط الأداء", 1: "يعيد" }[value] ?? "غير محدد");
}

function surahName(number: number): string {
  return QURAN_SURAHS.find(surah => surah.number === number)?.name ?? `سورة ${number}`;
}

function chargeTypeLabel(value: string): string {
  return (
    {
      fee: "رسوم",
      registration: "تسجيل",
      materials: "لوازم",
      transport: "نقل",
      other: "أخرى",
    }[value] ?? value
  );
}

function chargeStatusLabel(value: string): string {
  return (
    {
      pending: "مستحق",
      partially_paid: "مدفوع جزئيًا",
      paid: "مدفوع",
      waived: "معفى",
      cancelled: "ملغى",
    }[value] ?? value
  );
}

function chargeStatusTone(value: string): string {
  return (
    {
      pending: "bg-[#FFF4DE] text-[#A76009]",
      partially_paid: "bg-[#EAF3FA] text-[#256D95]",
      paid: "bg-[#E8F3EC] text-[#17663B]",
      waived: "bg-[#EEF2F0] text-[#55685E]",
      cancelled: "bg-[#FDECEC] text-[#B83A3A]",
    }[value] ?? "bg-[#F1F4F2] text-[#607368]"
  );
}

function paymentMethodLabel(value: string): string {
  return (
    {
      cash: "نقدًا",
      bank_transfer: "تحويل بنكي",
      postal: "تحويل بريدي",
      cheque: "صك",
      other: "طريقة أخرى",
    }[value] ?? value
  );
}

function paymentStatusLabel(value: string): string {
  return value === "reversed" ? "معكوس" : "مكتمل";
}

function Stat({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="rounded-2xl border border-[#DCE7DF] bg-white p-4 shadow-sm">
      <p className="text-xs text-[#6A7B72]">{label}</p>
      <p className="mt-1 text-2xl font-bold text-[#173B2D]">{value}</p>
      {hint && <p className="mt-1 text-xs text-[#819087]">{hint}</p>}
    </div>
  );
}

export default function ParentStudent() {
  const [, params] = useRoute("/parent/students/:studentId");
  const [, setLocation] = useLocation();
  const studentId = params?.studentId ?? "";
  const [student, setStudent] = useState<ParentStudent | null>(null);
  const [data, setData] = useState<ParentStudentAcademicData | null>(null);
  const [finance, setFinance] = useState<ParentStudentFinanceData | null>(null);
  const [learning, setLearning] = useState<ParentLearningFollowUp | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "missing" | "error">("loading");

  const load = useCallback(async () => {
    if (!studentId) {
      setState("missing");
      return;
    }

    setState("loading");
    try {
      const students = await listMyGuardianStudents();
      const currentStudent = students.find(item => item.studentId === studentId) ?? null;
      if (!currentStudent) {
        setStudent(null);
        setData(null);
        setFinance(null);
        setLearning(null);
        setState("missing");
        return;
      }

      const [academic, financeData, learningData] = await Promise.all([
        fetchParentStudentAcademic(
          currentStudent.schoolId,
          currentStudent.studentId
        ),
        fetchParentStudentFinance(
          currentStudent.schoolId,
          currentStudent.studentId
        ),
        fetchParentStudentLearningFollowUp(
          currentStudent.schoolId,
          currentStudent.studentId
        ),
      ]);
      setStudent(currentStudent);
      setData(academic);
      setFinance(financeData);
      setLearning(learningData);
      setState("ready");
    } catch {
      setState("error");
    }
  }, [studentId]);

  useEffect(() => {
    void load();
  }, [load]);

  const attendanceRate = useMemo(() => {
    if (!data || data.attendanceSummary.totalRecords === 0) return 0;
    return Math.round(
      ((data.attendanceSummary.presentCount + data.attendanceSummary.lateCount) /
        data.attendanceSummary.totalRecords) *
        100
    );
  }, [data]);

  if (state === "loading") {
    return (
      <div className="flex min-h-[50vh] items-center justify-center" role="status">
        <span className="size-6 animate-spin rounded-full border-2 border-[#17663B]/30 border-t-[#17663B]" />
      </div>
    );
  }

  if (state === "missing") {
    return (
      <section className="rounded-2xl border border-amber-200 bg-white p-7 text-center shadow-sm">
        <XCircle className="mx-auto text-amber-700" size={38} />
        <h1 className="mt-3 text-xl font-bold text-[#173B2D]">الطالب غير متاح</h1>
        <p className="mt-2 text-sm text-[#607368]">لا توجد علاقة ولي أمر نشطة تسمح بعرض هذا الطالب.</p>
        <Button type="button" onClick={() => setLocation("/parent")} className="mt-5 bg-[#0B4738] text-white">
          العودة إلى أبنائي
        </Button>
      </section>
    );
  }

  if (state === "error" || !student || !data || !finance || !learning) {
    return (
      <section className="rounded-2xl border border-red-200 bg-white p-7 text-center shadow-sm">
        <h1 className="text-xl font-bold text-[#173B2D]">تعذر تحميل ملف الطالب</h1>
        <p className="mt-2 text-sm text-red-700">تعذر جلب بيانات الطالب حاليًا.</p>
        <Button type="button" onClick={() => void load()} className="mt-5 gap-2 bg-[#0B4738] text-white">
          <RefreshCw size={17} /> إعادة المحاولة
        </Button>
      </section>
    );
  }

  return (
    <div className="space-y-7">
      <header>
        <Button
          type="button"
          variant="ghost"
          onClick={() => setLocation("/parent")}
          className="mb-3 gap-2 px-0 text-[#17663B] hover:bg-transparent"
        >
          <ArrowRight size={17} /> العودة إلى أبنائي
        </Button>
        <p className="text-sm font-medium text-[#8A6A2E]">{student.schoolName}</p>
        <h1 className="mt-1 text-2xl font-bold text-[#173B2D] sm:text-3xl">
          {student.firstName} {student.lastName}
        </h1>
        <p className="mt-2 text-sm text-[#607368]">
          {student.branchName} · {student.className ?? "غير مسند إلى حلقة حاليًا"}
        </p>
      </header>

      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <CalendarCheck2 size={20} className="text-[#17663B]" />
          <h2 className="text-lg font-bold text-[#173B2D]">الحضور</h2>
        </div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="نسبة الحضور" value={`${attendanceRate}%`} hint="الحاضر والمتأخر من السجلات المسجلة" />
          <Stat label="حاضر" value={data.attendanceSummary.presentCount} />
          <Stat label="غائب" value={data.attendanceSummary.absentCount} />
          <Stat label="متأخر" value={data.attendanceSummary.lateCount} />
        </div>
        <p className="text-xs text-[#718279]">
          آخر تسجيل حضور: {formatDate(data.attendanceSummary.lastSessionDate)} · غياب بعذر: {data.attendanceSummary.excusedAbsenceCount}
        </p>

        <div className="overflow-hidden rounded-2xl border border-[#DCE7DF] bg-white shadow-sm">
          {data.attendanceRecords.length === 0 ? (
            <p className="p-6 text-center text-sm text-[#718279]">لا توجد سجلات حضور بعد.</p>
          ) : (
            <div className="divide-y divide-[#E7EEE9]">
              {data.attendanceRecords.map(record => (
                <div key={record.id} className="flex items-center justify-between gap-3 p-4">
                  <div>
                    <p className="text-sm font-medium text-[#173B2D]">{formatDate(record.date)}</p>
                    {record.arrivalTime && (
                      <p className="mt-1 flex items-center gap-1 text-xs text-[#718279]">
                        <Clock3 size={13} /> وقت الوصول {record.arrivalTime.slice(0, 5)}
                      </p>
                    )}
                  </div>
                  <span className={`rounded-full px-3 py-1 text-xs font-semibold ${attendanceTone(record.status)}`}>
                    {attendanceLabel(record.status)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <BookOpenCheck size={20} className="text-[#17663B]" />
          <h2 className="text-lg font-bold text-[#173B2D]">الحفظ والمراجعة</h2>
        </div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="عدد المتابعات" value={data.memorizationSummary.totalRecords} />
          <Stat
            label="متوسط التقييم"
            value={data.memorizationSummary.averageRating === null ? "—" : `${data.memorizationSummary.averageRating}/5`}
          />
          <Stat label="مجموع الأخطاء" value={data.memorizationSummary.totalErrors} />
          <Stat label="آخر متابعة" value={formatDate(data.memorizationSummary.lastRecordDate)} />
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          {data.memorizationRecords.length === 0 ? (
            <div className="rounded-2xl border border-[#DCE7DF] bg-white p-6 text-center text-sm text-[#718279] md:col-span-2">
              لا توجد سجلات حفظ أو مراجعة بعد.
            </div>
          ) : (
            data.memorizationRecords.map(record => (
              <article key={record.id} className="rounded-2xl border border-[#DCE7DF] bg-white p-4 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-medium text-[#8A6A2E]">{sessionLabel(record.sessionType)}</p>
                    <h3 className="mt-1 font-bold text-[#173B2D]">
                      سورة {surahName(record.surahNumber)} · الآيات {record.ayahStart}–{record.ayahEnd}
                    </h3>
                    <p className="mt-1 text-xs text-[#718279]">{formatDate(record.date)}</p>
                    <div className="mt-2 flex flex-wrap gap-2 text-xs">
                      <span className="rounded-full bg-[#E8F3EC] px-2.5 py-1 font-bold text-[#17663B]">{recitationResultLabel(record.recitationResult)}</span>
                      <span className="rounded-full bg-[#EAF3FA] px-2.5 py-1 font-bold text-[#256D95]">{memorizationGradeLabel(record.rating)}</span>
                    </div>
                  </div>
                  <span className="flex items-center gap-1 rounded-full bg-[#FFF7E7] px-2.5 py-1 text-xs font-bold text-[#8A6A2E]">
                    <Star size={13} /> {memorizationGradeLabel(record.rating)} · {record.rating}/5
                  </span>
                </div>
                <div className="mt-3 flex items-center gap-2 text-xs text-[#607368]">
                  {record.errorsCount === 0 ? <CheckCircle2 size={14} className="text-[#17663B]" /> : <XCircle size={14} className="text-[#B83A3A]" />}
                  <span>الأخطاء: {record.errorsCount}</span>
                </div>
                {record.nextAssignment && (
                  <div className="mt-3 rounded-xl bg-[#F5F8F5] p-3 text-sm leading-6 text-[#455B50]">
                    <span className="font-semibold text-[#173B2D]">التكليف القادم: </span>
                    {record.nextAssignment}
                  </div>
                )}
              </article>
            ))
          )}
        </div>
      </section>

      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <BookOpenCheck size={20} className="text-[#17663B]" />
          <h2 className="text-lg font-bold text-[#173B2D]">التكليفات القادمة ومتابعة المواضع</h2>
        </div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <Stat label="تكليفات الحفظ والمراجعة" value={learning.targets.length} />
          <Stat label="تكليفات متأخرة" value={learning.targets.filter(item => item.overdue && !item.completed).length} />
          <Stat label="غياب آخر 30 يومًا" value={learning.attendance.absenceCount} />
        </div>
        {learning.targets.length === 0 ? (
          <div className="rounded-2xl border border-[#DCE7DF] bg-white p-5 text-center text-sm text-[#718279]">
            لا توجد تكليفات محددة حاليًا من المعلم.
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {learning.targets.map(item => (
              <article key={item.id} className="rounded-2xl border border-[#DCE7DF] bg-white p-4 shadow-sm">
                <p className="font-bold text-[#173B2D]">
                  {item.targetKind === "new_memorization" ? "حفظ الجديد" : "مراجعة"} · سورة {surahName(item.surahNumber)}
                </p>
                <p className="mt-1 text-sm text-[#607368]">الآيات {item.ayahStart}–{item.ayahEnd}</p>
                <p className="mt-2 text-xs text-[#718279]">موعد الإنجاز: {formatDate(item.dueOn)}</p>
                <div className="mt-3 flex flex-wrap gap-2 text-xs font-bold">
                  {item.completed ? (
                    <span className="rounded-full bg-[#E8F3EC] px-3 py-1 text-[#17663B]">مكتمل</span>
                  ) : item.overdue ? (
                    <span className="rounded-full bg-[#FDECEC] px-3 py-1 text-[#B83A3A]">متأخر ويحتاج متابعة</span>
                  ) : (
                    <span className="rounded-full bg-[#EAF3FA] px-3 py-1 text-[#256D95]">قيد الإنجاز</span>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <CircleDollarSign size={21} className="text-[#17663B]" />
          <h2 className="text-lg font-bold text-[#173B2D]">المالية</h2>
        </div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="إجمالي الرسوم" value={formatCurrency(finance.summary.totalCharged)} />
          <Stat label="المدفوع" value={formatCurrency(finance.summary.totalPaid)} />
          <Stat label="المتبقي" value={formatCurrency(finance.summary.remainingAmount)} />
          <Stat
            label="المتأخر"
            value={formatCurrency(finance.summary.overdueAmount)}
            hint={finance.summary.overdueAmount > 0 ? "مبالغ تجاوز تاريخ استحقاقها" : "لا توجد متأخرات"}
          />
        </div>
        <p className="text-xs text-[#718279]">
          الاستحقاقات المفتوحة: {finance.summary.openChargesCount} · آخر دفعة مكتملة: {formatDate(finance.summary.lastPaymentDate)}
        </p>

        {finance.summary.overdueAmount > 0 && (
          <div className="flex items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900">
            <AlertTriangle className="mt-0.5 shrink-0" size={18} />
            <p>يوجد مبلغ متأخر قدره {formatCurrency(finance.summary.overdueAmount)}. يرجى مراجعة إدارة المدرسة عند الحاجة إلى توضيح.</p>
          </div>
        )}

        <div className="space-y-3">
          <h3 className="flex items-center gap-2 font-bold text-[#173B2D]">
            <ReceiptText size={18} className="text-[#17663B]" /> الاستحقاقات
          </h3>
          {finance.charges.length === 0 ? (
            <div className="rounded-2xl border border-[#DCE7DF] bg-white p-6 text-center text-sm text-[#718279]">
              لا توجد استحقاقات مالية مسجلة.
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {finance.charges.map(charge => (
                <article key={charge.id} className="rounded-2xl border border-[#DCE7DF] bg-white p-4 shadow-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-medium text-[#8A6A2E]">{chargeTypeLabel(charge.chargeType)}</p>
                      <h4 className="mt-1 font-bold text-[#173B2D]">{charge.description}</h4>
                      <p className="mt-1 text-xs text-[#718279]">الاستحقاق: {formatDate(charge.dueDate)}</p>
                    </div>
                    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${chargeStatusTone(charge.status)}`}>
                      {chargeStatusLabel(charge.status)}
                    </span>
                  </div>
                  <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs">
                    <div className="rounded-xl bg-[#F5F8F5] p-2">
                      <p className="text-[#718279]">الصافي</p>
                      <p className="mt-1 font-bold text-[#173B2D]">{formatCurrency(charge.netAmount)}</p>
                    </div>
                    <div className="rounded-xl bg-[#F5F8F5] p-2">
                      <p className="text-[#718279]">المدفوع</p>
                      <p className="mt-1 font-bold text-[#173B2D]">{formatCurrency(charge.paidAmount)}</p>
                    </div>
                    <div className="rounded-xl bg-[#F5F8F5] p-2">
                      <p className="text-[#718279]">المتبقي</p>
                      <p className={`mt-1 font-bold ${charge.isOverdue ? "text-[#B83A3A]" : "text-[#173B2D]"}`}>
                        {formatCurrency(charge.remainingAmount)}
                      </p>
                    </div>
                  </div>
                  {charge.discountAmount > 0 && (
                    <p className="mt-3 text-xs text-[#607368]">
                      الخصم المطبق: {formatCurrency(charge.discountAmount)} من أصل {formatCurrency(charge.originalAmount)}
                    </p>
                  )}
                </article>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-3">
          <h3 className="font-bold text-[#173B2D]">سجل المدفوعات</h3>
          {finance.payments.length === 0 ? (
            <div className="rounded-2xl border border-[#DCE7DF] bg-white p-6 text-center text-sm text-[#718279]">
              لا توجد مدفوعات مسجلة.
            </div>
          ) : (
            <div className="overflow-hidden rounded-2xl border border-[#DCE7DF] bg-white shadow-sm">
              <div className="divide-y divide-[#E7EEE9]">
                {finance.payments.map(payment => (
                  <div key={payment.id} className="flex items-center justify-between gap-4 p-4">
                    <div>
                      <p className="text-sm font-medium text-[#173B2D]">{payment.chargeDescription}</p>
                      <p className="mt-1 text-xs text-[#718279]">
                        {formatDate(payment.paymentDate)} · {paymentMethodLabel(payment.paymentMethod)} · {paymentStatusLabel(payment.status)}
                      </p>
                    </div>
                    <p className={`shrink-0 font-bold ${payment.status === "reversed" ? "text-[#8A6A72] line-through" : "text-[#17663B]"}`}>
                      {formatCurrency(payment.amount)}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
