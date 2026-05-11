import * as fs from 'fs';
import { execSync } from 'child_process';
import { YamlUtils } from './yamlUtils';
import type { IGitIndex } from './workspaceGitIndex';

/**
 * Normalize git remote URLs for comparison (https vs ssh, .git suffix, trailing slash).
 */
export function normalizeGitRemoteUrl(raw: string): string {
    let u = raw.trim().replace(/\/+$/, '');
    if (u.toLowerCase().endsWith('.git')) {
        u = u.slice(0, -4);
    }

    const sshShort = /^git@([^:/]+)[:/](.+)$/i.exec(u);
    if (sshShort) {
        const host = sshShort[1].toLowerCase();
        let repoPath = sshShort[2].replace(/\/+$/, '');
        if (repoPath.toLowerCase().endsWith('.git')) {
            repoPath = repoPath.slice(0, -4);
        }
        return `https://${host}/${repoPath}`.toLowerCase();
    }

    try {
        const parsed = new URL(u);
        const host = parsed.hostname.toLowerCase();
        let pathname = parsed.pathname.replace(/\/+$/, '');
        if (pathname.toLowerCase().endsWith('.git')) {
            pathname = pathname.slice(0, -4);
        }
        if (pathname.startsWith('/')) {
            pathname = pathname.slice(1);
        }
        return `https://${host}/${pathname}`.toLowerCase();
    } catch {
        return u.toLowerCase();
    }
}

export function gitRemotesMatch(a: string | undefined, b: string | undefined): boolean {
    if (!a?.trim() || !b?.trim()) {
        return false;
    }
    return normalizeGitRemoteUrl(a) === normalizeGitRemoteUrl(b);
}

export function getGitRemoteUrl(gitRoot: string, remoteName: string = 'origin'): string | undefined {
    try {
        const out = execSync(`git remote get-url ${remoteName}`, {
            cwd: gitRoot,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
        });
        const url = out.trim();
        return url.length > 0 ? url : undefined;
    } catch {
        return undefined;
    }
}

/**
 * Read `spec.url` from a GitRepository manifest on disk (first matching document).
 */
export function readGitRepositorySpecUrl(absYamlPath: string): string | undefined {
    let text: string;
    try {
        text = fs.readFileSync(absYamlPath, 'utf8');
    } catch {
        return undefined;
    }
    const docs = YamlUtils.parseMultipleYamlDocuments(text);
    for (const doc of docs) {
        if (!doc || typeof doc !== 'object') {
            continue;
        }
        if (doc.kind !== 'GitRepository') {
            continue;
        }
        const spec = doc.spec;
        if (spec && typeof spec === 'object' && typeof spec.url === 'string' && spec.url.trim().length > 0) {
            return spec.url.trim();
        }
    }
    return undefined;
}

/**
 * True when Flux `spec.path` / patch paths should be resolved as files under the current git clone
 * (GitRepository in index, `spec.url` matches `git remote get-url origin` at the document’s git root).
 */
export function fluxKustomizationPathsUseWorkspaceGitRepo(options: {
    sourceRefKind: string;
    gitRepositoryYamlPath: string | undefined;
    documentFilePath: string;
    gitRootResolver: (filePath: string) => string;
}): boolean {
    const kind = options.sourceRefKind.trim();
    if (kind !== 'GitRepository') {
        return false;
    }
    const repoPath = options.gitRepositoryYamlPath;
    if (!repoPath || !fs.existsSync(repoPath)) {
        return false;
    }
    const specUrl = readGitRepositorySpecUrl(repoPath);
    if (!specUrl) {
        return false;
    }
    const gitRoot = options.gitRootResolver(options.documentFilePath);
    const origin = getGitRemoteUrl(gitRoot);
    return gitRemotesMatch(specUrl, origin);
}

// ---------------------------------------------------------------------------
// Workspace-aware content-root resolution
// ---------------------------------------------------------------------------

/**
 * Discriminated union describing which git root to use when resolving Flux
 * Kustomization local paths.
 */
export type FluxContentRootResult =
    | { gitRoot: string; via: 'document' | 'workspace' }
    | { gitRoot: undefined; via: 'no-clone'; specUrl: string }
    | { gitRoot: undefined; via: 'skip' };   // non-GitRepository source or specUrl absent

/**
 * Determines the git-root directory whose checkout contains the files referenced
 * by a Flux Kustomization's spec.path / patches.
 *
 * Resolution order:
 *  1. Document's own git clone, if its origin matches specUrl.
 *  2. Any other clone found by gitIndex in the workspace (cross-repo link).
 *  3. { via: 'no-clone' } — GitRepository source with a known URL but no local clone.
 *  4. { via: 'skip' } — non-GitRepository source (OCI, Bucket, …) or missing specUrl.
 */
export function resolveFluxContentRoot(options: {
    sourceRefKind: string;
    specUrl: string | undefined;
    documentFilePath: string;
    documentGitRoot: string;
    gitIndex: IGitIndex;
}): FluxContentRootResult {
    const { sourceRefKind, specUrl, documentFilePath, documentGitRoot, gitIndex } = options;

    if (sourceRefKind.trim() !== 'GitRepository') {
        return { gitRoot: undefined, via: 'skip' };
    }
    if (!specUrl) {
        return { gitRoot: undefined, via: 'skip' };
    }

    // Fast path: document lives inside the matching clone.
    const docOrigin = getGitRemoteUrl(documentGitRoot);
    if (docOrigin && gitRemotesMatch(specUrl, docOrigin)) {
        return { gitRoot: documentGitRoot, via: 'document' };
    }

    // Search workspace for another clone whose origin matches.
    const found = gitIndex.findBest(specUrl, documentFilePath);
    if (found) {
        return { gitRoot: found, via: 'workspace' };
    }

    return { gitRoot: undefined, via: 'no-clone', specUrl };
}
