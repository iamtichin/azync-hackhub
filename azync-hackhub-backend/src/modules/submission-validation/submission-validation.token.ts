export type RepositoryInspection = {
  accessible: boolean | 'unknown';
  readme: boolean | 'unknown';
  evidence: string;
};

export interface SubmissionRepositoryInspector {
  inspect(input: { repository: any | null; githubUrl: string | null }): Promise<RepositoryInspection>;
}

export const SUBMISSION_REPOSITORY_INSPECTOR = Symbol('SUBMISSION_REPOSITORY_INSPECTOR');

export interface SubmissionAdvisoryProvider {
  advise(input: { projectName: string | null; description: string | null }): Promise<string>;
}

export const SUBMISSION_ADVISORY_PROVIDER = Symbol('SUBMISSION_ADVISORY_PROVIDER');
