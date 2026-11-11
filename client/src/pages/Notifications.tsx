import { useCallback, useEffect, useState } from "react";
import { Bell, CheckCheck, Inbox, RefreshCw, Send } from "lucide-react";
import { useLocation } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import NotificationComposerDialog from "@/components/NotificationComposerDialog";
import { useLocale } from "@/contexts/LocaleContext";
import {
  fetchMyNotificationSenderSchools,
  fetchMyNotificationContexts,
  fetchMyNotifications,
  markNotificationRead,
  type AppNotification,
  type NotificationBox,
  type NotificationCategory,
  type NotificationContext,
  type NotificationSenderSchool,
} from "@/lib/notifications";

const categories: Array<{ value: NotificationCategory | "all"; ar: string; en: string }> = [
  { value: "all", ar: "الكل", en: "All" },
  { value: "administration", ar: "الإدارة", en: "Administration" },
  { value: "teachers", ar: "المعلمون", en: "Teachers" },
  { value: "finance", ar: "المالية", en: "Finance" },
  { value: "guardians", ar: "الأولياء", en: "Guardians" },
  { value: "system", ar: "النظام", en: "System" },
];

function formatDate(value: string, locale: "ar" | "en"): string {
  try {
    return new Intl.DateTimeFormat(locale === "ar" ? "ar-DZ-u-nu-latn" : "en-GB", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

export default function Notifications() {
  const { locale, direction } = useLocale();
  const en = locale === "en";
  const [location, setLocation] = useLocation();
  const parentMode = location.startsWith("/parent/");
  const teacherMode = location.startsWith("/teacher/");
  const [box, setBox] = useState<NotificationBox>("inbox");
  const [category, setCategory] = useState<NotificationCategory | "all">("all");
  const [rows, setRows] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [senderSchools, setSenderSchools] = useState<NotificationSenderSchool[]>([]);
  const [notificationContexts, setNotificationContexts] = useState<NotificationContext[]>([]);
  const notificationContext: NotificationContext = parentMode
    ? "guardian"
    : teacherMode
      ? "teacher"
      : notificationContexts.includes("staff")
        ? "staff"
        : notificationContexts.includes("teacher")
          ? "teacher"
          : "guardian";
  const visibleCategories = parentMode
    ? categories.filter(item => ["all", "administration", "finance", "guardians"].includes(item.value))
    : notificationContext === "teacher"
      ? categories.filter(item => ["all", "administration", "teachers", "guardians"].includes(item.value))
      : categories;

  useEffect(() => {
    if (!visibleCategories.some(item => item.value === category)) setCategory("all");
  }, [category, visibleCategories]);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      setRows(await fetchMyNotifications(
        box,
        category === "all" ? null : category,
        notificationContext
      ));
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [box, category, notificationContext]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    let active = true;
    void fetchMyNotificationSenderSchools(notificationContext)
      .then(result => {
        if (active) setSenderSchools(result);
      })
      .catch(() => {
        if (active) setSenderSchools([]);
      });
    return () => { active = false; };
  }, [notificationContext]);

  useEffect(() => {
    let active = true;
    void fetchMyNotificationContexts()
      .then(result => {
        if (active) setNotificationContexts(result);
      })
      .catch(() => {
        if (active) setNotificationContexts([]);
      });
    return () => { active = false; };
  }, []);

  const openNotification = async (row: AppNotification) => {
    if (box !== "inbox") return;
    if (!row.readAt) {
      const marked = await markNotificationRead(row.notificationId, notificationContext);
      if (marked) {
        setRows(current => current.map(item =>
          item.notificationId === row.notificationId
            ? { ...item, readAt: new Date().toISOString() }
            : item
        ));
      }
    }
    if (row.targetPath) setLocation(row.targetPath);
  };

  return (
    <div className="space-y-5 p-1 sm:p-2" dir={direction}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-[#173B2D]">
            <Bell className="size-6 text-[#17663B]" /> {en ? "Notification center" : "مركز الإشعارات"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {en ? "Messages between school administration, teachers and guardians."
              : "تواصل بين إدارة المدرسة والمعلمين وأولياء الأمور."}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {senderSchools.length > 0 && (
            <NotificationComposerDialog senderSchools={senderSchools} onSent={() => setBox("sent")} />
          )}
          <Button variant="outline" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} /> {en ? "Refresh" : "تحديث"}
          </Button>
        </div>
      </div>

      <Tabs value={box} onValueChange={value => setBox(value as NotificationBox)}>
        <TabsList className="grid w-full max-w-sm grid-cols-2">
          <TabsTrigger value="inbox" className="gap-2"><Inbox className="size-4" /> {en ? "Inbox" : "الوارد"}</TabsTrigger>
          <TabsTrigger value="sent" className="gap-2"><Send className="size-4" /> {en ? "Sent" : "المرسل"}</TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="flex gap-2 overflow-x-auto pb-1">
        {visibleCategories.map(item => (
          <Button
            key={item.value}
            size="sm"
            variant={category === item.value ? "default" : "outline"}
            className={category === item.value ? "bg-[#0B4738] hover:bg-[#0B4738]/90" : ""}
            onClick={() => setCategory(item.value)}
          >
            {en ? item.en : item.ar}
          </Button>
        ))}
      </div>

      {loadError && (
        <Card className="border-red-200 bg-red-50"><CardContent className="p-4 text-sm text-red-800">{en ? "Could not load notifications. Try again." : "تعذر تحميل الإشعارات. أعد المحاولة."}</CardContent></Card>
      )}

      {loading ? (
        <div className="flex min-h-40 items-center justify-center gap-2 text-sm text-muted-foreground">
          <RefreshCw className="size-4 animate-spin" /> {en ? "Loading notifications..." : "جارٍ تحميل الإشعارات..."}
        </div>
      ) : rows.length === 0 ? (
        <Card><CardContent className="flex min-h-40 flex-col items-center justify-center gap-2 p-6 text-center text-sm text-muted-foreground"><Bell className="size-8 opacity-40" />{en ? "There are no notifications in this section yet." : "لا توجد إشعارات في هذا القسم بعد."}</CardContent></Card>
      ) : (
        <div className="space-y-3">
          {rows.map(row => {
            const unread = box === "inbox" && !row.readAt;
            const clickable = box === "inbox" && Boolean(row.targetPath);
            const danger = row.eventType.endsWith("_overdue") || row.eventType.includes("absence_follow_up");
            const warning = row.eventType.endsWith("_weakness");
            return (
              <button
                type="button"
                key={row.notificationId}
                onClick={() => void openNotification(row)}
                className={`w-full rounded-xl border p-4 ${en ? "text-left" : "text-right"} transition ${clickable ? "hover:shadow-sm" : "cursor-default"} ${danger ? "border-red-200 bg-red-50" : warning ? "border-amber-200 bg-amber-50" : unread ? "border-[#9CC8B4] bg-[#F5FBF7]" : "border-[#E2EAE4] bg-white"} ${clickable ? "hover:border-[#8FB7A5]" : ""}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      {unread && <span className="size-2 rounded-full bg-[#17663B]" aria-label={en ? "Unread" : "غير مقروء"} />}
                      <span className="font-bold text-[#173B2D]">{row.title}</span>
                      <Badge variant="outline" className={danger ? "border-red-300 text-red-800" : warning ? "border-amber-300 text-amber-800" : ""}>{en ? categories.find(item => item.value === row.category)?.en : categories.find(item => item.value === row.category)?.ar}</Badge>
                      {unread && <Badge className="bg-[#17663B]">{en ? "New" : "جديد"}</Badge>}
                    </div>
                    <p className="mt-2 text-sm leading-6 text-[#40564B]">{row.body}</p>
                    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      <span>{en ? "School" : "المدرسة"}: {row.schoolName}</span>
                      {box === "inbox" ? (
                        <span>{en ? "Sender" : "المرسل"}: {row.senderName ?? (en ? "System" : "النظام")}</span>
                      ) : (
                        <span>{en ? "Recipient" : "المستلم"}: {row.recipientName}</span>
                      )}
                      <span>{formatDate(row.createdAt, locale)}</span>
                    </div>
                  </div>
                  {box === "inbox" && row.readAt && <CheckCheck className="mt-1 size-4 shrink-0 text-[#17663B]" />}
                </div>
              </button>
            );
          })}
        </div>
      )}

      {parentMode && (
        <p className="text-xs text-muted-foreground">{en ? "Guardians can send individual messages only to school administration or their children's assigned teachers." : "يمكن لولي الأمر إرسال إشعار فردي فقط إلى إدارة المدرسة أو معلمي أبنائه."}</p>
      )}
    </div>
  );
}
