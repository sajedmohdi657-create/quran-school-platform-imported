import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  BookOpenCheck,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  History,
  Loader2,
  Pencil,
  RefreshCw,
  RotateCcw,
  Save,
  ShieldAlert,
  Star,
  UserRound,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { MemorizationFocusNotes } from "@/components/MemorizationFocusNotes";
import GroupMemorizationEntry from "@/components/GroupMemorizationEntry";
import MushafPreviewButton from "@/components/MushafPreviewButton";
import StudentAvatar from "@/components/StudentAvatar";
import StudentQuranCard from "@/components/StudentQuranCard";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/contexts/AuthContext";
import {
  APP_VERSION,
  assertCurrentAppVersion,
  isStaleAppVersionError,
} from "@/lib/app-version";
import {
  fetchMemorizationManagerScope,
  type MemorizationManagerScope,
} from "@/lib/memorization-manager-scope";
import {
  MEMORIZATION_SESSION_TYPES,
  MEMORIZATION_RATING_OPTIONS,
  getDefaultMemorizationResult,
  getMemorizationRatingLabel,
  getMemorizationResultLabel,
  QURAN_SURAHS,
  createMemorizationDraft,
  draftFromMemorizationRecord,
  fetchMemorizationAudit,
  fetchMemorizationScope,
  fetchMemorizationWorkspace,
  fetchStudentMemorizationRecords,
  fetchAllStudentMemorizationRecords,
  getMemorizationErrorMessage,
  getMemorizationSessionLabel,
  getSurahByNumber,
  getTodayInputValue,
  saveMemorizationRecord,
  type MemorizationAuditEntry,
  type MemorizationDraft,
  type MemorizationRecord,
  type MemorizationScope,
  type MemorizationWorkspace,
} from "@/lib/memorization";
import { getSupabaseClient } from "@/lib/supabase";
import {
  deleteTeacherMemorizationDraft,
  getTeacherMemorizationRecords,
  getTeacherMemorizationScope,
  getTeacherMemorizationWorkspace,
  listTeacherMemorizationDrafts,
  saveTeacherMemorizationDraft,
  saveTeacherMemorizationRecords,
  saveTeacherMemorizationScope,
  saveTeacherMemorizationWorkspace,
  updateTeacherMemorizationDraftState,
  type TeacherOfflineScope,
} from "@/lib/teacher-offline";

const sessionOptions = MEMORIZATION_SESSION_TYPES.map(value => ({
  value,
  label: getMemorizationSessionLabel(value),
}));

const auditFieldLabels: Record<string, string> = {
  record_date: "التاريخ",
  session_type: "نوع الجلسة",
  surah_number: "السورة",
  ayah_start: "بداية الآيات",
  ayah_end: "نهاية الآيات",
  rating: "درجة الأداء",
  errors_count: "عدد الأخطاء",
  recitation_result: "نتيجة الجلسة",
  notes: "الملاحظات",
  next_assignment: "الواجب القادم",
};

const emptyManagerScope: MemorizationManagerScope = {
  schoolWide: false,
  branchIds: [],
};

function StateCard({
  title,
  description,
  kind = "neutral",
  action,
}: {
  title: string;
  description: string;
  kind?: "neutral" | "error" | "forbidden";
  action?: ReactNode;
}) {
  const Icon = kind === "forbidden" ? ShieldAlert : Users;
  const color =
    kind === "error"
      ? "border-red-200 text-red-700"
      : kind === "forbidden"
        ? "border-amber-200 text-amber-800"
        : "border-gray-200 text-gray-600";

  return (
    <Card
      className={`border p-8 text-center shadow-sm ${color}`}
      role={kind === "error" || kind === "forbidden" ? "alert" : "status"}
    >
      <Icon className="mx-auto mb-3" size={30} aria-hidden="true" />
      <h2 className="text-lg font-bold text-[#2C3E50]">{title}</h2>
      <p className="mx-auto mt-2 max-w-xl text-sm leading-7">{description}</p>
      {action && <div className="mt-5">{action}</div>}
    </Card>
  );
}

function LoadingCard({ label }: { label: string }) {
  return (
    <Card
      className="flex items-center justify-center gap-3 border border-gray-100 p-10 text-gray-600"
      role="status"
    >
      <Loader2 className="animate-spin text-[#0B4738]" size={24} />
      <span className="text-sm font-medium">{label}</span>
    </Card>
  );
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("ar-DZ-u-nu-latn", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function getChangedLabels(entry: MemorizationAuditEntry): string[] {
  if (entry.operation === "insert" || !entry.oldValues) {
    return ["إنشاء السجل"];
  }

  return Object.keys(entry.newValues).flatMap(key => {
    if (entry.oldValues?.[key] === entry.newValues[key]) return [];
    return [auditFieldLabels[key] ?? key];
  });
}

export default function Memorization() {
  const {
    school,
    user,
    session,
    membership,
    roles,
    isSchoolAdmin,
  } = useAuth();
  const [scope, setScope] = useState<MemorizationScope | null>(null);
  const [scopeLoading, setScopeLoading] = useState(true);
  const [scopeError, setScopeError] = useState<string | null>(null);
  const [managerScope, setManagerScope] =
    useState<MemorizationManagerScope>(emptyManagerScope);
  const [branchId, setBranchId] = useState("");
  const [classId, setClassId] = useState("");
  const [entryMode, setEntryMode] = useState<"individual" | "group">(() =>
    new URLSearchParams(window.location.search).get("mode") === "group"
      ? "group"
      : "individual"
  );
  const [recordDate, setRecordDate] = useState(getTodayInputValue);
  const [workspace, setWorkspace] = useState<MemorizationWorkspace | null>(null);
  const [workspaceLoading, setWorkspaceLoading] = useState(false);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [workspaceReload, setWorkspaceReload] = useState(0);
  const [selectedStudentId, setSelectedStudentId] = useState("");
  const [showAllHistory, setShowAllHistory] = useState(false);
  const [records, setRecords] = useState<MemorizationRecord[]>([]);
  const [cardRecords, setCardRecords] = useState<MemorizationRecord[]>([]);
  const [recordsLoading, setRecordsLoading] = useState(false);
  const [recordsError, setRecordsError] = useState<string | null>(null);
  const [recordsReload, setRecordsReload] = useState(0);
  const [draft, setDraft] = useState<MemorizationDraft>(() =>
    createMemorizationDraft(getTodayInputValue())
  );
  const [dirty, setDirty] = useState(false);
  const [needsOfflineSync, setNeedsOfflineSync] = useState(false);
  const [currentDraftId, setCurrentDraftId] = useState("individual");
  const [hasUnresolvedOfflineDrafts, setHasUnresolvedOfflineDrafts] = useState(false);
  const [onlineRevision, setOnlineRevision] = useState(0);
  const syncInFlightRef = useRef(false);
  const skipRestoreRef = useRef(false);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);
  const [auditRecordId, setAuditRecordId] = useState<string | null>(null);
  const [auditEntries, setAuditEntries] = useState<MemorizationAuditEntry[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditError, setAuditError] = useState<string | null>(null);

  const branchManagerRoleIds = useMemo(
    () =>
      roles
        .filter(role => role.code === "branch_manager")
        .map(role => role.id),
    [roles]
  );

  const loadScope = useCallback(async () => {
    if (!school?.id || !membership?.id) return;

    setScopeLoading(true);
    setScopeError(null);
    setScope(null);
    setManagerScope(emptyManagerScope);

    try {
      const [nextScope, nextManagerScope] = await Promise.all([
        fetchMemorizationScope(school.id),
        fetchMemorizationManagerScope(
          school.id,
          membership.id,
          branchManagerRoleIds
        ),
      ]);
      setScope(nextScope);
      setManagerScope(nextManagerScope);
      if (user?.id) {
        void saveTeacherMemorizationScope(user.id, school.id, nextScope).catch(() => undefined);
      }
      const params = new URLSearchParams(window.location.search);
      const requestedClass = nextScope.classes.find(item =>
        item.id === params.get("classId") && item.branchId === params.get("branchId")
      );
      const firstClass = requestedClass ?? nextScope.classes[0];
      const firstBranchId =
        firstClass?.branchId ?? nextScope.branches[0]?.id ?? "";
      const firstClassId =
        nextScope.classes.find(item => item.branchId === firstBranchId)?.id ??
        "";
      setBranchId(firstBranchId);
      setClassId(firstClassId);
    } catch (error) {
      const errorText = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
      const offline = (typeof navigator !== "undefined" && !navigator.onLine) ||
        /failed to fetch|networkerror|fetch failed|load failed|network request failed|timeout|connection reset|502|503|504|timeout|connection reset|502|503|504/.test(errorText);
      const cached = offline && user?.id
        ? await getTeacherMemorizationScope(user.id, school.id).catch(() => null)
        : null;
      if (cached) {
        setScope(cached.payload);
        setManagerScope(emptyManagerScope);
        const params = new URLSearchParams(window.location.search);
        const requestedClass = cached.payload.classes.find(item =>
          item.id === params.get("classId") && item.branchId === params.get("branchId")
        );
        const firstClass = requestedClass ?? cached.payload.classes[0];
        const firstBranchId = firstClass?.branchId ?? cached.payload.branches[0]?.id ?? "";
        setBranchId(firstBranchId);
        setClassId(cached.payload.classes.find(item => item.branchId === firstBranchId)?.id ?? "");
        setScopeError(null);
      } else {
        setScopeError(getMemorizationErrorMessage(error));
      }
    } finally {
      setScopeLoading(false);
    }
  }, [branchManagerRoleIds, membership?.id, school?.id, user?.id]);

  useEffect(() => {
    void loadScope();
  }, [loadScope]);

  useEffect(() => {
    if (!school?.id || !branchId || !classId) return;
    void (async () => {
      try {
        await getSupabaseClient().rpc("refresh_learning_follow_up_alerts", {
          target_school_id: school.id,
          target_branch_id: branchId,
          target_class_id: classId,
          target_student_id: null,
        });
      } catch {
        // Network failures must never interrupt the teacher's memorization workflow.
      }
    })();
  }, [school?.id, branchId, classId, onlineRevision]);

  const availableClasses = useMemo(
    () => scope?.classes.filter(item => item.branchId === branchId) ?? [],
    [branchId, scope?.classes]
  );
  const selectedClass = useMemo(
    () => scope?.classes.find(item => item.id === classId) ?? null,
    [classId, scope?.classes]
  );
  const selectedStudent = useMemo(
    () =>
      workspace?.students.find(student => student.id === selectedStudentId) ??
      null,
    [selectedStudentId, workspace?.students]
  );
  const currentTeacherId = useMemo(
    () =>
      workspace?.teachers.find(
        teacher => teacher.profileId === session?.user.id
      )?.id ?? null,
    [session?.user.id, workspace?.teachers]
  );
  const teacherById = useMemo(
    () => new Map(workspace?.teachers.map(item => [item.id, item.fullName])),
    [workspace?.teachers]
  );
  const selectedSurah = useMemo(
    () => getSurahByNumber(draft.surahNumber),
    [draft.surahNumber]
  );
  const canManageSelectedClass = selectedClass?.canManage === true;
  const showGroupEntry =
    canManageSelectedClass && Boolean(workspace && workspace.teachers.length > 0) && entryMode === "group";
  const canChooseAssignedTeacher =
    isSchoolAdmin ||
    managerScope.schoolWide ||
    managerScope.branchIds.includes(branchId);
  const teacherRestrictedToOwnRecords =
    currentTeacherId !== null && !canChooseAssignedTeacher;
  const teacherSelectionDisabled =
    teacherRestrictedToOwnRecords || Boolean(draft.recordId);

  useEffect(() => {
    if (!school?.id || !branchId || !classId) {
      setWorkspace(null);
      setSelectedStudentId("");
      return;
    }

    let active = true;
    setWorkspaceLoading(true);
    setWorkspaceError(null);
    setWorkspace(null);
    setSelectedStudentId("");
    setRecords([]);
    setSaveSuccess(null);
    setAuditRecordId(null);
    setAuditEntries([]);

    void fetchMemorizationWorkspace(school.id, branchId, classId)
      .then(nextWorkspace => {
        if (!active) return;
        setWorkspace(nextWorkspace);
        if (user?.id && school?.id) {
          const offlineScope: TeacherOfflineScope = { userId: user.id, schoolId: school.id, branchId, classId, recordDate };
          void saveTeacherMemorizationWorkspace(offlineScope, nextWorkspace).catch(() => undefined);
        }
        const firstStudentId = nextWorkspace.students[0]?.id ?? "";
        const linkedTeacherId =
          nextWorkspace.teachers.find(
            teacher => teacher.profileId === session?.user.id
          )?.id ?? null;
        const defaultTeacherId =
          linkedTeacherId ?? nextWorkspace.teachers[0]?.id ?? "";
        setSelectedStudentId(firstStudentId);
        setDraft(createMemorizationDraft(recordDate, defaultTeacherId));
        setCurrentDraftId("individual");
        setDirty(false);
      })
      .catch(async error => {
        if (!active) return;
        const errorText = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
        const offline = (typeof navigator !== "undefined" && !navigator.onLine) ||
          /failed to fetch|networkerror|fetch failed|load failed|network request failed|timeout|connection reset|502|503|504/.test(errorText);
        const offlineScope: TeacherOfflineScope | null = user?.id && school?.id
          ? { userId: user.id, schoolId: school.id, branchId, classId, recordDate }
          : null;
        const cached = offline && offlineScope
          ? await getTeacherMemorizationWorkspace(offlineScope).catch(() => null)
          : null;
        if (cached) {
          setWorkspace(cached.payload);
          const firstStudentId = cached.payload.students[0]?.id ?? "";
          const linkedTeacherId = cached.payload.teachers.find(teacher => teacher.profileId === session?.user.id)?.id ?? null;
          setSelectedStudentId(firstStudentId);
          setDraft(createMemorizationDraft(recordDate, linkedTeacherId ?? cached.payload.teachers[0]?.id ?? ""));
          setCurrentDraftId("individual");
          setDirty(false);
          setWorkspaceError(null);
          setSaveSuccess("تعمل على بيانات محفوظة على هذا الجهاز؛ ستُعاد مراجعة الصلاحيات عند عودة الاتصال.");
        } else {
          setWorkspaceError(getMemorizationErrorMessage(error));
        }
      })
      .finally(() => {
        if (active) setWorkspaceLoading(false);
      });

    return () => {
      active = false;
    };
  }, [
    branchId,
    classId,
    recordDate,
    school?.id,
    session?.user.id,
    workspaceReload,
    user?.id,
  ]);

  useEffect(() => {
    if (!school?.id || !branchId || !classId || !selectedStudentId) {
      setRecords([]);
      setRecordsLoading(false);
      return;
    }

    let active = true;
    setRecordsLoading(true);
    setRecordsError(null);
    setRecords([]);
    setAuditRecordId(null);
    setAuditEntries([]);

    void fetchStudentMemorizationRecords(
      school.id,
      branchId,
      classId,
      selectedStudentId,
      showAllHistory ? null : recordDate
    )
      .then(nextRecords => {
        if (active) setRecords(nextRecords);
        if (user?.id && school?.id) {
          const offlineScope: TeacherOfflineScope = { userId: user.id, schoolId: school.id, branchId, classId, recordDate };
          void saveTeacherMemorizationRecords(offlineScope, selectedStudentId, nextRecords).catch(() => undefined);
        }
      })
      .catch(async error => {
        if (!active) return;
        const errorText = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
        const offline = (typeof navigator !== "undefined" && !navigator.onLine) ||
          /failed to fetch|networkerror|fetch failed|load failed|network request failed|timeout|connection reset|502|503|504/.test(errorText);
        const offlineScope: TeacherOfflineScope | null = user?.id && school?.id
          ? { userId: user.id, schoolId: school.id, branchId, classId, recordDate }
          : null;
        const cached = offline && offlineScope
          ? await getTeacherMemorizationRecords(offlineScope, selectedStudentId).catch(() => null)
          : null;
        if (cached) {
          setRecords(cached.payload);
          setRecordsError("سجل محفوظ محليًا؛ قد لا يتضمن آخر التعديلات التي أُجريت على جهاز آخر.");
        } else {
          setRecordsError(getMemorizationErrorMessage(error));
        }
      })
      .finally(() => {
        if (active) setRecordsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [
    branchId,
    classId,
    recordDate,
    recordsReload,
    school?.id,
    selectedStudentId,
    showAllHistory,
    user?.id,
  ]);

  useEffect(() => {
    if (!school?.id || !branchId || !classId || !selectedStudentId) {
      setCardRecords([]);
      return;
    }
    let active = true;
    void fetchAllStudentMemorizationRecords(school.id, branchId, classId, selectedStudentId)
      .then(nextRecords => {
        if (active) setCardRecords(nextRecords);
        if (user?.id && school?.id) {
          const offlineScope: TeacherOfflineScope = { userId: user.id, schoolId: school.id, branchId, classId, recordDate };
          void saveTeacherMemorizationRecords(offlineScope, selectedStudentId, nextRecords).catch(() => undefined);
        }
      })
      .catch(async () => {
        const offlineScope: TeacherOfflineScope | null = user?.id && school?.id
          ? { userId: user.id, schoolId: school.id, branchId, classId, recordDate }
          : null;
        const cached = offlineScope
          ? await getTeacherMemorizationRecords(offlineScope, selectedStudentId).catch(() => null)
          : null;
        if (active) setCardRecords(cached?.payload ?? []);
      });
    return () => { active = false; };
  }, [branchId, classId, recordsReload, school?.id, selectedStudentId, workspaceReload, user?.id]);

  const handleBranchChange = (nextBranchId: string) => {
    setBranchId(nextBranchId);
    setClassId(
      scope?.classes.find(item => item.branchId === nextBranchId)?.id ?? ""
    );
  };

  const updateDraft = (update: Partial<MemorizationDraft>) => {
    if (!canManageSelectedClass || saving) return;
    setDraft(current => ({ ...current, ...update }));
    setDirty(true);
    setSaveSuccess(null);
  };

  const handleSurahChange = (surahNumber: number) => {
    if (!canManageSelectedClass) return;
    updateDraft({ surahNumber, ayahStart: 1, ayahEnd: 1 });
  };

  const handleNewRecord = () => {
    if (saving) return;
    const defaultTeacherId =
      currentTeacherId ?? workspace?.teachers[0]?.id ?? "";
    setDraft(createMemorizationDraft(recordDate, defaultTeacherId));
    setCurrentDraftId(`individual:${crypto.randomUUID()}`);
    skipRestoreRef.current = true;
    setDirty(false);
    setSaveSuccess(null);
  };

  const handleEditRecord = (record: MemorizationRecord) => {
    if (
      !canManageSelectedClass ||
      saving ||
      (teacherRestrictedToOwnRecords && record.teacherId !== currentTeacherId)
    ) {
      return;
    }
    setDraft(draftFromMemorizationRecord(record));
    setCurrentDraftId(`edit:${record.id}`);
    setDirty(false);
    setSaveSuccess(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleSave = async () => {
    if (
      !school?.id ||
      !canManageSelectedClass ||
      !branchId ||
      !classId ||
      !selectedStudentId ||
      !draft.teacherId ||
      saving
    ) {
      return;
    }

    setSaving(true);
    setSaveSuccess(null);
    setWorkspaceError(null);

    try {
      await assertCurrentAppVersion();
      const offlineScope: TeacherOfflineScope | null = user?.id
        ? { userId: user.id, schoolId: school.id, branchId, classId, recordDate }
        : null;
      const storedDraft = offlineScope && !draft.recordId
        ? await saveTeacherMemorizationDraft(offlineScope, selectedStudentId, draft, undefined, currentDraftId, true)
        : null;
      const result = await saveMemorizationRecord({
        schoolId: school.id,
        branchId,
        classId,
        studentId: selectedStudentId,
        draft,
        operationId: storedDraft?.operationId,
      });
      if (offlineScope) {
        await deleteTeacherMemorizationDraft(offlineScope, selectedStudentId, currentDraftId).catch(() => undefined);
      }
      setNeedsOfflineSync(false);
      const message =
        result.mode === "created"
          ? "تم حفظ السجل، وأصبح النموذج في وضع التعديل. اضغط «سجل جديد» لإضافة متابعة أخرى."
          : "تم تحديث سجل المتابعة بنجاح.";
      setDraft(current => ({
        ...current,
        recordId: result.recordId,
        notes: current.notes.trim(),
        nextAssignment: current.nextAssignment.trim(),
      }));
      setDirty(false);
      setSaveSuccess(message);
      toast.success(message);
      setRecordsReload(current => current + 1);
    } catch (error) {
      const errorText = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
      const offline = (typeof navigator !== "undefined" && !navigator.onLine) ||
        /failed to fetch|networkerror|fetch failed|load failed|network request failed|timeout|connection reset|502|503|504/.test(errorText);
      if (offline && user?.id && !draft.recordId) {
        try {
          const offlineScope: TeacherOfflineScope = { userId: user.id, schoolId: school!.id, branchId, classId, recordDate };
          await saveTeacherMemorizationDraft(offlineScope, selectedStudentId, draft, undefined, currentDraftId, true);
          setDirty(false);
          setNeedsOfflineSync(true);
          setHasUnresolvedOfflineDrafts(true);
          setSaveSuccess("حُفظت متابعة الحفظ على هذا الجهاز فقط؛ ستُرسل إلى المدرسة عند عودة الإنترنت.");
          setWorkspaceError(null);
          toast.info("حُفظت المتابعة محليًا — لم تصل إلى قاعدة البيانات بعد.");
          return;
        } catch {
          setWorkspaceError("انقطع الاتصال وتعذر حفظ المسودة محليًا. لا تغلق الصفحة قبل نسخ بياناتها.");
          return;
        }
      }
      const message = isStaleAppVersionError(error)
        ? "توجد نسخة أحدث من المنصة. أعد تحميل الصفحة قبل الحفظ لتجنب إنشاء سجل غير مقصود."
        : getMemorizationErrorMessage(error);
      if (user?.id && !draft.recordId) {
        const offlineScope: TeacherOfflineScope = { userId: user.id, schoolId: school!.id, branchId, classId, recordDate };
        await updateTeacherMemorizationDraftState(
          offlineScope,
          selectedStudentId,
          "conflict",
          message,
          currentDraftId
        ).catch(() => undefined);
        setNeedsOfflineSync(false);
        setHasUnresolvedOfflineDrafts(true);
      }
      setWorkspaceError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  // Restore this student's draft and detect group drafts queued for any student in the class.
  useEffect(() => {
    if (!user?.id || !school?.id || !branchId || !classId || !workspace) return;
    let active = true;
    void (async () => {
      const allDrafts = await listTeacherMemorizationDrafts(user.id).catch(() => []);
      if (!active) return;
      const draftsInScope = allDrafts.filter(item =>
        item.schoolId === school.id &&
        item.branchId === branchId &&
        item.classId === classId &&
        item.recordDate === recordDate
      );
      const hasPendingInScope = draftsInScope.some(item => item.state === "pending" || item.state === "syncing");
      setHasUnresolvedOfflineDrafts(draftsInScope.length > 0);
      setNeedsOfflineSync(hasPendingInScope);
      if (hasPendingInScope) {
        setSaveSuccess("توجد مسودات محفوظة على الجهاز بانتظار المزامنة.");
      }
      const reviewCount = draftsInScope.filter(item => item.state === "conflict" || item.state === "failed").length;
      if (reviewCount > 0) {
        setSaveSuccess("توجد مسودات تحتاج إلى مراجعة الصلاحيات أو البيانات؛ احتُفظ بها ولم تُحذف.");
      }
      if (!selectedStudentId || dirty) return;
      if (skipRestoreRef.current) {
        skipRestoreRef.current = false;
        return;
      }
      const stored = allDrafts
        .filter(item =>
          item.studentId === selectedStudentId &&
          !item.draftId.startsWith("group:")
        )
        .sort((a, b) => b.savedAt.localeCompare(a.savedAt))[0] ?? null;
      if (!active) return;
      if (!stored) return;
      setCurrentDraftId(stored.draftId);
      setDraft(stored.draft);
      setDirty(true);
      setSaveSuccess("استُعيدت متابعة حفظ محفوظة على هذا الجهاز.");
    })().catch(() => undefined);
    return () => { active = false; };
  }, [user?.id, school?.id, branchId, classId, selectedStudentId, recordDate, workspace, dirty, draft]);

  // Persist every edit before it can be lost by a refresh or browser close.
  useEffect(() => {
    if (!dirty || draft.recordId || !user?.id || !school?.id || !branchId || !classId || !selectedStudentId) return;
    const offlineScope: TeacherOfflineScope = { userId: user.id, schoolId: school.id, branchId, classId, recordDate };
    void saveTeacherMemorizationDraft(offlineScope, selectedStudentId, draft).then(async () => {
      setHasUnresolvedOfflineDrafts(true);
      const allDrafts = await listTeacherMemorizationDrafts(user.id).catch(() => []);
      setNeedsOfflineSync(allDrafts.some(item =>
        item.schoolId === school.id && item.branchId === branchId &&
        item.classId === classId && item.recordDate === recordDate &&
        (item.state === "pending" || item.state === "syncing")
      ));
    }).catch(() => {
      setWorkspaceError("تعذر حفظ نسخة محلية من متابعة الحفظ على هذا الجهاز.");
    });
  }, [dirty, draft, currentDraftId, user?.id, school?.id, branchId, classId, selectedStudentId, recordDate]);

  // Revalidate and synchronize all queued individual/group entries for this class.
  useEffect(() => {
    if (!needsOfflineSync || !navigator.onLine || !user?.id || !school?.id || !branchId || !classId || syncInFlightRef.current) return;
    let active = true;
    const offlineScope: TeacherOfflineScope = { userId: user.id, schoolId: school.id, branchId, classId, recordDate };
    void (async () => {
      const allDrafts = await listTeacherMemorizationDrafts(user.id).catch(() => []);
      const queued = allDrafts.filter(item =>
        item.schoolId === school.id &&
        item.branchId === branchId &&
        item.classId === classId &&
        item.recordDate === recordDate &&
        (item.state === "pending" || item.state === "syncing")
      );
      if (!active) return;
      if (queued.length === 0) {
        setHasUnresolvedOfflineDrafts(allDrafts.some(item =>
          item.schoolId === school.id && item.branchId === branchId &&
          item.classId === classId && item.recordDate === recordDate
        ));
        setNeedsOfflineSync(false);
        return;
      }
      if (syncInFlightRef.current) return;
      syncInFlightRef.current = true;
      setSaving(true);
      let savedCount = 0;
      let transientFailure = false;
      const permanentErrors: string[] = [];
      try {
        await assertCurrentAppVersion();
        for (const stored of queued) {
          if (!active) return;
          const itemScope: TeacherOfflineScope = {
            userId: stored.userId,
            schoolId: stored.schoolId,
            branchId: stored.branchId,
            classId: stored.classId,
            recordDate: stored.recordDate,
          };
          await updateTeacherMemorizationDraftState(itemScope, stored.studentId, "syncing", null, stored.draftId).catch(() => undefined);
          try {
            const result = await saveMemorizationRecord({
              schoolId: stored.schoolId,
              branchId: stored.branchId,
              classId: stored.classId,
              studentId: stored.studentId,
              draft: stored.draft,
              operationId: stored.operationId,
            });
            await deleteTeacherMemorizationDraft(itemScope, stored.studentId, stored.draftId);
            savedCount += 1;
            if (stored.studentId === selectedStudentId) {
              setDraft({ ...stored.draft, recordId: result.recordId });
              setDirty(false);
            }
          } catch (error) {
            const errorText = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
            const transient = !navigator.onLine || /failed to fetch|networkerror|fetch failed|load failed|network request failed|timeout|connection reset|502|503|504/.test(errorText);
            const message = isStaleAppVersionError(error)
              ? "توجد نسخة أحدث من المنصة. حدّث الصفحة قبل مزامنة المسودة."
              : getMemorizationErrorMessage(error);
            await updateTeacherMemorizationDraftState(
              itemScope,
              stored.studentId,
              transient ? "pending" : "conflict",
              message,
              stored.draftId
            ).catch(() => undefined);
            if (transient) {
              transientFailure = true;
              break;
            }
            permanentErrors.push(message);
          }
        }
        if (!active) return;
        if (savedCount > 0) {
          setRecordsReload(current => current + 1);
          setSaveSuccess(`تمت مزامنة ${savedCount} من سجلات متابعة الحفظ.`);
          toast.success(`تمت مزامنة ${savedCount} من سجلات متابعة الحفظ.`);
        }
        const remainingDrafts = await listTeacherMemorizationDrafts(user.id).catch(() => []);
        const remainingInScope = remainingDrafts.filter(item =>
          item.schoolId === school.id && item.branchId === branchId &&
          item.classId === classId && item.recordDate === recordDate
        );
        setHasUnresolvedOfflineDrafts(remainingInScope.length > 0);
        setNeedsOfflineSync(transientFailure);
        if (permanentErrors.length) {
          setWorkspaceError(`تحتاج ${permanentErrors.length} مسودة إلى مراجعة الصلاحيات أو البيانات؛ احتُفظ بها ولم تُحذف.`);
        } else if (transientFailure) {
          setWorkspaceError("تعذر الاتصال بالخادم؛ احتُفظ بالمسودات المتبقية وستُعاد المحاولة عند عودة الاتصال.");
        } else {
          setWorkspaceError(null);
        }
      } catch (error) {
        const errorText = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
        const transient = !navigator.onLine || /failed to fetch|networkerror|fetch failed|load failed|network request failed|timeout|connection reset|502|503|504/.test(errorText);
        setNeedsOfflineSync(transient);
        setWorkspaceError(isStaleAppVersionError(error)
          ? "توجد نسخة أحدث من المنصة. حدّث الصفحة قبل مزامنة المسودات."
          : getMemorizationErrorMessage(error));
      } finally {
        syncInFlightRef.current = false;
        setSaving(false);
        if (!active) setOnlineRevision(current => current + 1);
      }
    })();
    return () => { active = false; };
  }, [needsOfflineSync, onlineRevision, user?.id, school?.id, branchId, classId, selectedStudentId, recordDate]);

  useEffect(() => {
    const retryWhenOnline = () => setOnlineRevision(current => current + 1);
    window.addEventListener("online", retryWhenOnline);
    return () => window.removeEventListener("online", retryWhenOnline);
  }, []);

  const handleAuditToggle = async (recordId: string) => {
    if (!school?.id || !branchId || !classId) return;
    if (auditRecordId === recordId) {
      setAuditRecordId(null);
      setAuditEntries([]);
      setAuditError(null);
      return;
    }

    setAuditRecordId(recordId);
    setAuditEntries([]);
    setAuditError(null);
    setAuditLoading(true);

    try {
      setAuditEntries(
        await fetchMemorizationAudit(
          school.id,
          branchId,
          classId,
          recordId
        )
      );
    } catch (error) {
      setAuditError(getMemorizationErrorMessage(error));
    } finally {
      setAuditLoading(false);
    }
  };

  if (scopeLoading) {
    return (
      <main className="min-h-screen bg-[#F8F9FA] p-4 md:p-8" dir="rtl">
        <div className="mx-auto max-w-6xl">
          <LoadingCard label="جارٍ تحميل نطاق متابعة الحفظ..." />
        </div>
      </main>
    );
  }

  if (scopeError || !scope) {
    return (
      <main className="min-h-screen bg-[#F8F9FA] p-4 md:p-8" dir="rtl">
        <div className="mx-auto max-w-6xl">
          <StateCard
            kind="error"
            title="تعذر تحميل متابعة الحفظ"
            description={
              scopeError ?? "تعذر التحقق من صلاحيات متابعة الحفظ حاليًا."
            }
            action={
              <Button type="button" onClick={() => void loadScope()}>
                <RefreshCw size={16} />
                إعادة المحاولة
              </Button>
            }
          />
        </div>
      </main>
    );
  }

  if (!scope.canView) {
    return (
      <main className="min-h-screen bg-[#F8F9FA] p-4 md:p-8" dir="rtl">
        <div className="mx-auto max-w-6xl">
          <StateCard
            kind="forbidden"
            title="لا توجد صلاحية لعرض متابعة الحفظ"
            description="يجب أن يملك حسابك memorization.view أو memorization.manage ضمن المدرسة أو الفرع أو الحلقة."
          />
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#F8F9FA] pb-28" dir="rtl">
      <div className="mx-auto max-w-6xl space-y-4 px-4 py-5 md:px-6">
        {!navigator.onLine && (
          <div role="status" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900">
            أنت تعمل دون اتصال. يمكنك تسجيل متابعة فردية أو جماعية للطلاب المحمّلة بياناتهم على هذا الجهاز؛ تعديل السجلات السابقة يحتاج إلى اتصال. تُزامَن سجلات المجموعة فرديًا عند عودة الاتصال مع إعادة التحقق من الصلاحيات.
          </div>
        )}
        <Card className="border border-gray-100 p-4 shadow-sm">
          <div className="mb-4 flex items-center gap-2">
            <ClipboardList size={20} className="text-[#0B4738]" />
            <div>
              <h2 className="font-bold text-[#2C3E50]">نطاق المتابعة</h2>
              <p className="text-xs text-gray-500">
                اختر التاريخ والفرع والحلقة والطالب ضمن صلاحياتك.
              </p>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="space-y-2">
              <span className="flex items-center gap-2 text-sm font-semibold text-[#2C3E50]">
                <CalendarDays size={16} className="text-[#0B4738]" />
                التاريخ
              </span>
              <Input
                type="date"
                value={recordDate}
                onChange={event => {
                  setRecordDate(event.target.value);
                  setDraft(current => ({
                    ...current,
                    recordDate: event.target.value,
                  }));
                  setDirty(current => current || Boolean(draft.recordId));
                }}
                className="h-11"
              />
            </label>

            <label className="space-y-2">
              <span className="text-sm font-semibold text-[#2C3E50]">
                الفرع
              </span>
              <select
                value={branchId}
                onChange={event => handleBranchChange(event.target.value)}
                className="h-11 w-full rounded-md border border-gray-200 bg-white px-3 text-sm outline-none focus:border-[#0B4738] focus:ring-2 focus:ring-[#0B4738]/15"
              >
                {scope.branches.map(branch => (
                  <option key={branch.id} value={branch.id}>
                    {branch.name}
                    {branch.isMain ? " — الرئيسي" : ""}
                  </option>
                ))}
              </select>
            </label>

            <label className="space-y-2">
              <span className="text-sm font-semibold text-[#2C3E50]">
                الحلقة
              </span>
              <select
                value={classId}
                onChange={event => setClassId(event.target.value)}
                disabled={availableClasses.length === 0}
                className="h-11 w-full rounded-md border border-gray-200 bg-white px-3 text-sm outline-none focus:border-[#0B4738] focus:ring-2 focus:ring-[#0B4738]/15 disabled:bg-gray-100"
              >
                {availableClasses.length === 0 && (
                  <option value="">لا توجد حلقات ضمن هذا الفرع</option>
                )}
                {availableClasses.map(item => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                    {item.scheduleLabel ? ` — ${item.scheduleLabel}` : ""}
                  </option>
                ))}
              </select>
            </label>

            <fieldset className="min-w-0 space-y-2">
              <legend className="flex items-center gap-2 text-sm font-semibold text-[#2C3E50]">
                <UserRound size={16} className="text-[#0B4738]" />
                الطالب
              </legend>
              {!workspace || workspace.students.length === 0 ? (
                <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-3 text-sm text-gray-500">
                  لا يوجد طلاب نشطون
                </div>
              ) : (
                <div className="max-h-48 space-y-1 overflow-y-auto rounded-md border border-gray-200 bg-white p-1">
                  {workspace.students.map(student => (
                    <button
                      key={student.id}
                      type="button"
                      aria-pressed={selectedStudentId === student.id}
                      onClick={() => {
                        setSelectedStudentId(student.id);
                        setDraft(createMemorizationDraft(recordDate, currentTeacherId ?? workspace.teachers[0]?.id ?? ""));
                        setCurrentDraftId("individual");
                        setDirty(false);
                        setSaveSuccess(null);
                      }}
                      className={`flex min-h-12 w-full items-center gap-3 rounded-md px-2 py-1.5 text-right text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0B4738] ${selectedStudentId === student.id ? "bg-[#E8F3EC] font-bold text-[#0B4738]" : "text-[#2C3E50] hover:bg-gray-50"}`}
                    >
                      <StudentAvatar photoUrl={student.photoUrl} className="size-9" />
                      <span className="min-w-0 flex-1 truncate">{student.fullName}</span>
                      {selectedStudentId === student.id && <CheckCircle2 className="size-4 shrink-0" aria-hidden="true" />}
                    </button>
                  ))}
                </div>
              )}
            </fieldset>
          </div>
        </Card>

        {scope.branches.length === 0 ? (
          <StateCard
            title="لا توجد فروع متاحة"
            description="لا توجد فروع نشطة ضمن نطاق صلاحية متابعة الحفظ لهذا الحساب."
          />
        ) : availableClasses.length === 0 ? (
          <StateCard
            title="لا توجد حلقات متاحة"
            description="لا توجد حلقات نشطة ومصرح بها في الفرع المحدد. المعلم لا يرى إلا حلقاته المعيّنة."
          />
        ) : workspaceLoading ? (
          <LoadingCard label="جارٍ تحميل طلاب الحلقة والمعلمين المعيّنين..." />
        ) : workspaceError || !workspace ? (
          <StateCard
            kind="error"
            title="تعذر تحميل بيانات الحلقة"
            description={workspaceError ?? "تعذر تحميل بيانات الحلقة حاليًا."}
            action={
              <Button
                type="button"
                variant="outline"
                onClick={() => setWorkspaceReload(current => current + 1)}
              >
                <RefreshCw size={16} />
                إعادة المحاولة
              </Button>
            }
          />
        ) : workspace.students.length === 0 ? (
          <StateCard
            title="لا يوجد طلاب في الحلقة"
            description="لا يوجد طلاب نشطون مسجلون في الحلقة المحددة حاليًا."
          />
        ) : (
          <>
            {!canManageSelectedClass && (
              <div
                className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm leading-6 text-blue-800"
                role="status"
              >
                وضع العرض فقط: يمكنك مشاهدة سجلات الطالب وسجل التدقيق، ولا
                تُرسل الصفحة أي عملية إنشاء أو تعديل.
              </div>
            )}

            {canManageSelectedClass && workspace.teachers.length === 0 && (
              <StateCard
                kind="forbidden"
                title="لا يوجد معلم معيّن للحلقة"
                description="يجب تعيين معلم نشط للحلقة قبل تسجيل متابعة الحفظ."
              />
            )}

            {canManageSelectedClass && workspace.teachers.length > 0 && (
              <>
                <div
                  role="tablist"
                  aria-label="طريقة تسجيل متابعة الحفظ"
                  className="flex flex-wrap gap-2 rounded-xl border border-gray-100 bg-white p-2 shadow-sm"
                >
                  <button
                    type="button"
                    role="tab"
                    aria-selected={entryMode === "individual"}
                    onClick={() => setEntryMode("individual")}
                    className={`inline-flex min-h-11 items-center gap-2 rounded-lg px-4 text-sm font-bold ${entryMode === "individual" ? "bg-[#0B4738] text-white" : "text-[#2C3E50] hover:bg-gray-50"}`}
                  >
                    <UserRound size={17} />
                    متابعة فردية
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={entryMode === "group"}
                    onClick={() => setEntryMode("group")}
                    disabled={saving || hasUnresolvedOfflineDrafts}
                    title={hasUnresolvedOfflineDrafts ? "أكمل مزامنة المسودات المحفوظة قبل بدء مجموعة جديدة." : undefined}
                    className={`inline-flex min-h-11 items-center gap-2 rounded-lg px-4 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-40 ${entryMode === "group" ? "bg-[#0B4738] text-white" : "text-[#2C3E50] hover:bg-gray-50"}`}
                  >
                    <Users size={17} />
                    حفظ جماعي
                  </button>
                </div>
                <div hidden={!showGroupEntry}>
                  <GroupMemorizationEntry
                    key={`${school?.id}:${branchId}:${classId}:${recordDate}`}
                    schoolId={school?.id ?? ""}
                    userId={user?.id ?? ""}
                    disabled={hasUnresolvedOfflineDrafts || saving}
                    branchId={branchId}
                    classId={classId}
                    recordDate={recordDate}
                    students={workspace.students}
                    teachers={workspace.teachers}
                    defaultTeacherId={
                      teacherRestrictedToOwnRecords
                        ? (currentTeacherId ?? "")
                        : draft.teacherId || workspace.teachers[0]?.id || ""
                    }
                    teacherSelectionDisabled={teacherRestrictedToOwnRecords}
                    onSaved={() => {
                      setRecordsReload(current => current + 1);
                      setNeedsOfflineSync(true);
                      setHasUnresolvedOfflineDrafts(true);
                    }}
                  />
                </div>
              </>
            )}

            <div hidden={showGroupEntry} className="space-y-4">
            {canManageSelectedClass && workspace.teachers.length > 0 && (
              <Card className="border border-gray-100 p-4 shadow-sm">
                <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="flex items-center gap-2 font-bold text-[#2C3E50]">
                        <BookOpenCheck size={20} className="text-[#0B4738]" />
                        {draft.recordId ? "تعديل سجل المتابعة" : "تسجيل متابعة جديدة"}
                      </h2>
                      {draft.recordId && (
                        <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-bold text-amber-800">
                          وضع التعديل · {draft.recordId.slice(0, 8)}
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-gray-500">
                      الطالب: {selectedStudent?.fullName ?? "غير محدد"}
                    </p>
                    {draft.recordId && (
                      <p className="mt-2 text-xs font-medium text-amber-800">
                        الحفظ القادم سيعدّل السجل الحالي. استخدم «سجل جديد» لإضافة متابعة أخرى.
                      </p>
                    )}
                  </div>
                  {draft.recordId && (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={handleNewRecord}
                    >
                      <RotateCcw size={16} />
                      سجل جديد
                    </Button>
                  )}
                </div>

                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  <label className="space-y-2">
                    <span className="text-sm font-semibold text-[#2C3E50]">
                      المعلم
                    </span>
                    <select
                      value={
                        teacherRestrictedToOwnRecords
                          ? (currentTeacherId ?? "")
                          : draft.teacherId
                      }
                      disabled={teacherSelectionDisabled}
                      onChange={event => updateDraft({ teacherId: event.target.value })}
                      className="h-11 w-full rounded-md border border-gray-200 bg-white px-3 text-sm outline-none focus:border-[#0B4738] focus:ring-2 focus:ring-[#0B4738]/15 disabled:bg-gray-100"
                    >
                      {workspace.teachers.map(teacher => (
                        <option key={teacher.id} value={teacher.id}>
                          {teacher.fullName}
                        </option>
                      ))}
                    </select>
                    {teacherRestrictedToOwnRecords && (
                      <span className="text-xs text-gray-500">
                        تم ربط السجل بحساب المعلم الحالي تلقائيًا.
                      </span>
                    )}
                    {draft.recordId && !teacherRestrictedToOwnRecords && (
                      <span className="text-xs text-gray-500">
                        معلم السجل ثابت بعد الإنشاء ولا يمكن تغييره أثناء التعديل.
                      </span>
                    )}
                  </label>

                  <label className="space-y-2">
                    <span className="text-sm font-semibold text-[#2C3E50]">
                      نوع الجلسة
                    </span>
                    <select
                      value={draft.sessionType}
                      onChange={event => {
                        const sessionType = event.target.value as MemorizationDraft["sessionType"];
                        updateDraft({
                          sessionType,
                          recitationResult: getDefaultMemorizationResult(sessionType),
                        });
                      }}
                      className="h-11 w-full rounded-md border border-gray-200 bg-white px-3 text-sm outline-none focus:border-[#0B4738] focus:ring-2 focus:ring-[#0B4738]/15"
                    >
                      {sessionOptions.map(option => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="space-y-2">
                    <span className="text-sm font-semibold text-[#2C3E50]">
                      السورة
                    </span>
                    <select
                      value={draft.surahNumber}
                      onChange={event =>
                        handleSurahChange(Number(event.target.value))
                      }
                      className="h-11 w-full rounded-md border border-gray-200 bg-white px-3 text-sm outline-none focus:border-[#0B4738] focus:ring-2 focus:ring-[#0B4738]/15"
                    >
                      {QURAN_SURAHS.map(surah => (
                        <option key={surah.number} value={surah.number}>
                          {surah.number}. {surah.name} — {surah.ayahCount} آية
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="space-y-2">
                    <span className="text-sm font-semibold text-[#2C3E50]">
                      من الآية
                    </span>
                    <Input
                      type="number"
                      min={1}
                      max={selectedSurah.ayahCount}
                      value={draft.ayahStart}
                      onChange={event =>
                        updateDraft({ ayahStart: Number(event.target.value) })
                      }
                      className="h-11"
                    />
                  </label>

                  <label className="space-y-2">
                    <span className="text-sm font-semibold text-[#2C3E50]">
                      إلى الآية
                    </span>
                    <Input
                      type="number"
                      min={draft.ayahStart}
                      max={selectedSurah.ayahCount}
                      value={draft.ayahEnd}
                      onChange={event =>
                        updateDraft({ ayahEnd: Number(event.target.value) })
                      }
                      className="h-11"
                    />
                    <span className="text-xs text-gray-500">
                      الحد الأعلى لسورة {selectedSurah.name}: {selectedSurah.ayahCount}
                    </span>
                  </label>
                  <div className="flex items-end">
                    <MushafPreviewButton
                      surahNumber={draft.surahNumber}
                      surahName={selectedSurah.name}
                      ayahStart={draft.ayahStart}
                      ayahEnd={draft.ayahEnd}
                    />
                  </div>

                  <label className="space-y-2">
                    <span className="text-sm font-semibold text-[#2C3E50]">
                      عدد الأخطاء
                    </span>
                    <Input
                      type="number"
                      min={0}
                      max={100}
                      value={draft.errorsCount}
                      onChange={event =>
                        updateDraft({ errorsCount: Number(event.target.value) })
                      }
                      className="h-11"
                    />
                  </label>
                </div>

                <div className="mt-4 space-y-2">
                  <span className="text-sm font-semibold text-[#2C3E50]">
                    درجة الحفظ أو المراجعة
                  </span>
                  <div
                    className="grid grid-cols-2 gap-2 sm:grid-cols-5"
                    role="group"
                    aria-label="درجة الحفظ أو المراجعة"
                  >
                    {MEMORIZATION_RATING_OPTIONS.map(option => (
                      <button
                        key={option.value}
                        type="button"
                        aria-pressed={draft.rating === option.value}
                        onClick={() => updateDraft({ rating: option.value })}
                        className={`flex min-h-12 flex-col items-center justify-center rounded-xl border px-2 text-sm font-bold transition active:scale-[0.98] ${
                          draft.rating === option.value
                            ? option.value <= 2
                              ? "border-red-300 bg-red-50 text-red-800"
                              : option.value === 3
                                ? "border-amber-300 bg-amber-50 text-amber-800"
                                : "border-emerald-300 bg-emerald-50 text-emerald-800"
                            : "border-gray-200 bg-white text-gray-600 hover:border-gray-300"
                        }`}
                      >
                        <span>{option.label}</span>
                        <span className="text-[11px] opacity-70">{option.value} / 5</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  <label className="space-y-2">
                    <span className="text-sm font-semibold text-[#2C3E50]">نتيجة الجلسة</span>
                    <select
                      value={draft.recitationResult ?? ""}
                      onChange={event => updateDraft({ recitationResult: event.target.value ? event.target.value as MemorizationDraft["recitationResult"] : null })}
                      className="h-11 w-full rounded-md border border-gray-200 bg-white px-3 text-sm"
                    >
                      <option value="">اختر نتيجة الجلسة</option>
                      {(draft.sessionType === "near_revision" || draft.sessionType === "distant_revision"
                        ? [{ value: "revised", label: "راجع" }, { value: "not_revised", label: "لم يراجع" }]
                        : [{ value: "memorized", label: "استظهر" }, { value: "not_memorized", label: "لم يستظهر" }]
                      ).map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                    </select>
                  </label>
                </div>

                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  <label className="space-y-2">
                    <span className="text-sm font-semibold text-[#2C3E50]">
                      ملاحظة عامة للجلسة
                    </span>
                    <Textarea
                      value={draft.notes}
                      maxLength={1000}
                      rows={3}
                      placeholder="ملخص عام اختياري — ويمكن إدراج عدة ملاحظات مفصلة في سجل الملاحظات أسفل النموذج"
                      onChange={event => updateDraft({ notes: event.target.value })}
                      className="resize-none"
                    />
                  </label>

                  <label className="space-y-2">
                    <span className="text-sm font-semibold text-[#2C3E50]">
                      الواجب القادم
                    </span>
                    <Textarea
                      value={draft.nextAssignment}
                      maxLength={1000}
                      rows={3}
                      placeholder="المقدار المطلوب في الحصة القادمة — اختياري"
                      onChange={event =>
                        updateDraft({ nextAssignment: event.target.value })
                      }
                      className="resize-none"
                    />
                  </label>
                </div>
              </Card>
            )}

            {workspaceError && (
              <div
                className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
                role="alert"
              >
                {workspaceError}
              </div>
            )}

            {saveSuccess && (
              <div
                className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800"
                role="status"
              >
                <CheckCircle2 size={18} />
                {saveSuccess}
              </div>
            )}

            <MemorizationFocusNotes
              schoolId={school?.id ?? ""}
              branchId={branchId}
              classId={classId}
              studentId={selectedStudentId}
              studentName={selectedStudent?.fullName ?? ""}
              canManage={canManageSelectedClass}
              teachers={workspace.teachers}
              defaultTeacherId={
                teacherRestrictedToOwnRecords
                  ? (currentTeacherId ?? "")
                  : draft.teacherId || workspace.teachers[0]?.id || ""
              }
              teacherSelectionLocked={teacherRestrictedToOwnRecords}
              sourceRecordId={draft.recordId}
              observedOn={recordDate}
              suggestedSurahNumber={draft.surahNumber}
              suggestedAyahStart={draft.ayahStart}
              suggestedAyahEnd={draft.ayahEnd}
            />

            <StudentQuranCard
              studentName={selectedStudent?.fullName ?? ""}
              records={cardRecords}
              loading={recordsLoading}
            />

            <section aria-label="السجل السابق" className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="flex items-center gap-2 font-bold text-[#2C3E50]">
                    <History size={19} className="text-[#0B4738]" />
                    سجل الطالب السابق
                  </h2>
                  <p className="mt-1 text-xs text-gray-500">
                    {showAllHistory
                      ? "آخر 20 سجلًا عبر جميع التواريخ."
                      : `سجلات تاريخ ${recordDate} فقط.`}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowAllHistory(current => !current)}
                >
                  {showAllHistory ? "عرض تاريخ اليوم" : "عرض كل السجل السابق"}
                </Button>
              </div>

              {recordsError && (
                <div
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
                  role="alert"
                >
                  <span>{recordsError}</span>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => setRecordsReload(current => current + 1)}
                  >
                    <RefreshCw size={15} />
                    إعادة التحميل
                  </Button>
                </div>
              )}

              {recordsLoading ? (
                <LoadingCard label="جارٍ تحميل سجل الحفظ والمراجعة..." />
              ) : records.length === 0 && !recordsError ? (
                <StateCard
                  title="لا توجد سجلات متابعة"
                  description={
                    showAllHistory
                      ? "لم يُسجل لهذا الطالب حفظ أو مراجعة أو اختبار حتى الآن."
                      : "لا توجد سجلات لهذا الطالب في التاريخ المحدد."
                  }
                />
              ) : (
                records.map(record => {
                  const surah = getSurahByNumber(record.surahNumber);
                  const canEdit =
                    canManageSelectedClass &&
                    (!teacherRestrictedToOwnRecords ||
                      record.teacherId === currentTeacherId);
                  const auditOpen = auditRecordId === record.id;

                  return (
                    <Card
                      key={record.id}
                      className="border border-gray-100 p-4 shadow-sm"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="rounded-full bg-[#0B4738]/10 px-2.5 py-1 text-xs font-bold text-[#0B4738]">
                              {getMemorizationSessionLabel(record.sessionType)}
                            </span>
                            <span className="text-xs text-gray-500">
                              {record.recordDate}
                            </span>
                          </div>
                          <h3 className="mt-2 font-bold text-[#2C3E50]">
                            سورة {surah.name}: من الآية {record.ayahStart} إلى {record.ayahEnd}
                          </h3>
                          <p className="mt-1 text-xs text-gray-500">
                            المعلم: {teacherById.get(record.teacherId) ?? "معلم الحلقة"}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          {canEdit && (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => handleEditRecord(record)}
                            >
                              <Pencil size={15} />
                              تعديل
                            </Button>
                          )}
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => void handleAuditToggle(record.id)}
                          >
                            <History size={15} />
                            {auditOpen ? "إخفاء التدقيق" : "سجل التدقيق"}
                          </Button>
                        </div>
                      </div>

                      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
                        <div className="rounded-xl bg-gray-50 p-3">
                          <p className="text-xs text-gray-500">التقييم</p>
                          <p className="mt-1 font-bold text-[#2C3E50]">
                            {getMemorizationRatingLabel(record.rating)} · {record.rating} / 5
                          </p>
                        </div>
                        <div className="rounded-xl bg-gray-50 p-3">
                          <p className="text-xs text-gray-500">الأخطاء</p>
                          <p className="mt-1 font-bold text-[#2C3E50]">
                            {record.errorsCount}
                          </p>
                        </div>
                        <div className="col-span-2 rounded-xl bg-gray-50 p-3 sm:col-span-1">
                          <p className="text-xs text-gray-500">آخر تحديث</p>
                          <p className="mt-1 text-xs font-medium text-[#2C3E50]">
                            {formatDateTime(record.updatedAt)}
                          </p>
                        </div>
                      </div>

                      {record.recitationResult && (
                        <div className="mt-3 rounded-xl border border-[#DCE9E0] bg-[#F5FAF6] p-3 text-sm">
                          <strong className="block text-xs text-[#607368]">نتيجة الجلسة</strong>
                          <span className="mt-1 block font-bold text-[#17663B]">{getMemorizationResultLabel(record.recitationResult)}</span>
                        </div>
                      )}

                      {(record.notes || record.nextAssignment) && (
                        <div className="mt-3 grid gap-3 md:grid-cols-2">
                          {record.notes && (
                            <div className="rounded-xl border border-gray-100 p-3 text-sm leading-7 text-gray-700">
                              <strong className="block text-xs text-gray-500">
                                الملاحظات
                              </strong>
                              {record.notes}
                            </div>
                          )}
                          {record.nextAssignment && (
                            <div className="rounded-xl border border-[#C8A26A]/30 bg-[#C8A26A]/5 p-3 text-sm leading-7 text-gray-700">
                              <strong className="block text-xs text-gray-500">
                                الواجب القادم
                              </strong>
                              {record.nextAssignment}
                            </div>
                          )}
                        </div>
                      )}

                      {auditOpen && (
                        <div className="mt-4 border-t border-gray-100 pt-4">
                          <h4 className="mb-3 text-sm font-bold text-[#2C3E50]">
                            سجل التدقيق
                          </h4>
                          {auditLoading ? (
                            <div className="flex items-center gap-2 text-sm text-gray-500" role="status">
                              <Loader2 size={16} className="animate-spin" />
                              جارٍ تحميل سجل التدقيق...
                            </div>
                          ) : auditError ? (
                            <p className="text-sm text-red-700" role="alert">
                              {auditError}
                            </p>
                          ) : auditEntries.length === 0 ? (
                            <p className="text-sm text-gray-500">
                              لا توجد حركات تدقيق متاحة.
                            </p>
                          ) : (
                            <div className="space-y-2">
                              {auditEntries.map(entry => (
                                <div
                                  key={entry.id}
                                  className="rounded-xl bg-gray-50 px-3 py-2 text-sm"
                                >
                                  <div className="flex flex-wrap items-center justify-between gap-2">
                                    <strong className="text-[#2C3E50]">
                                      {entry.operation === "insert"
                                        ? "إنشاء السجل"
                                        : "تعديل السجل"}
                                    </strong>
                                    <span className="text-xs text-gray-500">
                                      {formatDateTime(entry.changedAt)}
                                    </span>
                                  </div>
                                  <p className="mt-1 text-xs leading-6 text-gray-600">
                                    الحقول: {getChangedLabels(entry).join("، ")}
                                  </p>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </Card>
                  );
                })
              )}
            </section>
            </div>
          </>
        )}
      </div>

      {!showGroupEntry && canManageSelectedClass &&
        workspace &&
        workspace.teachers.length > 0 &&
        selectedStudentId && (
          <div className="fixed inset-x-0 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-30 border-t border-gray-200 bg-white/95 p-3 shadow-[0_-8px_30px_rgba(15,23,42,0.08)] backdrop-blur md:bottom-0">
            <div className="mx-auto flex max-w-6xl items-center justify-between gap-3">
              <div className="min-w-0 text-xs text-gray-500">
                {dirty
                  ? "توجد تغييرات غير محفوظة."
                  : draft.recordId
                    ? "السجل المحمّل لم يتغير."
                    : "أدخل بيانات المتابعة ثم احفظ."}
              </div>
              <Button
                type="button"
                onClick={() => void handleSave()}
                disabled={!dirty || !draft.teacherId || saving}
                className="h-11 min-w-40 bg-[#0B4738] text-white hover:bg-[#08382D]"
              >
                {saving ? (
                  <Loader2 size={18} className="animate-spin" />
                ) : (
                  <Save size={18} />
                )}
                {draft.recordId ? "حفظ التعديل" : "حفظ المتابعة"}
              </Button>
            </div>
          </div>
        )}
    </main>
  );
}
