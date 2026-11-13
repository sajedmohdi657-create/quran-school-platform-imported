import { lazy, Suspense, type ReactNode } from "react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch, Redirect } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import ProtectedRoute from "./components/ProtectedRoute";
import PlatformOwnerRoute from "./components/PlatformOwnerRoute";
import StaffRoute from "./components/StaffRoute";
import StudentsRoute from "./components/StudentsRoute";
import RegistrationRoute from "./components/RegistrationRoute";
import DocumentsRoute from "./components/DocumentsRoute";
import FinanceRoute from "./components/FinanceRoute";
import AttendanceRoute from "./components/AttendanceRoute";
import MemorizationRoute from "./components/MemorizationRoute";
import MembersRoute from "./components/MembersRoute";
import AcademicReportsRoute from "./components/AcademicReportsRoute";
import SchoolTrackRoute from "./components/SchoolTrackRoute";
import LoginRoute from "./components/LoginRoute";
import ParentRoute from "./components/ParentRoute";
import AppShell from "./components/AppShell";
import ParentShell from "./components/ParentShell";
import {
  captureGuardianInviteSession,
  captureTeacherInviteSession,
} from "./lib/invite-session";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import { LocaleProvider, useLocale } from "./contexts/LocaleContext";
import { ThemeProvider } from "./contexts/ThemeContext";
import type { TranslationKey } from "./lib/locale";
import Login from "./pages/Login";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";
import PostLoginRedirect from "./pages/PostLoginRedirect";

const OfflineAttendance = lazy(() => import("./pages/OfflineAttendance"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const PlatformOwnerDashboard = lazy(() => import("./pages/PlatformOwnerDashboard"));
const SchoolRegistration = lazy(() => import("./pages/SchoolRegistration"));
const SchoolSubscriptionPage = lazy(() => import("./pages/SchoolSubscriptionPage"));
const StudentsList = lazy(() => import("./pages/StudentsList"));
const AddStudentForm = lazy(() => import("./pages/AddStudentForm"));
const EditStudentForm = lazy(() => import("./pages/EditStudentForm"));
const ClassesList = lazy(() => import("./pages/ClassesList"));
const AddClassForm = lazy(() => import("./pages/AddClassForm"));
const TeachersList = lazy(() => import("./pages/TeachersList"));
const AddTeacherForm = lazy(() => import("./pages/AddTeacherForm"));
const EditTeacherForm = lazy(() => import("./pages/EditTeacherForm"));
const ClassDetails = lazy(() => import("./pages/ClassDetails"));
const TeacherDetails = lazy(() => import("./pages/TeacherDetails"));
const SchoolBackups = lazy(() => import("./pages/SchoolBackups"));

const FinanceDashboard = lazy(() => import("./pages/FinanceDashboard"));
const FeePlans = lazy(() => import("./pages/FeePlans"));
const StudentCharges = lazy(() => import("./pages/StudentCharges"));
const Payments = lazy(() => import("./pages/Payments"));
const Employees = lazy(() => import("./pages/Employees"));
const Payroll = lazy(() => import("./pages/Payroll"));
const PayrollHistory = lazy(() => import("./pages/PayrollHistory"));
const Treasury = lazy(() => import("./pages/Treasury"));
const TreasuryReconciliation = lazy(() => import("./pages/TreasuryReconciliation"));
const Expenses = lazy(() => import("./pages/Expenses"));
const FinancialReports = lazy(() => import("./pages/FinancialReports"));
const FinancialPeriodClose = lazy(() => import("./pages/FinancialPeriodClose"));
const FinancialStatements = lazy(() => import("./pages/FinancialStatements"));
const Receipts = lazy(() => import("./pages/Receipts"));
const Attendance = lazy(() => import("./pages/Attendance"));
const Memorization = lazy(() => import("./pages/Memorization"));
const Members = lazy(() => import("./pages/Members"));
const Guardians = lazy(() => import("./pages/Guardians"));
const GuardianBulkImport = lazy(() => import("./pages/GuardianBulkImport"));
const Registrations = lazy(() => import("./pages/Registrations"));
const Documents = lazy(() => import("./pages/Documents"));
const Notifications = lazy(() => import("./pages/Notifications"));
const Student360 = lazy(() => import("./pages/Student360"));
const StudentBulkImport = lazy(() => import("./pages/StudentBulkImport"));
const PrintableStudentRegistrationForm = lazy(() => import("./pages/PrintableStudentRegistrationForm"));
const AcademicReports = lazy(() => import("./pages/AcademicReports"));
const SchoolTrack = lazy(() => import("./pages/SchoolTrackAverages"));
const AcceptInvite = lazy(() => import("./pages/AcceptInvite"));
const AcceptGuardianInvite = lazy(
  () => import("./pages/AcceptGuardianInvite")
);
const ParentHome = lazy(() => import("./pages/ParentHome"));
const ParentStudent = lazy(() => import("./pages/ParentStudent"));
const RosterAssignmentLauncher = lazy(
  () => import("./components/RosterAssignmentLauncher")
);

const ARABIC_MODULE_FALLBACKS: Partial<Record<TranslationKey, string>> = {
  "fallback.finance": "جارٍ تحميل الوحدة المالية...",
  "fallback.attendance": "جارٍ تحميل وحدة الحضور...",
  "fallback.memorization": "جارٍ تحميل وحدة متابعة الحفظ...",
  "fallback.members": "جارٍ تحميل دليل أعضاء المدرسة...",
  "fallback.registrations": "جارٍ تحميل متابعة التسجيل...",
  "fallback.documents": "جارٍ تحميل مركز الوثائق...",
  "fallback.schoolTrack": "جارٍ تحميل المسار المدرسي...",
};

function ModuleFallback({ labelKey }: { labelKey: TranslationKey }) {
  const { locale, direction, t } = useLocale();
  const label =
    locale === "ar" ? (ARABIC_MODULE_FALLBACKS[labelKey] ?? t(labelKey)) : t(labelKey);

  return (
    <main
      className="flex min-h-screen items-center justify-center bg-[#F7F8F3] p-4 text-[#173B2D]"
      dir={direction}
    >
      <div className="flex items-center gap-3" role="status">
        <span className="size-5 animate-spin rounded-full border-2 border-[#17663B]/30 border-t-[#17663B]" />
        <span className="text-sm font-medium">{label}</span>
      </div>
    </main>
  );
}

function FinancePageFallback() {
  return <ModuleFallback labelKey="fallback.finance" />;
}

function AttendancePageFallback() {
  return <ModuleFallback labelKey="fallback.attendance" />;
}

function MemorizationPageFallback() {
  return <ModuleFallback labelKey="fallback.memorization" />;
}

function Student360PageFallback() {
  return <ModuleFallback labelKey="fallback.student" />;
}

function AcademicReportsPageFallback() {
  return <ModuleFallback labelKey="fallback.academicReports" />;
}

function MembersPageFallback() {
  return <ModuleFallback labelKey="fallback.members" />;
}

function RegistrationPageFallback() {
  return <ModuleFallback labelKey="fallback.registrations" />;
}

function DocumentsPageFallback() {
  return <ModuleFallback labelKey="fallback.documents" />;
}

function AcceptInvitePageFallback() {
  return <ModuleFallback labelKey="fallback.invite" />;
}

function ParentPageFallback() {
  return <ModuleFallback labelKey="fallback.parent" />;
}

function NotificationsPageFallback() {
  return <ModuleFallback labelKey="fallback.notifications" />;
}

function Shell({ children }: { children: ReactNode }) {
  return <AppShell>{children}</AppShell>;
}

captureTeacherInviteSession();
captureGuardianInviteSession();

function Router() {
  const { locale } = useLocale();
  const { user, loading } = useAuth();
  const offlineSession =
    typeof navigator !== "undefined" &&
    !navigator.onLine &&
    Boolean(user?.id) &&
    !loading;
  const offlineAllowedPaths = ["/offline", "/attendance", "/memorization", "/login"];
  if (
    offlineSession &&
    typeof window !== "undefined" &&
    !offlineAllowedPaths.some(path =>
      window.location.pathname === path || window.location.pathname.startsWith(`${path}/`)
    )
  ) {
    return <Redirect to="/offline" />;
  }
  return (
    <Suspense fallback={<FinancePageFallback />}>
      <Switch>
        <Route path="/offline">
          <Suspense fallback={<FinancePageFallback />}>
            <OfflineAttendance />
          </Suspense>
        </Route>
        <Route path="/school-registration">
          <Suspense fallback={<FinancePageFallback />}>
            <SchoolRegistration />
          </Suspense>
        </Route>
        <Route path="/platform-owner">
          <PlatformOwnerRoute>
            <Suspense fallback={<FinancePageFallback />}>
              <PlatformOwnerDashboard />
            </Suspense>
          </PlatformOwnerRoute>
        </Route>
        <Route path="/login">
          <LoginRoute>
            <div className="relative">
              <Login />
              <a href="/school-registration" className="fixed bottom-4 left-1/2 z-30 -translate-x-1/2 rounded-full bg-white/95 px-4 py-2 text-sm font-bold text-[#0F5132] shadow-lg underline underline-offset-4">
                {locale === "ar" ? "تسجيل مدرسة جديدة" : "Register a new school"}
              </a>
            </div>
          </LoginRoute>
        </Route>
        <Route path="/forgot-password" component={ForgotPassword} />
        <Route path="/reset-password" component={ResetPassword} />
        <Route path="/post-login" component={PostLoginRedirect} />
        <Route path="/accept-invite">
          <Suspense fallback={<AcceptInvitePageFallback />}>
            <AcceptInvite />
          </Suspense>
        </Route>
        <Route path="/accept-guardian-invite">
          <Suspense fallback={<AcceptInvitePageFallback />}>
            <AcceptGuardianInvite />
          </Suspense>
        </Route>
        <Route path="/parent/notifications">
          <ParentRoute>
            <ParentShell>
              <Suspense fallback={<NotificationsPageFallback />}>
                <Notifications />
              </Suspense>
            </ParentShell>
          </ParentRoute>
        </Route>
        <Route path="/parent/students/:studentId">
          <ParentRoute>
            <ParentShell>
              <Suspense fallback={<ParentPageFallback />}>
                <ParentStudent />
              </Suspense>
            </ParentShell>
          </ParentRoute>
        </Route>
        <Route path="/parent">
          <ParentRoute>
            <ParentShell>
              <Suspense fallback={<ParentPageFallback />}>
                <ParentHome />
              </Suspense>
            </ParentShell>
          </ParentRoute>
        </Route>
        <Route path="/subscription">
          <ProtectedRoute>
            <Shell><SchoolSubscriptionPage /></Shell>
          </ProtectedRoute>
        </Route>
        <Route path="/dashboard">
          <ProtectedRoute><Shell><Dashboard /></Shell></ProtectedRoute>
        </Route>
        <Route path="/students/import">
          <StudentsRoute requireManage>
            <Shell>
              <Suspense fallback={<Student360PageFallback />}>
                <StudentBulkImport />
              </Suspense>
            </Shell>
          </StudentsRoute>
        </Route>
        <Route path="/students/registration-form">
          <StudentsRoute requireManage>
            <Suspense fallback={<Student360PageFallback />}>
              <PrintableStudentRegistrationForm />
            </Suspense>
          </StudentsRoute>
        </Route>
        <Route path="/students/new">
          <StudentsRoute requireManage><Shell><AddStudentForm /></Shell></StudentsRoute>
        </Route>
        <Route path="/students/:studentId/edit">
          <StudentsRoute requireManage><Shell><EditStudentForm /></Shell></StudentsRoute>
        </Route>
        <Route path="/students/:studentId">
          <StudentsRoute>
            <Shell>
              <Suspense fallback={<Student360PageFallback />}>
                <Student360 />
              </Suspense>
            </Shell>
          </StudentsRoute>
        </Route>
        <Route path="/students">
          <StudentsRoute>
            <Shell>
              <StudentsList />
              <Suspense fallback={null}>
                <RosterAssignmentLauncher mode="student-class" />
              </Suspense>
            </Shell>
          </StudentsRoute>
        </Route>
        <Route path="/classes">
          <ProtectedRoute>
            <Shell>
              <ClassesList />
              <Suspense fallback={null}>
                <RosterAssignmentLauncher mode="class-teacher" />
              </Suspense>
            </Shell>
          </ProtectedRoute>
        </Route>
        <Route path="/classes/new">
          <ProtectedRoute><Shell><AddClassForm /></Shell></ProtectedRoute>
        </Route>
        <Route path="/classes/:classId">
          <ProtectedRoute><Shell><ClassDetails /></Shell></ProtectedRoute>
        </Route>
        <Route path="/teachers">
          <ProtectedRoute><Shell><TeachersList /></Shell></ProtectedRoute>
        </Route>
        <Route path="/teachers/new">
          <ProtectedRoute><Shell><AddTeacherForm /></Shell></ProtectedRoute>
        </Route>
        <Route path="/teachers/:teacherId/edit">
          <ProtectedRoute><Shell><EditTeacherForm /></Shell></ProtectedRoute>
        </Route>
        <Route path="/teachers/:teacherId">
          <ProtectedRoute><Shell><TeacherDetails /></Shell></ProtectedRoute>
        </Route>
        <Route path="/registrations">
          <RegistrationRoute>
            <Shell>
              <Suspense fallback={<RegistrationPageFallback />}>
                <Registrations />
              </Suspense>
            </Shell>
          </RegistrationRoute>
        </Route>
        <Route path="/documents">
          <DocumentsRoute>
            <Shell>
              <Suspense fallback={<DocumentsPageFallback />}>
                <Documents />
              </Suspense>
            </Shell>
          </DocumentsRoute>
        </Route>
        <Route path="/guardians/import">
          <StaffRoute>
            <Shell>
              <Suspense fallback={<ParentPageFallback />}>
                <GuardianBulkImport />
              </Suspense>
            </Shell>
          </StaffRoute>
        </Route>
        <Route path="/guardians">
          <StaffRoute>
            <Shell>
              <Suspense fallback={<ParentPageFallback />}>
                <Guardians />
              </Suspense>
            </Shell>
          </StaffRoute>
        </Route>
        <Route path="/notifications">
          <StaffRoute>
            <Shell>
              <Suspense fallback={<NotificationsPageFallback />}>
                <Notifications />
              </Suspense>
            </Shell>
          </StaffRoute>
        </Route>
        <Route path="/receipts">
          <StaffRoute>
            <Shell>
              <Suspense fallback={<FinancePageFallback />}>
                <Receipts />
              </Suspense>
            </Shell>
          </StaffRoute>
        </Route>
        <Route path="/finance">
          <FinanceRoute><Shell><FinanceDashboard /></Shell></FinanceRoute>
        </Route>
        <Route path="/finance/fee-plans">
          <FinanceRoute><Shell><FeePlans /></Shell></FinanceRoute>
        </Route>
        <Route path="/finance/charges">
          <FinanceRoute><Shell><StudentCharges /></Shell></FinanceRoute>
        </Route>
        <Route path="/finance/payments">
          <FinanceRoute><Shell><Payments /></Shell></FinanceRoute>
        </Route>
        <Route path="/staff/payroll/history">
          <FinanceRoute><Shell><PayrollHistory /></Shell></FinanceRoute>
        </Route>
        <Route path="/staff/payroll">
          <FinanceRoute><Shell><Payroll /></Shell></FinanceRoute>
        </Route>
        <Route path="/staff">
          <FinanceRoute><Shell><Employees /></Shell></FinanceRoute>
        </Route>
        <Route path="/finance/payroll/history"><Redirect to="/staff/payroll/history" /></Route>
        <Route path="/finance/payroll"><Redirect to="/staff/payroll" /></Route>
        <Route path="/finance/treasury/reconciliation">
          <FinanceRoute><Shell><TreasuryReconciliation /></Shell></FinanceRoute>
        </Route>
        <Route path="/finance/treasury">
          <FinanceRoute><Shell><Treasury /></Shell></FinanceRoute>
        </Route>
        <Route path="/finance/expenses">
          <FinanceRoute><Shell><Expenses /></Shell></FinanceRoute>
        </Route>
        <Route path="/finance/period-close">
          <FinanceRoute><Shell><FinancialPeriodClose /></Shell></FinanceRoute>
        </Route>
        <Route path="/finance/statements">
          <FinanceRoute><Shell><FinancialStatements /></Shell></FinanceRoute>
        </Route>
        <Route path="/finance/reports">
          <FinanceRoute><Shell><FinancialReports /></Shell></FinanceRoute>
        </Route>
        <Route path="/attendance">
          <AttendanceRoute>
            <Shell>
              <Suspense fallback={<AttendancePageFallback />}>
                <Attendance />
              </Suspense>
            </Shell>
          </AttendanceRoute>
        </Route>
        <Route path="/school-track">
          <SchoolTrackRoute>
            <Shell>
              <Suspense fallback={<ModuleFallback labelKey="fallback.schoolTrack" />}>
                <SchoolTrack />
              </Suspense>
            </Shell>
          </SchoolTrackRoute>
        </Route>
        <Route path="/academic-reports">
          <AcademicReportsRoute>
            <Shell>
              <Suspense fallback={<AcademicReportsPageFallback />}>
                <AcademicReports />
              </Suspense>
            </Shell>
          </AcademicReportsRoute>
        </Route>
        <Route path="/memorization">
          <MemorizationRoute>
            <Shell>
              <Suspense fallback={<MemorizationPageFallback />}>
                <Memorization />
              </Suspense>
            </Shell>
          </MemorizationRoute>
        </Route>
        <Route path="/members">
          <MembersRoute>
            <Shell>
              <Suspense fallback={<MembersPageFallback />}>
                <Members />
              </Suspense>
            </Shell>
          </MembersRoute>
        </Route>
        <Route path="/backups">
          <ProtectedRoute><Shell><SchoolBackups /></Shell></ProtectedRoute>
        </Route>
        <Route path="/">
          {loading ? <FinancePageFallback /> : <Redirect to={offlineSession ? "/offline" : "/post-login"} />}
        </Route>
        <Route component={NotFound} />
      </Switch>
    </Suspense>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <LocaleProvider>
          <ThemeProvider defaultTheme="light">
            <TooltipProvider>
              <Toaster />
              <Router />
            </TooltipProvider>
          </ThemeProvider>
        </LocaleProvider>
      </AuthProvider>
    </ErrorBoundary>
  );
}
