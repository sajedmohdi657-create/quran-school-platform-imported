import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.110.7";
import {
  getAnalysisAllowedOrigins,
  type AnalysisLocale,
  type AnalysisFeatures,
  type SafeAnalysis,
  type SchoolTrackAnalysisDependencies,
} from "./handler.ts";

function mappedEnvironmentValue(name: string): string | null {
  const raw = Deno.env.get(name);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return typeof parsed.default === "string" ? parsed.default : null;
  } catch {
    return null;
  }
}

function requiredEnvironment(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`missing_environment_${name}`);
  return value;
}

function safeArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map(item => item.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 400))
    .filter(Boolean)
    .slice(0, 6);
}

function safeText(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 900);
  return cleaned || fallback;
}

async function generateAnalysis(
  features: AnalysisFeatures,
  locale: AnalysisLocale,
  apiKey: string,
  model: string,
  baseUrl: string
): Promise<SafeAnalysis> {
  const parsedBase = new URL(baseUrl);
  const isLoopback = ["localhost", "127.0.0.1", "[::1]"].includes(parsedBase.hostname);
  if (
    (parsedBase.protocol !== "https:" && !isLoopback) ||
    parsedBase.username ||
    parsedBase.password ||
    parsedBase.search ||
    parsedBase.hash
  ) throw new Error("invalid_ai_provider_base");
  const root = parsedBase.toString().replace(/\/+$/, "");
  const endpoint = root.endsWith("/v1")
    ? `${root}/chat/completions`
    : `${root}/v1/chat/completions`;
  const prompt = {
    termAverages: features.termAverages,
    quranProgress: features.quranProgress,
  };
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    signal: AbortSignal.timeout(20_000),
    body: JSON.stringify({
      model,
      temperature: 0.2,
      max_tokens: 800,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: [
            "أنت مساعد تربوي يدعم المعلم في متابعة الطالب فقط.",
            "حلل الاتجاهات الواضحة في معدلات الفصول الدراسية الثلاثة ومؤشرات متابعة القرآن، وقدم اقتراحات قصيرة قابلة للتحقق.",
            "لا تشخّص اضطرابات أو حالات صحية أو نفسية، ولا تستنتج معلومات لا تدعمها البيانات.",
            "لا تصدر حكم نجاح/رسوب رسميًا. وضح محدودية البيانات عند الحاجة.",
            "أعد JSON صالحًا فقط بالحقول: summary كنص، strengths كمصفوفة نصوص، focusAreas كمصفوفة نصوص، actions كمصفوفة نصوص.",
            locale === "en"
              ? "Write in clear English. Do not mention IDs or names because the supplied data is pseudonymous."
              : "اكتب بالعربية الفصحى، ولا تذكر معرفات أو أسماء لأن البيانات المقدمة مجهولة الهوية.",
          ].join(" "),
        },
        {
          role: "user",
          content: `حلل مؤشرات الطالب المجهولة التالية دون إعادة سرد بيانات فردية حساسة: ${JSON.stringify(prompt)}`,
        },
      ],
    }),
  });
  if (!response.ok) throw new Error(`provider_status_${response.status}`);
  const body = await response.json() as {
    choices?: Array<{ message?: { content?: string | null } }>;
  };
  const content = body.choices?.[0]?.message?.content;
  if (!content) throw new Error("provider_empty_response");
  const parsed = JSON.parse(content) as Record<string, unknown>;
  return {
    summary: safeText(parsed.summary, "لم يقدم مزود التحليل ملخصًا واضحًا."),
    strengths: safeArray(parsed.strengths),
    focusAreas: safeArray(parsed.focusAreas),
    actions: safeArray(parsed.actions),
    quranDataIncluded: Boolean(features.quranProgress?.length),
  };
}

export function createSchoolTrackAnalysisDependencies(): SchoolTrackAnalysisDependencies {
  const url = requiredEnvironment("SUPABASE_URL");
  const publishableKey =
    mappedEnvironmentValue("SUPABASE_PUBLISHABLE_KEYS") ??
    requiredEnvironment("SUPABASE_ANON_KEY");
  const allowedOrigins = getAnalysisAllowedOrigins(
    Deno.env.get("ALLOWED_ORIGINS")
  );
  if (!allowedOrigins.size) throw new Error("allowed_origins_required");
  const apiKey = Deno.env.get("OPENAI_API_KEY")?.trim() ?? "";
  const model = Deno.env.get("OPENAI_MODEL")?.trim() || "gpt-4o-mini";
  const baseUrl = Deno.env.get("OPENAI_API_BASE")?.trim() || "https://api.openai.com/v1";

  function userClient(token: string): SupabaseClient {
    return createClient(url, publishableKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  async function callAccessRpc(
    token: string,
    functionName: string,
    args: Record<string, unknown>
  ): Promise<boolean> {
    const { data, error } = await userClient(token).rpc(functionName, args);
    if (error) throw error;
    return data === true;
  }

  return {
    allowedOrigins,
    authenticate: async token => {
      const { data, error } = await userClient(token).auth.getUser(token);
      if (error || !data.user) throw new Error("not_authorized");
      return data.user.id;
    },
    findStudent: async (token, schoolId, studentId) => {
      const { data, error } = await userClient(token)
        .from("students")
        .select("school_id, branch_id, class_id")
        .eq("school_id", schoolId)
        .eq("id", studentId)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      return {
        schoolId: data.school_id,
        branchId: data.branch_id,
        classId: data.class_id,
      };
    },
    canViewSchoolTrack: async (token, student) => {
      const args = {
        target_school_id: student.schoolId,
        target_branch_id: student.branchId,
        target_class_id: student.classId,
      };
      const [canView, canManage] = await Promise.all([
        callAccessRpc(token, "can_access_school_track_class", {
          ...args,
          target_permission_code: "school_track.view",
        }),
        callAccessRpc(token, "can_access_school_track_class", {
          ...args,
          target_permission_code: "school_track.manage",
        }),
      ]);
      return canView || canManage;
    },
    listTermAverages: async (token, schoolId, studentId) => {
      const { data, error } = await userClient(token)
        .from("school_term_averages")
        .select("academic_year, term, average")
        .eq("school_id", schoolId)
        .eq("student_id", studentId)
        .order("academic_year", { ascending: false })
        .limit(12);
      if (error) throw error;
      return (data ?? []).map(row => ({
        academicYear: row.academic_year,
        term: row.term,
        average: Number(row.average),
      }));
    },
    canViewQuranProgress: async (token, student) => {
      if (!student.classId) return false;
      const args = {
        target_school_id: student.schoolId,
        target_branch_id: student.branchId,
        target_class_id: student.classId,
      };
      const [canView, canManage] = await Promise.all([
        callAccessRpc(token, "can_access_memorization_class", {
          ...args,
          target_permission_code: "memorization.view",
        }),
        callAccessRpc(token, "can_access_memorization_class", {
          ...args,
          target_permission_code: "memorization.manage",
        }),
      ]);
      return canView || canManage;
    },
    listQuranProgress: async (token, studentId) => {
      const { data, error } = await userClient(token)
        .from("memorization_records")
        .select("record_date, session_type, surah_number, ayah_start, ayah_end, rating, errors_count")
        .eq("student_id", studentId)
        .order("record_date", { ascending: false })
        .limit(40);
      if (error) throw error;
      return (data ?? []).map(row => ({
        date: row.record_date,
        sessionType: row.session_type,
        surahNumber: row.surah_number,
        ayahStart: row.ayah_start,
        ayahEnd: row.ayah_end,
        rating: row.rating,
        errorsCount: row.errors_count,
      }));
    },
    analyze: async (features, locale) => {
      if (!apiKey) throw new Error("ai_not_configured");
      return generateAnalysis(features, locale, apiKey, model, baseUrl);
    },
    log: event => console.error(JSON.stringify(event)),
  };
}
