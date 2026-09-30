export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function asStringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

export function analysisSummary(output: unknown) {
  const data = asRecord(output);
  const structuredSummary = asRecord(data.summary);
  const summaryParts = [
    structuredSummary.problem,
    structuredSummary.solution,
  ].filter(
    (item): item is string => typeof item === "string" && item.length > 0,
  );
  const rubricConfidence = Array.isArray(data.rubricAnalysis)
    ? data.rubricAnalysis
        .map((item) => asRecord(item).confidence)
        .filter((item): item is number => typeof item === "number")
    : [];
  return {
    summary:
      typeof data.summary === "string"
        ? data.summary
        : summaryParts.length
          ? summaryParts.join("\n\n")
          : typeof data.executiveSummary === "string"
            ? data.executiveSummary
            : "No verified summary is available yet.",
    strengths: asStringList(data.strengths),
    concerns: Array.isArray(data.concerns) ? data.concerns : [],
    questions: asStringList(data.judgeQuestions),
    confidence:
      typeof data.confidence === "number"
        ? data.confidence
        : typeof data.confidenceScore === "number"
          ? data.confidenceScore
          : rubricConfidence.length
            ? rubricConfidence.reduce((total, value) => total + value, 0) /
              rubricConfidence.length
            : null,
  };
}
