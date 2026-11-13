import {
  corsHeaders,
  getBearerToken,
  isAllowedOrigin,
  parseAllowedOrigins,
} from "../invite-guardian/logic.ts";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_BODY_BYTES = 2048;
const RATE_WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 5;

export type AnalysisStudent = {
  schoolId: string;
  branchId: string;
  classId: string | null;
};
export type TermAverageSignal = {
  academicYear: string;
  term: string;
  average: number;
};
export type QuranProgressSignal = {
  date: string;
  sessionType: string;
  surahNumber: number;
  ayahStart: number;
  ayahEnd: number;
  rating: number;
  errorsCount: number;
};
export type AnalysisFeatures = {
  termAverages: TermAverageSignal[];
  quranProgress: QuranProgressSignal[] | null;
};
export type SafeAnalysis = {
  summary: string;
  strengths: string[];
  focusAreas: string[];
  actions: string[];
  quranDataIncluded: boolean;
};
export type AnalysisLocale = "ar" | "en";

export type SchoolTrackAnalysisDependencies = {
  allowedOrigins: Set<string>;
  authenticate(token: string): Promise<string>;
  findStudent(token: string, schoolId: string, studentId: string): Promise<AnalysisStudent | null>;
  canViewSchoolTrack(token: string, student: AnalysisStudent): Promise<boolean>;
  listTermAverages(token: string, schoolId: string, branchId: string, studentId: string): Promise<TermAverageSignal[]>;
  canViewQuranProgress(token: string, student: AnalysisStudent): Promise<boolean>;
  listQuranProgress(token: string, studentId: string): Promise<QuranProgressSignal[]>;
  analyze(features: AnalysisFeatures, locale: AnalysisLocale): Promise<SafeAnalysis>;
  now?(): number;
  log?(event: Record<string, unknown>): void;
};

function jsonResponse(
  body: Record<string, unknown>,
  status: number,
  origin: string | null,
  requestId: string
): Response {
  const headers = corsHeaders(origin);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  headers.set("X-Content-Type-Options", "nosniff");
  return new Response(JSON.stringify({ ...body, requestId }), { status, headers });
}

function errorResponse(
  code: string,
  status: number,
  origin: string | null,
  requestId: string
): Response {
  return jsonResponse({ ok: false, error: code }, status, origin, requestId);
}

function parseBody(value: unknown): { schoolId: string; studentId: string; locale: AnalysisLocale } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  if (Object.keys(body).some(key => !["schoolId", "studentId", "locale"].includes(key))) return null;
  if (
    typeof body.schoolId !== "string" || !UUID_PATTERN.test(body.schoolId) ||
    typeof body.studentId !== "string" || !UUID_PATTERN.test(body.studentId)
  ) return null;
  if (body.locale !== undefined && body.locale !== "ar" && body.locale !== "en") return null;
  return {
    schoolId: body.schoolId,
    studentId: body.studentId,
    locale: body.locale === "en" ? "en" : "ar",
  };
}

function noDataAnalysis(quranDataIncluded: boolean, locale: AnalysisLocale): SafeAnalysis {
  return {
    summary: locale === "en"
      ? "There is not enough data for a reliable analysis yet. Record term averages or Quran progress, then try again."
      : "لا تتوفر نتائج كافية لإعداد تحليل موثوق بعد. سجّل معدلات الفصول أو متابعة قرآنية ثم أعد المحاولة.",
    strengths: [],
    focusAreas: [],
    actions: [],
    quranDataIncluded,
  };
}

export function createSchoolTrackAnalysisHandler(
  dependencies: SchoolTrackAnalysisDependencies
): (request: Request) => Promise<Response> {
  const recentRequests = new Map<string, number[]>();
  const now = dependencies.now ?? Date.now;

  return async request => {
    const origin = request.headers.get("Origin");
    const requestId = crypto.randomUUID();
    if (!isAllowedOrigin(origin, dependencies.allowedOrigins)) {
      return errorResponse("origin_not_allowed", 403, null, requestId);
    }
    if (request.method === "OPTIONS") {
      const headers = corsHeaders(origin);
      headers.set("Cache-Control", "no-store");
      return new Response(null, { status: 204, headers });
    }
    if (request.method !== "POST") {
      return errorResponse("method_not_allowed", 405, origin, requestId);
    }

    let token: string;
    try {
      token = getBearerToken(request.headers.get("Authorization"));
    } catch {
      return errorResponse("not_authorized", 401, origin, requestId);
    }

    const bodyHeader = request.headers.get("Content-Length");
    if (bodyHeader && Number(bodyHeader) > MAX_BODY_BYTES) {
      return errorResponse("invalid_request", 413, origin, requestId);
    }
    let raw: unknown;
    try {
      const text = await request.text();
      if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
        return errorResponse("invalid_request", 413, origin, requestId);
      }
      raw = JSON.parse(text);
    } catch {
      return errorResponse("invalid_request", 400, origin, requestId);
    }
    const parsed = parseBody(raw);
    if (!parsed) return errorResponse("invalid_request", 400, origin, requestId);

    let userId: string;
    try {
      userId = await dependencies.authenticate(token);
    } catch {
      return errorResponse("not_authorized", 401, origin, requestId);
    }
    const timestamp = now();
    const calls = (recentRequests.get(userId) ?? []).filter(
      value => timestamp - value < RATE_WINDOW_MS
    );
    if (calls.length >= MAX_REQUESTS_PER_WINDOW) {
      return errorResponse("rate_limited", 429, origin, requestId);
    }
    calls.push(timestamp);
    recentRequests.set(userId, calls);
    if (recentRequests.size > 5000) {
      for (const [id, entries] of recentRequests) {
        if (!entries.some(value => timestamp - value < RATE_WINDOW_MS)) {
          recentRequests.delete(id);
        }
      }
    }

    try {
      const student = await dependencies.findStudent(
        token,
        parsed.schoolId,
        parsed.studentId
      );
      if (!student || student.schoolId !== parsed.schoolId) {
        return errorResponse("not_found", 404, origin, requestId);
      }
      if (!await dependencies.canViewSchoolTrack(token, student)) {
        return errorResponse("not_authorized", 403, origin, requestId);
      }

      const termAverages = (await dependencies.listTermAverages(
        token,
        parsed.schoolId,
        student.branchId,
        parsed.studentId
      ))
        .slice(0, 12)
        .map(row => ({
          academicYear: String(row.academicYear).slice(0, 20),
          term: String(row.term).slice(0, 60),
          average: Number(row.average),
        }))
        .filter(row => Number.isFinite(row.average) && row.average >= 0 && row.average <= 20);

      let quranProgress: QuranProgressSignal[] | null = null;
      if (student.classId && await dependencies.canViewQuranProgress(token, student)) {
        quranProgress = (await dependencies.listQuranProgress(token, parsed.studentId))
          .slice(0, 40)
          .map(row => ({
            date: String(row.date).slice(0, 10),
            sessionType: String(row.sessionType).slice(0, 32),
            surahNumber: Number(row.surahNumber),
            ayahStart: Number(row.ayahStart),
            ayahEnd: Number(row.ayahEnd),
            rating: Number(row.rating),
            errorsCount: Number(row.errorsCount),
          }))
          .filter(row => Number.isFinite(row.rating));
      }

      const quranDataIncluded = Boolean(quranProgress?.length);
      if (!termAverages.length && !quranDataIncluded) {
        return jsonResponse({ ok: true, ...noDataAnalysis(false, parsed.locale) }, 200, origin, requestId);
      }
      const analysis = await dependencies.analyze({ termAverages, quranProgress }, parsed.locale);
      return jsonResponse({ ok: true, ...analysis, quranDataIncluded }, 200, origin, requestId);
    } catch (error) {
      dependencies.log?.({ event: "school_track_analysis_failed", requestId });
      const code = error instanceof Error && error.message === "ai_not_configured"
        ? "ai_not_configured"
        : "analysis_unavailable";
      return errorResponse(code, 503, origin, requestId);
    }
  };
}

export function getAnalysisAllowedOrigins(value: string | undefined): Set<string> {
  return parseAllowedOrigins(value);
}
