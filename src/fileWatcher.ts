import * as vscode from 'vscode';
import { KustomizeParser } from './kustomizeParser';

export class KustomizeFileWatcher {
    private kustomizationFileWatcher: vscode.FileSystemWatcher | undefined;
    private allYamlFileWatcher: vscode.FileSystemWatcher | undefined;
    private parser: KustomizeParser;
    // For debouncing
    private scanTimeout: NodeJS.Timeout | undefined = undefined;
    private readonly debounceDelay = 500; // ms

    constructor(workspaceRoot: string) {
        this.parser = new KustomizeParser(workspaceRoot);
    }

    public async initialize(): Promise<void> {
        // Initial parsing of all kustomization files
        await this.parser.buildReferenceMap();

        // Set up file watcher for standard kustomization files
        this.kustomizationFileWatcher = vscode.workspace.createFileSystemWatcher(
            '**/kustomization.{yaml,yml}',
            false, // Don't ignore creation events
            false, // Don't ignore change events
            false  // Don't ignore deletion events
        );

        // Set up file watcher for all YAML files (to catch Flux Kustomization CRs)
        this.allYamlFileWatcher = vscode.workspace.createFileSystemWatcher(
            '**/*.{yaml,yml}',
            false, // Don't ignore creation events
            false, // Don't ignore change events
            false  // Don't ignore deletion events
        );

        // Update references when kustomization files are created or changed
        this.kustomizationFileWatcher.onDidCreate(() => this.debouncedScanWorkspace());
        this.kustomizationFileWatcher.onDidChange(() => this.debouncedScanWorkspace());
        this.kustomizationFileWatcher.onDidDelete(() => this.debouncedScanWorkspace());

        // For all YAML files, check if they might be Flux Kustomizations
        this.allYamlFileWatcher.onDidCreate((uri) => this.handleYamlFileChange(uri));
        this.allYamlFileWatcher.onDidChange((uri) => this.handleYamlFileChange(uri));
        this.allYamlFileWatcher.onDidDelete(() => this.debouncedScanWorkspace());
    }

    private handleYamlFileChange(uri: vscode.Uri): void {
        // Skip standard kustomization files (already handled by other watcher)
        const fileName = uri.fsPath.toLowerCase();
        if (fileName.endsWith('kustomization.yaml') || fileName.endsWith('kustomization.yml')) {
            return;
        }

        // Check if this could be a Flux Kustomization CR
        if (this.parser.isFluxKustomizationFile(uri.fsPath)) {
            console.log(`Detected Flux Kustomization CR: ${uri.fsPath}`);
            this.debouncedScanWorkspace();
        }
    }

    private debouncedScanWorkspace() {
        if (this.scanTimeout) {
            clearTimeout(this.scanTimeout);
        }
        this.scanTimeout = setTimeout(() => {
            this.updateReferences();
        }, this.debounceDelay);
    }

    private async updateReferences(): Promise<void> {
        console.log('Updating kustomization references (including Flux CRs)...');
        await this.parser.buildReferenceMap();
    }

    public getParser(): KustomizeParser {
        return this.parser;
    }

    public dispose(): void {
        if (this.kustomizationFileWatcher) {
            this.kustomizationFileWatcher.dispose();
        }
        if (this.allYamlFileWatcher) {
            this.allYamlFileWatcher.dispose();
        }
        if (this.scanTimeout) {
            clearTimeout(this.scanTimeout);
        }
    }
}