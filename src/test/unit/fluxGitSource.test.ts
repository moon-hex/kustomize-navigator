import * as assert from 'assert';
import { gitRemotesMatch, normalizeGitRemoteUrl, resolveFluxContentRoot } from '../../fluxGitSource';
import type { IGitIndex } from '../../workspaceGitIndex';

// ---------------------------------------------------------------------------
// Existing helpers
// ---------------------------------------------------------------------------

suite('fluxGitSource', () => {
    test('normalizeGitRemoteUrl maps ssh and https to same key', () => {
        const https = 'https://github.com/acme/infra.git';
        const ssh = 'git@github.com:acme/infra.git';
        assert.strictEqual(normalizeGitRemoteUrl(https), normalizeGitRemoteUrl(ssh));
    });

    test('gitRemotesMatch accepts equivalent remotes', () => {
        assert.strictEqual(
            gitRemotesMatch('https://gitlab.com/group/proj', 'git@gitlab.com:group/proj.git'),
            true
        );
    });

    test('gitRemotesMatch rejects different repos', () => {
        assert.strictEqual(
            gitRemotesMatch('https://github.com/a/x', 'https://github.com/b/x'),
            false
        );
    });
});

// ---------------------------------------------------------------------------
// resolveFluxContentRoot
// ---------------------------------------------------------------------------

/** Minimal IGitIndex stub for testing. */
function makeIndex(map: Record<string, string>): IGitIndex {
    return {
        findBest(remoteUrl: string, _nearPath: string): string | undefined {
            return map[remoteUrl] ?? map[normalizeGitRemoteUrl(remoteUrl)];
        }
    };
}

suite('resolveFluxContentRoot', () => {
    const docFile = '/workspace/infra/flux/kustomization.yaml';
    const docRoot = '/workspace/infra';

    test('returns skip for non-GitRepository sourceRef', () => {
        const result = resolveFluxContentRoot({
            sourceRefKind: 'OCIRepository',
            specUrl: 'oci://registry/repo',
            documentFilePath: docFile,
            documentGitRoot: docRoot,
            gitIndex: makeIndex({}),
        });
        assert.strictEqual(result.via, 'skip');
        assert.strictEqual(result.gitRoot, undefined);
    });

    test('falls back to document git root when specUrl is undefined', () => {
        // GitRepository manifest not in workspace (or no spec.url) — should still link
        // using the document's own repo rather than silently skipping.
        const result = resolveFluxContentRoot({
            sourceRefKind: 'GitRepository',
            specUrl: undefined,
            documentFilePath: docFile,
            documentGitRoot: docRoot,
            gitIndex: makeIndex({}),
        });
        assert.strictEqual(result.via, 'document');
        assert.strictEqual(result.gitRoot, docRoot);
    });

    test('returns workspace match when index has an entry', () => {
        const appRoot = '/workspace/app-repo';
        const appUrl = 'https://github.com/acme/app';
        const result = resolveFluxContentRoot({
            sourceRefKind: 'GitRepository',
            specUrl: appUrl,
            documentFilePath: docFile,
            documentGitRoot: docRoot,
            // docRoot origin is undefined (no git subprocess in tests) → falls through to index
            gitIndex: makeIndex({ [normalizeGitRemoteUrl(appUrl)]: appRoot }),
        });
        assert.strictEqual(result.via, 'workspace');
        assert.strictEqual(result.gitRoot, appRoot);
    });

    test('returns no-clone when index has no match', () => {
        const result = resolveFluxContentRoot({
            sourceRefKind: 'GitRepository',
            specUrl: 'https://github.com/acme/missing',
            documentFilePath: docFile,
            documentGitRoot: docRoot,
            gitIndex: makeIndex({}),
        });
        assert.strictEqual(result.via, 'no-clone');
        assert.ok('specUrl' in result);
    });
});

// ---------------------------------------------------------------------------
// WorkspaceGitIndex.findBest — deterministic selection
// ---------------------------------------------------------------------------

suite('WorkspaceGitIndex findBest selection', () => {
    test('prefers candidate with longer common path prefix', () => {
        // Inline the same algorithm used in WorkspaceGitIndex to avoid VS Code API dep.
        function commonPrefixLength(a: string, b: string): number {
            let i = 0;
            while (i < a.length && i < b.length && a[i] === b[i]) { i++; }
            return i;
        }

        const nearPath = '/projects/flux-infra/clusters/production/ks.yaml';
        const candidates = ['/projects/app-repo', '/projects/flux-infra'];
        let best = candidates[0];
        let bestLen = commonPrefixLength(best, nearPath);
        for (let i = 1; i < candidates.length; i++) {
            const len = commonPrefixLength(candidates[i], nearPath);
            if (len > bestLen) { bestLen = len; best = candidates[i]; }
        }
        assert.strictEqual(best, '/projects/flux-infra');
    });
});
