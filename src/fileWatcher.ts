import * as vscode from 'vscode';
import { KustomizeParser } from './kustomizeParser';

export class KustomizeFileWatcher {
    private fileWatcher: vscode.FileSystemWatcher | undefined;
    private parser: KustomizeParser;
    
    constructor(workspaceRoot: string) {
        this.parser = new KustomizeParser(workspaceRoot);
    }

    public async initialize(): Promise<void> {
        // Initial parsing of all kustomization files
        await this.parser.buildReferenceMap();
        
        // Get watcher exclude patterns from workspace configuration
        const watcherExclude = vscode.workspace.getConfiguration('files', null).get<Record<string, boolean>>('watcherExclude', {});
        
        // Set up file watcher for kustomization files
        this.fileWatcher = vscode.workspace.createFileSystemWatcher(
            '**/kustomization.{yaml,yml}',
            false, // Don't ignore creation events
            false, // Don't ignore change events
            false  // Don't ignore deletion events
        );

        // Update references when files are created or changed
        this.fileWatcher.onDidCreate(() => this.updateReferences());
        this.fileWatcher.onDidChange(() => this.updateReferences());
        this.fileWatcher.onDidDelete(() => this.updateReferences());
    }

    private async updateReferences(): Promise<void> {
        await this.parser.buildReferenceMap();
    }

    public getParser(): KustomizeParser {
        return this.parser;
    }

    public dispose(): void {
        if (this.fileWatcher) {
            this.fileWatcher.dispose();
        }
    }
}