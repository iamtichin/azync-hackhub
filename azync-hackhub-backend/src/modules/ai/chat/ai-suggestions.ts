type SuggestionInput = {
  projectName: string;
  hackathonName: string;
  rules: unknown;
  rubric: unknown;
  analysis: unknown;
  evidence: Array<{ type: string; status: string; facts?: unknown }>;
};

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is Record<string, unknown> =>
          !!item && typeof item === 'object',
      )
    : [];
}

function evidenceLabel(item: SuggestionInput['evidence'][number]) {
  const facts =
    item.facts && typeof item.facts === 'object'
      ? (item.facts as Record<string, unknown>)
      : {};
  if (item.type === 'SOLANA_ACCOUNT') {
    return facts.evidenceRole === 'PARTICIPANT_PROJECT_CLAIM'
      ? 'team-provided Solana transaction'
      : 'cNFT credential asset';
  }
  if (item.type === 'DEMO_URL') return 'walkthrough/demo URL';
  if (item.type === 'GITHUB_TEST_SIGNAL') return 'test/CI signal';
  return item.type;
}

export function buildContextualSuggestions(input: SuggestionInput): string[] {
  const analysis =
    input.analysis && typeof input.analysis === 'object'
      ? (input.analysis as Record<string, unknown>)
      : {};
  const candidates: string[] = [];
  for (const question of Array.isArray(analysis.judgeQuestions)
    ? analysis.judgeQuestions
    : []) {
    if (typeof question === 'string') candidates.push(question);
  }
  for (const requirement of records(analysis.requirements)) {
    if (
      requirement.status === 'UNCERTAIN' &&
      typeof requirement.requirementId === 'string'
    ) {
      candidates.push(
        `What evidence is missing to verify requirement “${requirement.requirementId}” for ${input.projectName}?`,
      );
    }
  }
  for (const concern of records(analysis.concerns)) {
    if (typeof concern.description === 'string') {
      candidates.push(`Review this concern carefully: ${concern.description}`);
    }
  }
  const unavailable = input.evidence.find((item) => item.status !== 'VERIFIED');
  if (unavailable) {
    candidates.push(
      `How does the unverified ${evidenceLabel(unavailable)} affect the review of ${input.projectName}?`,
    );
  }
  if (input.evidence.some((item) => item.type === 'GITHUB_TEST_SIGNAL')) {
    candidates.push(
      `What do the test files, workflows, and CI results actually prove for ${input.projectName}?`,
    );
  }
  if (input.evidence.some((item) => item.type === 'SOLANA_TRANSACTION')) {
    candidates.push(
      `What does the Azync cNFT prove, and what does it not prove, about ${input.projectName}?`,
    );
  }
  const firstRubric = records(input.rubric)[0];
  const rubricName =
    typeof firstRubric?.name === 'string' ? firstRubric.name : 'current rubric';
  candidates.push(
    `Evaluate ${input.projectName} against the “${rubricName}” criterion for ${input.hackathonName}.`,
  );
  const firstRule = records(input.rules)[0];
  if (typeof firstRule?.name === 'string') {
    candidates.push(
      `Does ${input.projectName} satisfy rule “${firstRule.name}”, and what evidence supports that conclusion?`,
    );
  }
  return [
    ...new Set(candidates.map((item) => item.trim()).filter(Boolean)),
  ].slice(0, 6);
}

export function selectGhostSuggestion(candidates: string[], prefix: string) {
  const normalized = prefix.trimStart().toLocaleLowerCase('en');
  const suggestion =
    candidates.find((item) =>
      item.toLocaleLowerCase('en').startsWith(normalized),
    ) ?? (normalized.length === 0 ? candidates[0] : null);
  return {
    suggestion,
    completion: suggestion ? suggestion.slice(prefix.trimStart().length) : null,
  };
}
