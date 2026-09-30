export type JsonRecord = Record<string, unknown>;

export interface User {
  id: string;
  name: string | null;
  githubUsername: string;
  avatarUrl: string | null;
  university?: string | null;
  skills?: string[];
  email?: string | null;
}

export interface HackathonRule {
  id: string;
  name: string;
  description: string;
}

export interface RubricCriterion extends HackathonRule {
  weight: number;
  minScore: number;
  maxScore: number;
}

export interface Hackathon {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  rules: HackathonRule[];
  rubric: RubricCriterion[];
  rulesVersion: string;
  rubricVersion: string;
  organizerId?: string | null;
  description?: string | null;
  coverUrl?: string | null;
  isPublished?: boolean;
  tracks?: Track[];
  registrations?: Array<{
    id: string;
    teamId: string;
    registeredAt: string;
    team: Team;
  }>;
  submissions?: Submission[];
  _count?: { registrations: number; submissions: number };
}

export interface Track {
  id: string;
  hackathonId: string;
  name: string;
  description?: string | null;
  isActive: boolean;
}

export interface Team {
  id: string;
  name: string;
  hackathonId: string;
  role?: string;
  walletAddress?: string | null;
  members?: TeamMember[];
  repository?: GitHubRepository | null;
  registrations?: Array<{
    id: string;
    hackathonId: string;
    registeredAt: string;
  }>;
  areas?: PlanningArea[];
  tasks?: PlanningTask[];
  _count?: { submissions: number };
  submissions?: Array<{ id: string; projectName: string; status: string }>;
}

export interface TeamMember {
  id?: string;
  userId: string;
  teamId?: string;
  role: "admin" | "member" | string;
  user: User;
}

export interface GitHubRepository {
  id: string;
  teamId: string;
  fullName: string;
  url: string;
  webhookConfigured: boolean;
  webhookError?: string | null;
  provisioningStatus?: string;
  provisioningError?: string | null;
  collaborators?: Array<{
    username: string;
    permission: "pull" | "push" | string;
    status: "active" | "invited" | "failed" | string;
    error?: string;
  }>;
  isPrivate?: boolean;
  lastWebhookAt?: string | null;
  lastPushAt?: string | null;
  lastCommitSha?: string | null;
  lastPullRequestAt?: string | null;
  lastWorkflowRunAt?: string | null;
  lastWorkflowStatus?: string | null;
  lastWorkflowConclusion?: string | null;
  workflowRuns?: Array<{
    runId: string;
    headSha: string;
    status: string;
    conclusion: string | null;
  }>;
}

export interface PlanningArea {
  id: string;
  teamId: string;
  name: string;
  color: string;
  estimatedHours?: number | null;
  displayOrder?: number;
  tasks?: PlanningTask[];
  _count?: { tasks: number };
}

export type TaskStatus =
  "backlog" | "todo" | "in_progress" | "blocked" | "done";
export type TaskPriority = "high" | "medium" | "low";

export interface TaskDependency {
  taskId: string;
  dependsOnId: string;
  dependsOn?: PlanningTask;
}

export interface PlanningTask {
  id: string;
  teamId: string;
  areaId?: string | null;
  title: string;
  description?: string | null;
  estimatedHours: number;
  actualHours?: number | null;
  status: TaskStatus;
  priority: TaskPriority;
  assigneeId?: string | null;
  isCriticalPath?: boolean;
  area?: PlanningArea | null;
  assignee?: User | null;
  dependencies?: TaskDependency[];
}

export interface CriticalPath {
  criticalPath: string[];
  totalHours: number;
  tasks: Array<
    PlanningTask & { areaName?: string | null; dependencies: string[] }
  >;
}

export interface PlanningForecast {
  calculatedAt: string;
  unit: string;
  status:
    "no_tasks" | "not_started" | "zero_velocity" | "forecasted" | "complete";
  risk: "unknown" | "on_track" | "at_risk" | "overdue" | "complete";
  projectedFinishAt: string | null;
  deadline: string | null;
  observation: {
    days: number;
    completedTaskCount: number;
    completedHours: number;
    velocityHoursPerDay: number | null;
  };
  remaining: {
    taskHours: number;
    criticalPathHours: number;
    effectiveHours: number;
  };
  assumptions: string[];
}

export interface PlanningSnapshot {
  areas: PlanningArea[];
  tasks: PlanningTask[];
}

export interface TeamActivity {
  id: string;
  teamId: string;
  actorId: string;
  action: string;
  subjectType?: string | null;
  subjectId?: string | null;
  metadata?: JsonRecord | null;
  createdAt: string;
  actor: Pick<User, "id" | "name" | "githubUsername" | "avatarUrl">;
}

export interface JudgeAssignment {
  id?: string;
  hackathonId: string;
  userId: string;
  assignedAt?: string;
  user: User;
}

export interface LeaderboardEntry {
  rank: number;
  teamId: string;
  teamName: string;
  metrics: { taskCompletionPercent: number };
  progress: {
    totalTasks: number;
    completedTasks: number;
    inProgressTasks: number;
    todoTasks: number;
    blockedTasks: number;
    backlogTasks: number;
  };
  ci: {
    status: "passed" | "failed" | "running" | "unknown";
    testStatus: string;
    coverageStatus: string;
    commitSha: string | null;
    runId: string | null;
    runAttempt: number | null;
    updatedAt: string | null;
    trustLimitations: string[];
  };
  lastUpdated: string;
}

export interface Leaderboard {
  hackathonId: string;
  hackathonName: string;
  definition: {
    rankingMetric: "task_completion_percent";
    formula: string;
    tiePolicy: string;
    officialScore: false;
    ciMeaning: string;
  };
  leaderboard: LeaderboardEntry[];
  lastUpdated: string;
}

export interface AnalysisRecord {
  id: string;
  output: unknown;
  createdAt: string;
  resolvedModel?: string | null;
  validationReport?: unknown;
}

export interface Submission {
  id: string;
  teamId: string;
  hackathonId: string;
  projectName: string;
  description: string;
  githubUrl: string;
  demoUrl: string;
  videoUrl?: string | null;
  slidesUrl?: string | null;
  participantBlockchainEvidenceUrl?: string | null;
  walletAddress: string;
  status: string;
  receivedStatus?: string;
  mintStatus?: string;
  aiStatus?: string;
  transactionSignature?: string | null;
  nftAssetId?: string | null;
  explorerUrl?: string | null;
  solanaTransaction?: {
    network?: string | null;
    status?: string | null;
  } | null;
  createdAt: string;
  team?: Team;
  hackathon?: Hackathon;
  aiAnalysis?: AnalysisRecord | null;
  aiAnalyses?: AnalysisRecord[];
}

export interface AiAnalysisStatus {
  jobId?: string;
  status: string;
  completed: boolean;
  attempts?: number;
  maxAttempts?: number;
  completedAt?: string | null;
  error?: { code?: string; message?: string } | null;
  results?: {
    id: string;
    output: unknown;
    resolvedModel?: string | null;
    validationReport?: unknown;
    createdAt: string;
  } | null;
}

export interface ChatSession {
  id: string;
  title: string | null;
  submissionId: string;
  contextVersion: number;
  status: string;
  createdAt: string;
  updatedAt: string;
  _count?: { messages: number };
}

export interface EvidenceLink {
  evidence?: {
    id: string;
    type: string;
    status: string;
    reference?: string | null;
  };
}

export interface ChatMessage {
  id: string;
  role: "USER" | "ASSISTANT";
  content: string;
  contextVersion: number;
  createdAt: string;
  model?: string | null;
  latencyMs?: number | null;
  evidenceLinks?: EvidenceLink[];
}

export interface GhostSuggestions {
  suggestion: string | null;
  completion: string | null;
  candidates: string[];
  contextVersion: number;
}

export interface ChatResponse {
  status: "completed" | "partial";
  userMessage: ChatMessage;
  assistantMessage: ChatMessage | null;
  answer: string | null;
  evidenceIds: string[];
  uncertainty: string | null;
  contextVersion: number;
  contextAdvanced: boolean;
  error?: { code: string; message: string; retryable: boolean };
}

export interface AzyncBotMessage {
  id: string;
  role: "USER" | "ASSISTANT";
  content: string;
}

export interface AzyncBotResponse {
  status: "completed" | "partial";
  answer: string | null;
  relatedRoutes: string[];
  suggestedQuestions: string[];
  error?: { code: string; message: string; retryable: boolean };
}

export interface CreateSubmissionPayload {
  teamId: string;
  hackathonId: string;
  trackId?: string;
  projectName: string;
  description: string;
  githubUrl?: string;
  demoUrl: string;
  videoUrl?: string;
  slidesUrl: string;
  participantBlockchainEvidenceUrl: string;
  walletAddress: string;
}

export interface SubmissionDraftPayload {
  teamId: string;
  hackathonId: string;
  trackId?: string;
  projectName?: string;
  description?: string;
  githubUrl?: string;
  demoUrl?: string;
  videoUrl?: string;
  slidesUrl?: string;
  participantBlockchainEvidenceUrl?: string;
}

export interface SubmissionDraft {
  id?: string;
  teamId: string;
  hackathonId: string;
  payload: SubmissionDraftPayload;
  updatedAt?: string;
}

export interface OrganizerSubmissionRow {
  id: string;
  projectName: string;
  createdAt: string;
  status: string;
  receivedStatus: string;
  aiStatus: string;
  mintStatus: string;
  team: { id: string; name: string };
  track: { id: string; name: string } | null;
  githubUrl?: string;
  demoUrl?: string;
  participantBlockchainEvidenceUrl?: string;
  transactionSignature?: string;
  nftAssetId?: string;
  isWinner?: boolean;
}
export interface WinnerAward {
  id: string;
  hackathonId: string;
  submissionId: string;
  status: string;
  selectedAt: string;
  confirmedAt?: string | null;
  recipientAddress: string;
  signature?: string | null;
  nftAssetId?: string | null;
  credentialHash?: string | null;
  metadataUri?: string | null;
  network: string;
  leafIndex?: string | null;
  explorerUrl?: string | null;
  verifyPath: string;
  projectName?: string | null;
  team?: { id: string; name: string } | null;
  errorMessage?: string | null;
  mintError?: string;
}
export interface OrganizerSubmissionPage {
  items: OrganizerSubmissionRow[];
  nextCursor: string | null;
  limit: number;
  winner: WinnerAward | null;
}
