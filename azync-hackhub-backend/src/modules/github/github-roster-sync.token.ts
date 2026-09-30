export const GITHUB_ROSTER_SYNC = Symbol('GITHUB_ROSTER_SYNC');

export interface GithubRosterSync {
  syncTeamCollaborators(teamId: string): Promise<unknown>;
}
