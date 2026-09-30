import {
  parseGitHubRepositoryUrl,
  selectSourcePaths,
} from './github-evidence.collector';

describe('parseGitHubRepositoryUrl', () => {
  it('accepts a canonical repository URL', () => {
    expect(
      parseGitHubRepositoryUrl('https://github.com/openai/openai-node.git'),
    ).toEqual({
      owner: 'openai',
      repo: 'openai-node',
    });
  });

  it.each([
    'http://github.com/a/b',
    'https://github.example/a/b',
    'https://github.com/a/b/issues',
    'https://token@github.com/a/b',
  ])('rejects noncanonical URL %s', (url) => {
    expect(() => parseGitHubRepositoryUrl(url)).toThrow('INVALID_REFERENCE');
  });
});

describe('selectSourcePaths', () => {
  it('prioritizes application entrypoints and excludes generated dependencies', () => {
    expect(
      selectSourcePaths([
        'node_modules/pkg/index.js',
        'dist/main.js',
        'scripts/tool.ts',
        'src/features/auth/auth.service.ts',
        'src/main.ts',
        'README.md',
      ]),
    ).toEqual([
      'src/main.ts',
      'src/features/auth/auth.service.ts',
      'scripts/tool.ts',
    ]);
  });
});
