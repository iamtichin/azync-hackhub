import axios, { AxiosError } from "axios";
import type {
  AiAnalysisStatus,
  AzyncBotResponse,
  ChatMessage,
  ChatResponse,
  ChatSession,
  CreateSubmissionPayload,
  GhostSuggestions,
  Hackathon,
  HackathonRule,
  RubricCriterion,
  JudgeAssignment,
  Leaderboard,
  PlanningArea,
  PlanningSnapshot,
  PlanningTask,
  PlanningForecast,
  CriticalPath,
  TaskPriority,
  TaskStatus,
  TeamMember,
  GitHubRepository,
  Submission,
  SubmissionDraft,
  SubmissionDraftPayload,
  Team,
  Track,
  OrganizerSubmissionPage,
  WinnerAward,
  TeamActivity,
  User,
} from "./types";

export const API_URL = (
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001"
).replace(/\/$/, "");

const client = axios.create({
  baseURL: API_URL,
  headers: { "Content-Type": "application/json" },
  timeout: 30_000,
});

// Judge chat can make one bounded provider-repair attempt. This local budget
// lets the browser receive a typed partial response rather than aborting at
// the general 30-second API timeout.
const JUDGE_CHAT_SEND_TIMEOUT_MS = 250_000;

export type HackathonPayload = {
  name: string;
  startDate: string;
  endDate: string;
  description?: string;
  coverUrl?: string;
  isPublished?: boolean;
  rules?: HackathonRule[];
  rubric?: RubricCriterion[];
};

export type TeamPayload = {
  name: string;
  hackathonId: string;
  walletAddress?: string;
};
export type TaskPayload = {
  title: string;
  description?: string;
  areaId?: string;
  estimatedHours?: number;
  actualHours?: number;
  priority?: TaskPriority;
  status?: TaskStatus;
  assigneeId?: string | null;
};

client.interceptors.request.use((config) => {
  if (typeof window !== "undefined") {
    const token = window.sessionStorage.getItem("azync.access_token");
    if (token && !config.headers.Authorization) {
      config.headers.Authorization = `Bearer ${token}`;
    }
  }
  return config;
});

function bearerConfig(token?: string) {
  return token ? { headers: { Authorization: `Bearer ${token}` } } : undefined;
}

export function apiErrorMessage(error: unknown): string {
  if (error instanceof AxiosError) {
    const message = error.response?.data?.message;
    if (Array.isArray(message)) return message.join(". ");
    if (typeof message === "string") return message;
    if (!error.response)
      return "Could not reach the backend. Check the server on port 3001.";
  }
  return error instanceof Error ? error.message : "An unknown error occurred.";
}

export const api = {
  auth: {
    me: (token?: string) =>
      client.get<User>("/auth/me", bearerConfig(token)).then((r) => r.data),
    logout: (token?: string) =>
      client
        .post<{ message: string }>(
          "/auth/logout",
          undefined,
          bearerConfig(token),
        )
        .then((r) => r.data),
    githubUrl: `${API_URL}/auth/github`,
  },
  hackathons: {
    list: (includeEnded = false) =>
      client
        .get<Hackathon[]>("/hackathons", { params: { includeEnded } })
        .then((r) => r.data),
    mine: () => client.get<Hackathon[]>("/hackathons/mine").then((r) => r.data),
    get: (id: string) =>
      client.get<Hackathon>(`/hackathons/${id}`).then((r) => r.data),
    create: (payload: HackathonPayload) =>
      client.post<Hackathon>("/hackathons", payload).then((r) => r.data),
    update: (id: string, payload: Partial<HackathonPayload>) =>
      client.patch<Hackathon>(`/hackathons/${id}`, payload).then((r) => r.data),
    remove: (id: string) =>
      client.delete<Hackathon>(`/hackathons/${id}`).then((r) => r.data),
    register: (id: string, teamId: string, trackId?: string) =>
      client
        .post(`/hackathons/${id}/register`, { teamId, trackId })
        .then((r) => r.data),
    tracks: (id: string) =>
      client.get<Track[]>(`/hackathons/${id}/tracks`).then((r) => r.data),
    createTrack: (
      id: string,
      payload: { name: string; description?: string },
    ) =>
      client
        .post<Track>(`/hackathons/${id}/tracks`, payload)
        .then((r) => r.data),
    updateTrack: (
      id: string,
      trackId: string,
      payload: Partial<{
        name: string;
        description: string;
        isActive: boolean;
      }>,
    ) =>
      client
        .patch<Track>(`/hackathons/${id}/tracks/${trackId}`, payload)
        .then((r) => r.data),
    teams: (id: string) =>
      client.get<Team[]>(`/hackathons/${id}/teams`).then((r) => r.data),
    submissions: (id: string) =>
      client
        .get<Submission[]>(`/hackathons/${id}/submissions`)
        .then((r) => r.data),
    organizerSubmissions: (
      id: string,
      query: {
        cursor?: string;
        limit?: number;
        search?: string;
        trackId?: string;
        status?: string;
      },
    ) =>
      client
        .get<OrganizerSubmissionPage>(
          `/hackathons/${id}/organizer-submissions`,
          { params: query },
        )
        .then((r) => r.data),
    organizerSubmissionsCsv: (
      id: string,
      query: { search?: string; trackId?: string; status?: string },
    ) =>
      client
        .get(`/hackathons/${id}/organizer-submissions.csv`, {
          params: query,
          responseType: "text",
        })
        .then((r) => r.data),
    selectWinner: (id: string, submissionId: string) =>
      client
        .post<WinnerAward>(`/hackathons/${id}/winner`, { submissionId })
        .then((r) => r.data),
    retryWinnerCertificate: (id: string) =>
      client
        .post<WinnerAward>(`/hackathons/${id}/winner/retry-certificate`)
        .then((r) => r.data),
    leaderboard: (id: string) =>
      client
        .get<Leaderboard>(`/hackathons/${id}/leaderboard`)
        .then((r) => r.data),
    judges: (id: string) =>
      client
        .get<JudgeAssignment[]>(`/hackathons/${id}/judges`)
        .then((r) => r.data),
    assignJudge: (id: string, userId: string) =>
      client
        .post<JudgeAssignment>(`/hackathons/${id}/judges`, { userId })
        .then((r) => r.data),
    removeJudge: (id: string, userId: string) =>
      client.delete(`/hackathons/${id}/judges/${userId}`).then((r) => r.data),
  },
  teams: {
    mine: () => client.get<Team[]>("/users/me/teams").then((r) => r.data),
    list: (hackathonId?: string) =>
      client
        .get<Team[]>("/teams", {
          params: hackathonId ? { hackathonId } : undefined,
        })
        .then((r) => r.data),
    get: (id: string) => client.get<Team>(`/teams/${id}`).then((r) => r.data),
    create: (payload: TeamPayload) =>
      client.post<Team>("/teams", payload).then((r) => r.data),
    update: (id: string, payload: Partial<Omit<TeamPayload, "hackathonId">>) =>
      client.patch<Team>(`/teams/${id}`, payload).then((r) => r.data),
    remove: (id: string) =>
      client.delete<Team>(`/teams/${id}`).then((r) => r.data),
    members: (id: string) =>
      client.get<TeamMember[]>(`/teams/${id}/members`).then((r) => r.data),
    addMember: (id: string, userId: string, role: "admin" | "member") =>
      client
        .post<TeamMember>(`/teams/${id}/members`, { userId, role })
        .then((r) => r.data),
    removeMember: (id: string, userId: string) =>
      client.delete(`/teams/${id}/members/${userId}`).then((r) => r.data),
    createInvite: (id: string, expiresInHours = 24) =>
      client
        .post<{
          id: string;
          code: string;
          expiresAt: string;
          joinPath: string;
        }>(`/teams/${id}/invites`, { expiresInHours })
        .then((r) => r.data),
    revokeInvite: (id: string, inviteId: string) =>
      client.delete(`/teams/${id}/invites/${inviteId}`).then((r) => r.data),
    joinInvite: (code: string) =>
      client
        .post<{ teamId: string; registrationRequired: boolean }>(
          `/teams/invites/${code}/join`,
        )
        .then((r) => r.data),
    invites: (id: string) =>
      client
        .get<Array<{ id: string; code: string; expiresAt: string }>>(
          `/teams/${id}/invites`,
        )
        .then((r) => r.data),
  },
  users: {
    me: () => client.get<User>("/users/me").then((r) => r.data),
    updateMe: (payload: { university?: string; skills?: string[] }) =>
      client.patch<User>("/users/me", payload).then((r) => r.data),
    teams: () => client.get<Team[]>("/users/me/teams").then((r) => r.data),
    get: (id: string) => client.get<User>(`/users/${id}`).then((r) => r.data),
    userTeams: (id: string) =>
      client.get<Team[]>(`/users/${id}/teams`).then((r) => r.data),
  },
  planning: {
    activity: (teamId: string, after?: string) =>
      client
        .get<{ items: TeamActivity[]; nextCursor: string | null }>(
          `/teams/${teamId}/planning/activity`,
          {
            params: after ? { after } : undefined,
          },
        )
        .then((r) => r.data),
    areas: (teamId: string) =>
      client
        .get<PlanningArea[]>(`/teams/${teamId}/planning/areas`)
        .then((r) => r.data),
    createArea: (
      teamId: string,
      payload: {
        name: string;
        color: string;
        estimatedHours?: number;
        displayOrder?: number;
      },
    ) =>
      client
        .post<PlanningArea>(`/teams/${teamId}/planning/areas`, payload)
        .then((r) => r.data),
    updateArea: (
      teamId: string,
      areaId: string,
      payload: Partial<{
        name: string;
        color: string;
        estimatedHours: number;
        displayOrder: number;
      }>,
    ) =>
      client
        .patch<PlanningArea>(
          `/teams/${teamId}/planning/areas/${areaId}`,
          payload,
        )
        .then((r) => r.data),
    removeArea: (teamId: string, areaId: string) =>
      client
        .delete(`/teams/${teamId}/planning/areas/${areaId}`)
        .then((r) => r.data),
    tasks: (
      teamId: string,
      filters?: { status?: string; areaId?: string; assigneeId?: string },
    ) =>
      client
        .get<PlanningTask[]>(`/teams/${teamId}/planning/tasks`, {
          params: filters,
        })
        .then((r) => r.data),
    task: (teamId: string, taskId: string) =>
      client
        .get<PlanningTask>(`/teams/${teamId}/planning/tasks/${taskId}`)
        .then((r) => r.data),
    createTask: (teamId: string, payload: TaskPayload) =>
      client
        .post<PlanningTask>(`/teams/${teamId}/planning/tasks`, payload)
        .then((r) => r.data),
    updateTask: (
      teamId: string,
      taskId: string,
      payload: Partial<TaskPayload>,
    ) =>
      client
        .patch<PlanningTask>(
          `/teams/${teamId}/planning/tasks/${taskId}`,
          payload,
        )
        .then((r) => r.data),
    removeTask: (teamId: string, taskId: string) =>
      client
        .delete(`/teams/${teamId}/planning/tasks/${taskId}`)
        .then((r) => r.data),
    addDependency: (teamId: string, taskId: string, dependsOnId: string) =>
      client
        .post(`/teams/${teamId}/planning/tasks/${taskId}/dependencies`, {
          dependsOnId,
        })
        .then((r) => r.data),
    removeDependency: (teamId: string, taskId: string, dependsOnId: string) =>
      client
        .delete(
          `/teams/${teamId}/planning/tasks/${taskId}/dependencies/${dependsOnId}`,
        )
        .then((r) => r.data),
    criticalPath: (teamId: string) =>
      client
        .get<CriticalPath>(`/teams/${teamId}/planning/critical-path`)
        .then((r) => r.data),
    forecast: (teamId: string) =>
      client
        .get<PlanningForecast>(`/teams/${teamId}/planning/forecast`)
        .then((r) => r.data),
    applyTemplate: (teamId: string, templateId: "web3" | "ai" | "fullstack") =>
      client
        .post<PlanningSnapshot>(`/teams/${teamId}/planning/templates`, {
          templateId,
        })
        .then((r) => r.data),
  },
  github: {
    createRepository: (teamId: string, description: string, topics: string[]) =>
      client
        .post<{
          repository: GitHubRepository;
          githubData: { url: string; cloneUrl: string; sshUrl: string };
          webhook: { status: string; error: string | null };
        }>("/github/create-repo", { teamId, description, topics })
        .then((r) => r.data),
    addCollaborator: (
      teamId: string,
      username: string,
      permission: "pull" | "push",
    ) =>
      client
        .post<{ message: string }>(`/github/${teamId}/add-collaborator`, {
          username,
          permission,
        })
        .then((r) => r.data),
    syncCollaborators: (teamId: string) =>
      client
        .post<{ status: string; repository: GitHubRepository }>(
          `/github/${teamId}/sync-collaborators`,
        )
        .then((r) => r.data),
    setupWebhook: (teamId: string) =>
      client
        .post<{ status: string; repository: GitHubRepository }>(
          `/github/${teamId}/setup-webhook`,
        )
        .then((r) => r.data),
  },
  submissions: {
    create: (payload: CreateSubmissionPayload) =>
      client.post<Submission>("/submissions", payload).then((r) => r.data),
    saveDraft: (payload: SubmissionDraftPayload) =>
      client
        .post<SubmissionDraft>("/submissions/draft", payload)
        .then((r) => r.data),
    draft: (teamId: string, hackathonId: string) =>
      client
        .get<SubmissionDraft>("/submissions/draft", {
          params: { teamId, hackathonId },
        })
        .then((r) => r.data),
    get: (id: string) =>
      client.get<Submission>(`/submissions/${id}`).then((r) => r.data),
    retryMint: (id: string) =>
      client
        .post<Submission>(`/submissions/${id}/retry-mint`)
        .then((r) => r.data),
    analysis: (id: string) =>
      client
        .get<AiAnalysisStatus>(`/submissions/${id}/ai-analysis`)
        .then((r) => r.data),
    refreshAnalysis: (id: string) =>
      client
        .post<{ submissionId: string; status: string; aiJobId: string | null }>(
          `/submissions/${id}/ai-analysis/refresh`,
        )
        .then((r) => r.data),
  },
  solana: {
    health: () =>
      client.get("/solana/health", { timeout: 5_000 }).then((r) => r.data),
  },
  chat: {
    sessions: (submissionId: string) =>
      client
        .get<ChatSession[]>(`/submissions/${submissionId}/ai-chat/sessions`)
        .then((r) => r.data),
    createSession: (submissionId: string, title?: string) =>
      client
        .post<ChatSession>(`/submissions/${submissionId}/ai-chat/sessions`, {
          title,
        })
        .then((r) => r.data),
    messages: (submissionId: string, sessionId: string) =>
      client
        .get<ChatMessage[]>(
          `/submissions/${submissionId}/ai-chat/sessions/${sessionId}/messages`,
        )
        .then((r) => r.data),
    suggestions: (submissionId: string, prefix: string) =>
      client
        .get<GhostSuggestions>(
          `/submissions/${submissionId}/ai-chat/suggestions`,
          {
            params: { prefix },
          },
        )
        .then((r) => r.data),
    send: (submissionId: string, sessionId: string, content: string) =>
      client
        .post<ChatResponse>(
          `/submissions/${submissionId}/ai-chat/sessions/${sessionId}/messages`,
          { content },
          { timeout: JUDGE_CHAT_SEND_TIMEOUT_MS },
        )
        .then((r) => r.data),
  },
  bot: {
    suggestions: () =>
      client
        .get<{ suggestions: string[] }>("/ai-bot/suggestions")
        .then((r) => r.data),
    ask: (
      content: string,
      recentMessages: Array<{ role: "USER" | "ASSISTANT"; content: string }>,
    ) =>
      client
        .post<AzyncBotResponse>("/ai-bot/messages", {
          content,
          recentMessages,
        })
        .then((r) => r.data),
  },
};
