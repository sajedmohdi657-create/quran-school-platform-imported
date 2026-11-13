import {
  createSchoolTrackAnalysisHandler,
  type AnalysisFeatures,
  type SchoolTrackAnalysisDependencies,
} from "./handler.ts";

const schoolId = "10000000-0000-4000-8000-000000000001";
const studentId = "50000000-0000-4000-8000-000000000001";
const student = {
  schoolId,
  branchId: "20000000-0000-4000-8000-000000000001",
  classId: "30000000-0000-4000-8000-000000000001",
};

function request(body: unknown = { schoolId, studentId }, origin = "https://school.example.test") {
  return new Request("https://edge.example.test/analyze-school-track", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: "Bearer valid-token",
      origin,
    },
    body: JSON.stringify(body),
  });
}

function dependencies(
  overrides: Partial<SchoolTrackAnalysisDependencies> = {}
): SchoolTrackAnalysisDependencies {
  return {
    allowedOrigins: new Set(["https://school.example.test"]),
    authenticate: async () => "profile-1",
    findStudent: async () => student,
    canViewSchoolTrack: async () => true,
    listTermAverages: async () => [
      { academicYear: "2026/2027", term: "الفصل الأول", average: 15.5 },
      { academicYear: "2026/2027", term: "الفصل الثاني", average: 16.25 },
      { academicYear: "2026/2027", term: "الفصل الثالث", average: 17 },
    ],
    canViewQuranProgress: async () => false,
    listQuranProgress: async () => [],
    analyze: async () => ({
      summary: "أداء جيد في المتاح من البيانات.",
      strengths: ["تحسن في الرياضيات"],
      focusAreas: ["مراجعة المسائل"],
      actions: ["متابعة أسبوعية قصيرة"],
      quranDataIncluded: false,
    }),
    ...overrides,
  };
}

Deno.test("rejects unapproved origins before authentication", async () => {
  let authenticated = false;
  const handler = createSchoolTrackAnalysisHandler(dependencies({
    authenticate: async () => {
      authenticated = true;
      return "profile-1";
    },
  }));
  const response = await handler(request(undefined, "https://attacker.example"));
  if (response.status !== 403 || authenticated) throw new Error("origin allow-list was not enforced");
});

Deno.test("rejects malformed and extra request fields", async () => {
  const handler = createSchoolTrackAnalysisHandler(dependencies());
  const response = await handler(request({ schoolId, studentId, name: "private" }));
  if (response.status !== 400) throw new Error("unexpected request properties must be rejected");
});

Deno.test("rejects unsupported locale values", async () => {
  const handler = createSchoolTrackAnalysisHandler(dependencies());
  const response = await handler(request({ schoolId, studentId, locale: "fr" }));
  if (response.status !== 400) throw new Error("unsupported locale should be rejected");
});

Deno.test("requires a bearer token before authentication or data access", async () => {
  let authenticated = false;
  const handler = createSchoolTrackAnalysisHandler(dependencies({
    authenticate: async () => {
      authenticated = true;
      return "profile-1";
    },
  }));
  const response = await handler(new Request("https://edge.example.test/analyze-school-track", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://school.example.test" },
    body: JSON.stringify({ schoolId, studentId }),
  }));
  if (response.status !== 401 || authenticated) throw new Error("missing bearer token was accepted");
});

Deno.test("requires authenticated, scoped school-track access before reading results", async () => {
  let resultsRead = false;
  const handler = createSchoolTrackAnalysisHandler(dependencies({
    canViewSchoolTrack: async () => false,
    listTermAverages: async () => {
      resultsRead = true;
      return [];
    },
  }));
  const response = await handler(request());
  if (response.status !== 403 || resultsRead) throw new Error("unauthorized caller reached result data");
});

Deno.test("sends only pseudonymous score signals and only authorized Quran progress", async () => {
  const featureCalls: AnalysisFeatures[] = [];
  const handler = createSchoolTrackAnalysisHandler(dependencies({
    canViewQuranProgress: async () => true,
    listQuranProgress: async () => [{
      date: "2026-10-02",
      sessionType: "assessment",
      surahNumber: 2,
      ayahStart: 1,
      ayahEnd: 5,
      rating: 4,
      errorsCount: 1,
    }],
    analyze: async input => {
      featureCalls.push(input);
      return {
        summary: "ملخص تربوي.",
        strengths: [],
        focusAreas: [],
        actions: [],
        quranDataIncluded: false,
      };
    },
  }));
  const response = await handler(request());
  const result = await response.json();
  if (response.status !== 200 || result.quranDataIncluded !== true) {
    throw new Error("authorized analysis should include Quran progress metadata");
  }
  const features = featureCalls[0];
  if (!features) throw new Error("analysis features were not forwarded");
  if (!features?.quranProgress?.length || features.termAverages.length !== 3) {
    throw new Error("analysis signals are incomplete");
  }
  const serialized = JSON.stringify(features);
  if (serialized.includes(studentId) || serialized.includes(schoolId) || serialized.includes("profile-1") || serialized.includes("الرياضيات") || serialized.includes("subject")) {
    throw new Error("identifying IDs leaked into the provider payload");
  }
});

Deno.test("omits Quran signals when Quran permission is absent and handles empty data", async () => {
  let analyzeCalled = false;
  const handler = createSchoolTrackAnalysisHandler(dependencies({
    listTermAverages: async () => [],
    canViewQuranProgress: async () => false,
    listQuranProgress: async () => [{
      date: "2026-10-02",
      sessionType: "assessment",
      surahNumber: 2,
      ayahStart: 1,
      ayahEnd: 5,
      rating: 4,
      errorsCount: 1,
    }],
    analyze: async () => {
      analyzeCalled = true;
      throw new Error("should not run without visible data");
    },
  }));
  const response = await handler(request());
  const result = await response.json();
  if (response.status !== 200 || analyzeCalled || result.quranDataIncluded !== false) {
    throw new Error("unauthorized Quran data was included");
  }
});

Deno.test("limits repeated AI requests per authenticated profile", async () => {
  let time = 1_000;
  const handler = createSchoolTrackAnalysisHandler(dependencies({
    now: () => time,
    listTermAverages: async () => [],
  }));
  for (let index = 0; index < 5; index += 1) {
    const response = await handler(request());
    if (response.status !== 200) throw new Error("request quota rejected too early");
  }
  const limited = await handler(request());
  if (limited.status !== 429) throw new Error("request quota was not enforced");
  time += 60_001;
  const nextWindow = await handler(request());
  if (nextWindow.status !== 200) throw new Error("request quota did not reset");
});

Deno.test("returns a safe setup error when the AI provider key is missing", async () => {
  const handler = createSchoolTrackAnalysisHandler(dependencies({
    analyze: async () => {
      throw new Error("ai_not_configured");
    },
  }));
  const response = await handler(request());
  const result = await response.json();
  if (response.status !== 503 || result.error !== "ai_not_configured") {
    throw new Error("missing AI configuration was not reported safely");
  }
});

Deno.test("returns an English no-data message when requested in English", async () => {
  const handler = createSchoolTrackAnalysisHandler(dependencies({
    listTermAverages: async () => [],
  }));
  const response = await handler(request({ schoolId, studentId, locale: "en" }));
  const result = await response.json();
  if (response.status !== 200 || !String(result.summary).startsWith("There is not enough data")) {
    throw new Error("no-data analysis did not respect the requested locale");
  }
});
