import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { getGitRemoteUrl, normalizeGitRemoteUrl } from './fluxGitSource';

/** Minimal interface used by resolveFluxContentRoot — avoids circular dependency. */
export interface IGitIndex {
    findBest(remoteUrl: string, nearPath: string): string | undefined;
}

/**
 * Lightweight cache of all git repositories discovered in the VS Code workspace.
 * Maps normalised remote-origin URL → list of local git-root absolute paths.
 *
 * Scan scope: each workspace folder root + direct children (depth 1).
 * Rescan triggers: workspace folder additions/removals, .git/config create/change/delete.
 */
export class WorkspaceGitIndex implements IGitIndex, vscode.Disposable {
    private index = new Map<string, string[]>();
    private gitConfigWatcher: vscode.FileSystemWatcher | undefined;
    private folderChangeDisposable: vscode.Disposable | undefined;
    private debounceTimer: NodeJS.Timeout | undefined;
    private readonly debounceMs = 1000;

    public async initialize(): Promise<void> {
        await this.rebuildIndex();

        // Store the disposable so it is cleaned up on dispose().
        this.folderChangeDisposable = vscode.workspace.onDidChangeWorkspaceFolders(
            () => this.scheduleRebuild()
        );

        // Catch new clones and remote-URL edits inside the workspace.
        this.gitConfigWatcher = vscode.workspace.createFileSystemWatcher('**/.git/config');
        this.gitConfigWatcher.onDidCreate(() => this.scheduleRebuild());
        this.gitConfigWatcher.onDidChange(() => this.scheduleRebuild());
        this.gitConfigWatcher.onDidDelete(() => this.scheduleRebuild());
    }

    /**
     * All git roots whose origin normalises to the same URL as `remoteUrl`.
     */
    public find(remoteUrl: string): string[] {
        return this.index.get(normalizeGitRemoteUrl(remoteUrl)) ?? [];
    }

    /**
     * Best single git root for `remoteUrl`, chosen by longest common path prefix
     * with `nearPath` (deterministic for multi-clone workspaces).
     */
    public findBest(remoteUrl: string, nearPath: string): string | undefined {
        const candidates = this.find(remoteUrl);
        if (candidates.length === 0) { return undefined; }
        if (candidates.length === 1) { return candidates[0]; }

        let best = candidates[0];
        let bestLen = commonPrefixLength(best, nearPath);
        for (let i = 1; i < candidates.length; i++) {
            const len = commonPrefixLength(candidates[i], nearPath);
            if (len > bestLen) { bestLen = len; best = candidates[i]; }
        }
        return best;
    }

    private scheduleRebuild(): void {
        if (this.debounceTimer) { clearTimeout(this.debounceTimer); }
        this.debounceTimer = setTimeout(() => void this.rebuildIndex(), this.debounceMs);
    }

    private async rebuildIndex(): Promise<void> {
        const newIndex = new Map<string, string[]>();
        for (const folder of vscode.workspace.workspaceFolders ?? []) {
            this.scanRoot(folder.uri.fsPath, newIndex);
        }
        this.index = newIndex;
        console.log(`WorkspaceGitIndex: ${this.index.size} unique remote URL(s) indexed`);
    }

    private scanRoot(root: string, index: Map<string, string[]>): void {
        this.tryAddGitRepo(root, index);
        try {
            for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
                if (entry.isDirectory()) {
                    this.tryAddGitRepo(path.join(root, entry.name), index);
                }
            }
        } catch { /* unreadable dir — skip */ }
    }

    private tryAddGitRepo(dirPath: string, index: Map<string, string[]>): void {
        const normalizedDir = path.normalize(dirPath);
        try {
            fs.statSync(path.join(normalizedDir, '.git'));
        } catch {
            return; // no .git here
        }

        const remoteUrl = getGitRemoteUrl(normalizedDir);
        if (!remoteUrl) { return; }

        const normalizedUrl = normalizeGitRemoteUrl(remoteUrl);
        const existing = index.get(normalizedUrl);
        if (existing) {
            if (!existing.includes(normalizedDir)) { existing.push(normalizedDir); }
        } else {
            index.set(normalizedUrl, [normalizedDir]);
        }
    }

    public dispose(): void {
        this.folderChangeDisposable?.dispose();
        this.gitConfigWatcher?.dispose();
        if (this.debounceTimer) { clearTimeout(this.debounceTimer); }
    }
}

function commonPrefixLength(a: string, b: string): number {
    let i = 0;
    while (i < a.length && i < b.length && a[i] === b[i]) { i++; }
    return i;
}
