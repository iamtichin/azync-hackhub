type EvidenceInput = {
  id: string;
  type: string;
  status: string;
  reference: string;
  sourceRevision?: string | null;
  facts: unknown;
};

type FallbackInput = {
  question: string;
  projectName: string;
  rubric: unknown;
  evidence: EvidenceInput[];
};

type ResponseLanguage = 'en' | 'vi';

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function normalized(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function responseLanguage(question: string): ResponseLanguage {
  if (/[À-ỹĐđ]/.test(question)) return 'vi';
  const query = normalized(question);
  return /(danh gia|bang chung|chung minh|so sanh|du an|doi thi|chat luong|kiem thu|trien khai|the nao|tai sao|khong|nhung gi)/.test(
    query,
  )
    ? 'vi'
    : 'en';
}

function evidenceOf(input: EvidenceInput[], type: string) {
  return input.filter((item) => item.type === type);
}

function addSelected(target: EvidenceInput[], items: EvidenceInput[]) {
  for (const item of items) {
    if (!target.some((candidate) => candidate.id === item.id)) {
      target.push(item);
    }
  }
}

function sourceFinding(item: EvidenceInput, language: ResponseLanguage) {
  const facts = record(item.facts);
  const commit =
    typeof facts.commitSha === 'string' ? facts.commitSha : item.sourceRevision;
  const entries =
    typeof facts.treeEntryCount === 'number' ? facts.treeEntryCount : null;
  return language === 'vi'
    ? `Repository được ghi nhận tại commit ${commit ?? 'không rõ'}${entries === null ? '' : ` với ${entries} mục trong cây mã nguồn`}. Trạng thái thu thập: ${item.status}.`
    : `The repository was captured at commit ${commit ?? 'unknown'}${entries === null ? '' : ` with ${entries} source-tree entries`}. Collector status: ${item.status}.`;
}

function testFinding(item: EvidenceInput, language: ResponseLanguage) {
  const facts = record(item.facts);
  const execution =
    typeof facts.executionStatus === 'string'
      ? facts.executionStatus
      : 'UNKNOWN';
  const tests = Array.isArray(facts.testFilePaths)
    ? facts.testFilePaths.length
    : 0;
  const workflows = Array.isArray(facts.workflowPaths)
    ? facts.workflowPaths.length
    : 0;
  return language === 'vi'
    ? `Repository có ${tests} tệp kiểm thử và ${workflows} workflow được phát hiện; tín hiệu thực thi là ${execution}. Việc có tệp kiểm thử không chứng minh CI đã chạy thành công.`
    : `The repository contains ${tests} detected test file${tests === 1 ? '' : 's'} and ${workflows} workflow${workflows === 1 ? '' : 's'}; the execution signal is ${execution}. The presence of test files does not prove that CI ran successfully.`;
}

function demoFinding(item: EvidenceInput, language: ResponseLanguage) {
  const facts = record(item.facts);
  const code =
    typeof facts.statusCode === 'number'
      ? `HTTP ${facts.statusCode}`
      : language === 'vi'
        ? 'không có mã HTTP'
        : 'no HTTP status';
  const reachable =
    facts.reachable === true
      ? language === 'vi'
        ? 'có thể truy cập'
        : 'reachable'
      : language === 'vi'
        ? 'chưa xác lập được khả năng truy cập'
        : 'reachability not established';
  return language === 'vi'
    ? `Bộ thu thập đã kiểm tra URL walkthrough/demo: ${code}, ${reachable}. Kết quả này không chứng minh ứng dụng đã được triển khai hoặc đang chạy.`
    : `The collector checked the walkthrough/demo URL: ${code}, ${reachable}. This does not prove that the application was deployed or is running.`;
}

function solanaFinding(items: EvidenceInput[], language: ResponseLanguage) {
  const transaction = items.find((item) => item.type === 'SOLANA_TRANSACTION');
  const participant = items.find((item) => {
    const role = record(item.facts).evidenceRole;
    return role === 'PARTICIPANT_PROJECT_CLAIM';
  });
  const lines: string[] = [];
  if (transaction) {
    const facts = record(transaction.facts);
    const cluster =
      typeof facts.cluster === 'string'
        ? facts.cluster
        : language === 'vi'
          ? 'cluster không rõ'
          : 'unknown cluster';
    const slot =
      typeof facts.slot === 'number'
        ? language === 'vi'
          ? ` tại slot ${facts.slot}`
          : ` at slot ${facts.slot}`
        : '';
    const succeeded = facts.succeeded === true && facts.finalized === true;
    if (language === 'vi') {
      lines.push(
        `Chứng nhận do Azync tạo trên ${cluster} ${succeeded ? 'đã được xác nhận thành công' : 'chưa được xác nhận hoàn tất'}${slot}. Nó chứng minh receipt của Azync; supportsProjectIntegration=${String(facts.supportsProjectIntegration ?? false)}, nên không chứng minh hành vi runtime hoặc tích hợp Solana do project sở hữu.`,
      );
    } else {
      lines.push(
        `The credential created by Azync on ${cluster} ${succeeded ? 'was finalized successfully' : 'has not been confirmed as complete'}${slot}. It proves the Azync receipt; supportsProjectIntegration=${String(facts.supportsProjectIntegration ?? false)}, so it does not prove project runtime behavior or project-owned Solana integration.`,
      );
    }
  }
  if (participant) {
    lines.push(
      language === 'vi'
        ? `URL Solana do đội cung cấp có trạng thái ${participant.status}; đây vẫn là claim của đội cho đến khi bộ xác minh dành riêng cho project xác nhận.`
        : `The team-provided Solana URL has status ${participant.status}; it remains a participant claim until a project-specific verifier confirms it.`,
    );
  }
  return lines;
}

export function buildEvidenceFallback(input: FallbackInput) {
  const query = normalized(input.question);
  const language = responseLanguage(input.question);
  const selected: EvidenceInput[] = [];
  const findings: string[] = [];
  const wantsComparison =
    /(compare|comparison|2 teams|two teams|other team|so sanh|hai doi|2 doi)/.test(
      query,
    );
  if (wantsComparison) {
    return {
      answer:
        language === 'vi'
          ? `Phiên này chỉ có ngữ cảnh của “${input.projectName}”, nên chưa thể so sánh hai đội. Hãy mở riêng từng submission hoặc dùng màn hình so sánh được cấp quyền đọc cả hai submission.`
          : `This session contains context only for “${input.projectName}”, so it cannot compare two teams. Open each submission separately or use a comparison view authorized to read both submissions.`,
      evidenceIds: [],
      uncertainty:
        language === 'vi'
          ? 'Phiên này không có bằng chứng của submission thứ hai.'
          : 'No evidence for a second submission is available in this session.',
    };
  }

  const wantsSolana =
    /(solana|wallet|wallet address|cnft|nft|recipient|blockchain|proof|dia chi vi|bang chung chuoi)/.test(
      query,
    );
  const wantsCi = /(ci|test|workflow|build|action|kiem thu)/.test(query);
  const wantsDemo =
    /(demo|walkthrough|deploy|runtime|run|404|trien khai|chay)/.test(query);
  const wantsSource =
    /(repo|source|code|commit|github|architecture|technical|rubric|criterion|ma nguon|kien truc|ky thuat|tieu chi)/.test(
      query,
    );
  const broad = !wantsSolana && !wantsCi && !wantsDemo && !wantsSource;

  if (wantsSource || broad) {
    const repository = evidenceOf(input.evidence, 'GITHUB_REPOSITORY').slice(
      0,
      1,
    );
    addSelected(selected, repository);
    if (repository[0]) findings.push(sourceFinding(repository[0], language));
  }
  if (wantsCi || wantsSource || broad) {
    const tests = evidenceOf(input.evidence, 'GITHUB_TEST_SIGNAL').slice(0, 1);
    addSelected(selected, tests);
    if (tests[0]) findings.push(testFinding(tests[0], language));
  }
  if (wantsDemo || wantsSource || broad) {
    const demos = evidenceOf(input.evidence, 'DEMO_URL').slice(0, 1);
    addSelected(selected, demos);
    if (demos[0]) findings.push(demoFinding(demos[0], language));
  }
  if (wantsSolana || broad) {
    const solana = input.evidence.filter((item) =>
      item.type.startsWith('SOLANA_'),
    );
    addSelected(selected, solana);
    findings.push(...solanaFinding(solana, language));
  }

  if (findings.length === 0) {
    findings.push(
      language === 'vi'
        ? 'Snapshot hiện tại không có bằng chứng liên quan trực tiếp đến câu hỏi này.'
        : 'The current snapshot contains no evidence directly relevant to this question.',
    );
  }
  const rubric = Array.isArray(input.rubric)
    ? input.rubric
        .map((item) => record(item).name)
        .filter((name): name is string => typeof name === 'string')
    : [];
  const rubricLine = rubric.length
    ? language === 'vi'
      ? `\n\nGiám khảo cần áp dụng các tiêu chí rubric sau: ${rubric.join(', ')}.`
      : `\n\nThe judge must apply these rubric criteria: ${rubric.join(', ')}.`
    : '';
  const answer =
    language === 'vi'
      ? `Bằng chứng có trong snapshot này:\n\n${findings.map((item) => `• ${item}`).join('\n')}\n\nCâu hỏi dành cho đội: phần nào đã chạy end-to-end, bằng chứng thực thi nằm ở đâu, và giới hạn nào chưa được chứng minh?${rubricLine}`
      : `Evidence available in this snapshot:\n\n${findings.map((item) => `• ${item}`).join('\n')}\n\nQuestions for the team: which parts ran end to end, where is the execution evidence, and which limits were not demonstrated?${rubricLine}`;
  const hasGap =
    selected.some((item) => item.status !== 'VERIFIED') ||
    findings.some((item) => item.includes('NOT_RUN') || item.includes('404'));
  return {
    answer,
    evidenceIds: selected.map((item) => item.id),
    uncertainty: hasGap
      ? language === 'vi'
        ? 'Một số bằng chứng chưa được xác minh hoặc chưa xác lập việc thực thi; không suy ra điểm số hay trạng thái runtime từ đó.'
        : 'Some evidence is unverified or does not establish execution; do not infer a score or runtime status from it.'
      : language === 'vi'
        ? 'Đây là đối chiếu cục bộ tất định khi nhà cung cấp AI không sẵn sàng; giám khảo vẫn cần xem nguồn trước khi kết luận.'
        : 'This is a deterministic local cross-check used while the AI provider is unavailable; the judge should still inspect the source before concluding.',
  };
}
