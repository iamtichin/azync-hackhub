import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  ArtifactDraft,
  EvidenceDraft,
  GitHubCollectionResult,
  RepositoryPromptData,
} from './evidence.types';
import { sha256, unavailableEvidence } from './evidence.utils';

const EMPTY_REPOSITORY_DATA: RepositoryPromptData = {
  readme: null,
  packageManifest: null,
  selectedSourceExcerpts: [],
};

const SOURCE_FILE_PATTERN =
  /\.(?:ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|sol|move|vue|svelte)$/i;
const EXCLUDED_SOURCE_PATH =
  /(^|\/)(?:node_modules|vendor|dist|build|coverage|generated|\.next)(\/|$)|(?:\.min\.js|\.map)$/i;

export function selectSourcePaths(paths: string[], limit = 12): string[] {
  return paths
    .filter(
      (path) =>
        SOURCE_FILE_PATTERN.test(path) && !EXCLUDED_SOURCE_PATH.test(path),
    )
    .map((path) => ({
      path,
      score:
        (/^(?:src|app|lib)\//i.test(path) ? 20 : 0) +
        (/(?:^|\/)(?:main|index|app|server)\.[^.]+$/i.test(path) ? 10 : 0) +
        (/(?:service|controller|module|route|contract)/i.test(path) ? 5 : 0) -
        path.split('/').length,
    }))
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
    .slice(0, Math.max(0, limit))
    .map((item) => item.path);
}

export function parseGitHubRepositoryUrl(value: string): {
  owner: string;
  repo: string;
} {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('INVALID_REFERENCE');
  }
  const parts = url.pathname
    .replace(/\.git$/, '')
    .split('/')
    .filter(Boolean);
  if (
    url.protocol !== 'https:' ||
    url.hostname.toLowerCase() !== 'github.com' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    parts.length !== 2
  ) {
    throw new Error('INVALID_REFERENCE');
  }
  return { owner: parts[0], repo: parts[1] };
}

function decodeBase64(
  content: string,
  maxBytes: number,
): {
  text: string;
  truncated: boolean;
} {
  const bytes = Buffer.from(content.replace(/\n/g, ''), 'base64');
  const truncated = bytes.length > maxBytes;
  return { text: bytes.subarray(0, maxBytes).toString('utf8'), truncated };
}

function classifyGitHubError(error: unknown): string {
  if (!error || typeof error !== 'object') return 'SOURCE_UNAVAILABLE';
  const candidate = error as { status?: unknown; name?: unknown };
  if (candidate.status === 404) return 'NOT_FOUND';
  if (candidate.status === 401 || candidate.status === 403)
    return 'ACCESS_DENIED';
  if (candidate.status === 429) return 'RATE_LIMITED';
  if (candidate.name === 'AbortError') return 'TIMEOUT';
  return 'SOURCE_UNAVAILABLE';
}

@Injectable()
export class GitHubEvidenceCollector {
  constructor(private readonly config: ConfigService) {}

  async resolveHeadRevision(githubUrl: string): Promise<string | null> {
    let coordinates: { owner: string; repo: string };
    try {
      coordinates = parseGitHubRepositoryUrl(githubUrl);
    } catch {
      return null;
    }
    try {
      const { Octokit } = await import('@octokit/rest');
      const octokit = this.createClient(Octokit);
      const repository = await octokit.rest.repos.get(coordinates);
      const commit = await octokit.rest.repos.getCommit({
        ...coordinates,
        ref: repository.data.default_branch,
      });
      return commit.data.sha;
    } catch {
      return null;
    }
  }

  /** A deliberately small provider operation for the participant validator. */
  async inspectReadme(githubUrl: string): Promise<{ accessible: boolean; readme: boolean; evidence: string }> {
    const coordinates = parseGitHubRepositoryUrl(githubUrl);
    const { Octokit } = await import('@octokit/rest');
    const octokit = this.createClient(Octokit);
    const repository = await octokit.rest.repos.get(coordinates);
    try {
      const readme = await octokit.rest.repos.getReadme(coordinates);
      return { accessible: true, readme: true, evidence: `GitHub repository ${repository.data.full_name}; README ${readme.data.path}.` };
    } catch (error) {
      const code = classifyGitHubError(error);
      if (code === 'NOT_FOUND') return { accessible: true, readme: false, evidence: `GitHub repository ${repository.data.full_name}; README was not found.` };
      throw error;
    }
  }

  async collect(githubUrl: string): Promise<GitHubCollectionResult> {
    let coordinates: { owner: string; repo: string };
    try {
      coordinates = parseGitHubRepositoryUrl(githubUrl);
    } catch {
      return {
        records: [
          unavailableEvidence(
            'GITHUB_REPOSITORY',
            'github_api',
            githubUrl,
            'INVALID_REFERENCE',
          ),
        ],
        repositoryData: { ...EMPTY_REPOSITORY_DATA },
        artifacts: [],
      };
    }

    try {
      const { Octokit } = await import('@octokit/rest');
      const octokit = this.createClient(Octokit);
      const { owner, repo } = coordinates;
      const repository = await octokit.rest.repos.get({ owner, repo });
      const commit = await octokit.rest.repos.getCommit({
        owner,
        repo,
        ref: repository.data.default_branch,
      });
      const commitSha = commit.data.sha;
      const [tree, languages] = await Promise.all([
        octokit.rest.git.getTree({
          owner,
          repo,
          tree_sha: commitSha,
          recursive: '1',
        }),
        octokit.rest.repos.listLanguages({ owner, repo }),
      ]);
      const treeEntries = tree.data.tree.slice(0, 20_000);
      const paths = treeEntries
        .map((item) => item.path)
        .filter((path): path is string => typeof path === 'string');
      const testPaths = paths
        .filter((path) =>
          /(^|\/)(__tests__|test|tests)\/|\.(spec|test)\.[^.]+$/i.test(path),
        )
        .slice(0, 100);
      const workflowPaths = paths
        .filter((path) => path.startsWith('.github/workflows/'))
        .slice(0, 30);
      const selectedPaths = selectSourcePaths(paths);

      let readme: GitHubCollectionResult['repositoryData']['readme'] = null;
      let readmeRecord: EvidenceDraft | null = null;
      try {
        const response = await octokit.rest.repos.getReadme({
          owner,
          repo,
          ref: commitSha,
        });
        if (response.data.content) {
          const decoded = decodeBase64(
            response.data.content,
            this.maxPromptSourceBytes(),
          );
          readme = { path: response.data.path, ...decoded };
          readmeRecord = {
            type: 'GITHUB_FILE',
            source: 'github_api',
            status: 'VERIFIED',
            reference: `https://github.com/${owner}/${repo}/blob/${commitSha}/${response.data.path}`,
            sourceRevision: response.data.sha,
            locator: { owner, repo, path: response.data.path, commitSha },
            facts: {
              path: response.data.path,
              sizeBytes: response.data.size,
              truncated: decoded.truncated,
              kind: 'README',
            },
            contentHash: sha256(decoded.text),
            errorCode: decoded.truncated ? 'TRUNCATED' : null,
            expiresAt: null,
          };
        }
      } catch {
        // README absence is represented in repository facts, not as a failed repository.
      }

      let packageManifest: unknown = null;
      let packageManifestText: string | null = null;
      if (paths.includes('package.json')) {
        try {
          const response = await octokit.rest.repos.getContent({
            owner,
            repo,
            path: 'package.json',
            ref: commitSha,
          });
          if (
            !Array.isArray(response.data) &&
            response.data.type === 'file' &&
            response.data.content
          ) {
            const decoded = decodeBase64(
              response.data.content,
              this.maxPromptSourceBytes(),
            );
            packageManifest = JSON.parse(decoded.text);
            packageManifestText = JSON.stringify(packageManifest);
          }
        } catch {
          packageManifest = null;
        }
      }

      const selectedSourceExcerpts = (
        await Promise.all(
          selectedPaths.map(async (path) => {
            try {
              const response = await octokit.rest.repos.getContent({
                owner,
                repo,
                path,
                ref: commitSha,
              });
              if (
                Array.isArray(response.data) ||
                response.data.type !== 'file' ||
                !response.data.content
              ) {
                return null;
              }
              const decoded = decodeBase64(
                response.data.content,
                this.maxSourceExcerptBytes(),
              );
              return {
                path,
                startLine: 1,
                endLine: decoded.text.split('\n').length,
                text: decoded.text,
                truncated: decoded.truncated,
              };
            } catch {
              return null;
            }
          }),
        )
      ).filter((item): item is NonNullable<typeof item> => item !== null);

      const records: EvidenceDraft[] = [
        {
          type: 'GITHUB_REPOSITORY',
          source: 'github_api',
          status: 'VERIFIED',
          reference: repository.data.html_url,
          sourceRevision: commitSha,
          locator: { owner, repo, commitSha },
          facts: {
            repositoryId: repository.data.id,
            owner,
            name: repo,
            canonicalUrl: repository.data.html_url,
            visibility: repository.data.visibility ?? 'unknown',
            defaultBranch: repository.data.default_branch,
            commitSha,
            isFork: repository.data.fork,
            archived: repository.data.archived,
            treeComplete:
              !tree.data.truncated && tree.data.tree.length <= 20_000,
            treeEntryCount: treeEntries.length,
            hasReadme: readme !== null,
            languagesByBytes: languages.data,
            latestCommitAt: commit.data.commit.committer?.date ?? null,
          },
          contentHash: sha256(
            JSON.stringify({ commitSha, paths, languages: languages.data }),
          ),
          errorCode: tree.data.truncated ? 'TRUNCATED' : null,
          expiresAt: null,
        },
        {
          type: 'GITHUB_TEST_SIGNAL',
          source: 'github_api',
          status: 'VERIFIED',
          reference: `https://github.com/${owner}/${repo}/tree/${commitSha}`,
          sourceRevision: commitSha,
          locator: { owner, repo, commitSha },
          facts: {
            testFilePaths: testPaths,
            workflowPaths,
            executionStatus: 'NOT_RUN',
            ciConclusion: null,
          },
          contentHash: sha256(JSON.stringify({ testPaths, workflowPaths })),
          errorCode: null,
          expiresAt: null,
        },
      ];
      if (readmeRecord) records.push(readmeRecord);

      for (const excerpt of selectedSourceExcerpts) {
        records.push({
          type: 'GITHUB_FILE',
          source: 'github_api',
          status: 'VERIFIED',
          reference: `https://github.com/${owner}/${repo}/blob/${commitSha}/${excerpt.path}`,
          sourceRevision: commitSha,
          locator: { owner, repo, path: excerpt.path, commitSha },
          facts: {
            path: excerpt.path,
            startLine: excerpt.startLine,
            endLine: excerpt.endLine,
            truncated: excerpt.truncated,
            kind: 'SOURCE_EXCERPT',
          },
          contentHash: sha256(excerpt.text),
          errorCode: excerpt.truncated ? 'TRUNCATED' : null,
          expiresAt: null,
        });
      }

      const artifacts: ArtifactDraft[] = [
        {
          artifactKey: 'github:repository-manifest',
          type: 'REPOSITORY_MANIFEST',
          source: 'github_api',
          reference: `${repository.data.html_url}/tree/${commitSha}`,
          path: null,
          sourceRevision: commitSha,
          content: JSON.stringify({ paths, languages: languages.data }),
          contentHash: sha256(
            JSON.stringify({ commitSha, paths, languages: languages.data }),
          ),
          metadata: {
            treeComplete:
              !tree.data.truncated && tree.data.tree.length <= 20_000,
            entryCount: paths.length,
          },
        },
      ];
      if (readme) {
        artifacts.push({
          artifactKey: `github:${readme.path}`,
          type: 'README',
          source: 'github_api',
          reference: `https://github.com/${owner}/${repo}/blob/${commitSha}/${readme.path}`,
          path: readme.path,
          sourceRevision: commitSha,
          content: readme.text,
          contentHash: sha256(readme.text),
          metadata: { truncated: readme.truncated },
        });
      }
      if (packageManifestText) {
        artifacts.push({
          artifactKey: 'github:package.json',
          type: 'PACKAGE_MANIFEST',
          source: 'github_api',
          reference: `https://github.com/${owner}/${repo}/blob/${commitSha}/package.json`,
          path: 'package.json',
          sourceRevision: commitSha,
          content: packageManifestText,
          contentHash: sha256(packageManifestText),
          metadata: {},
        });
      }
      artifacts.push(
        ...selectedSourceExcerpts.map((excerpt) => ({
          artifactKey: `github:${excerpt.path}`,
          type: 'SOURCE_EXCERPT' as const,
          source: 'github_api' as const,
          reference: `https://github.com/${owner}/${repo}/blob/${commitSha}/${excerpt.path}`,
          path: excerpt.path,
          sourceRevision: commitSha,
          content: excerpt.text,
          contentHash: sha256(excerpt.text),
          metadata: {
            startLine: excerpt.startLine,
            endLine: excerpt.endLine,
            truncated: excerpt.truncated,
          },
        })),
      );

      return {
        records,
        repositoryData: { readme, packageManifest, selectedSourceExcerpts },
        artifacts,
      };
    } catch (error) {
      return {
        records: [
          unavailableEvidence(
            'GITHUB_REPOSITORY',
            'github_api',
            githubUrl,
            classifyGitHubError(error),
          ),
        ],
        repositoryData: { ...EMPTY_REPOSITORY_DATA },
        artifacts: [],
      };
    }
  }

  private createClient(Octokit: typeof import('@octokit/rest').Octokit) {
    return new Octokit({
      auth: this.config.get<string>('GITHUB_TOKEN')?.trim() || undefined,
      request: {
        timeout: Number(
          this.config.get('EVIDENCE_GITHUB_TIMEOUT_MS') ?? 10_000,
        ),
      },
    });
  }

  private maxPromptSourceBytes(): number {
    const configured = Number(
      this.config.get('EVIDENCE_MAX_PROMPT_SOURCE_BYTES') ?? 100_000,
    );
    return Number.isFinite(configured)
      ? Math.min(Math.max(Math.floor(configured), 1_000), 500_000)
      : 100_000;
  }

  private maxSourceExcerptBytes(): number {
    const configured = Number(
      this.config.get('EVIDENCE_MAX_SOURCE_EXCERPT_BYTES') ?? 12_000,
    );
    return Number.isFinite(configured)
      ? Math.min(Math.max(Math.floor(configured), 1_000), 30_000)
      : 12_000;
  }
}
