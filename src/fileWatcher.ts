import * as vscode from 'vscode';
import { KustomizeParser } from './kustomizeParser';
import { FluxResourceIndex } from './fluxResourceIndex';

export class KustomizeFileWatcher {
    private kustomizationFileWatcher: vscode.FileSystemWatcher | undefined;
    private allYamlFileWatcher: vscode.FileSystemWatcher | undefined;
    private parser: KustomizeParser;
    private fluxResourceIndex: FluxResourceIndex;
    // For debouncing
    private scanTimeout: NodeJS.Timeout | undefined = undefined;
    private fluxIndexTimeout: NodeJS.Timeout | undefined = undefined;
    private readonly debounceDelay = 500; // ms
    
    // Mass change detection (e.g., git branch switch)
    private recentChangeEvents: string[] = [];
    private readonly changeRateWindow = 1000; // 1 second window
    private readonly massChangeThreshold = 50; // If more than 50 files change in 1 second
    private cleanupInterval: NodeJS.Timeout | undefined = undefined;

    constructor(workspaceRoot: string, enableFileSystemCache: boolean = true) {
        this.parser = new KustomizeParser(workspaceRoot, enableFileSystemCache);
        this.fluxResourceIndex = new FluxResourceIndex(workspaceRoot);
    }

    public async initialize(): Promise<void> {
        // Initial parsing of all kustomization files
        await this.parser.buildReferenceMap();
        await this.fluxResourceIndex.rebuildFull();

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

        // Update references incrementally when kustomization files are created or changed
        this.kustomizationFileWatcher.onDidCreate((uri) => this.handleKustomizationFileChange(uri));
        this.kustomizationFileWatcher.onDidChange((uri) => this.handleKustomizationFileChange(uri));
        this.kustomizationFileWatcher.onDidDelete((uri) => this.handleKustomizationFileDelete(uri));

        // For all YAML files, check if they might be Flux Kustomizations
        this.allYamlFileWatcher.onDidCreate((uri) => this.handleYamlFileChange(uri));
        this.allYamlFileWatcher.onDidChange((uri) => this.handleYamlFileChange(uri));
        this.allYamlFileWatcher.onDidDelete((uri) => this.handleYamlFileDelete(uri));
        
        // Start cleanup interval for mass change detection
        this.cleanupInterval = setInterval(() => {
            this.recentChangeEvents = [];
        }, this.changeRateWindow);
    }

    private handleKustomizationFileChange(uri: vscode.Uri): void {
        this.handleFileChange(uri.fsPath);
    }

    private handleKustomizationFileDelete(uri: vscode.Uri): void {
        this.handleFileChange(uri.fsPath);
    }
    
    private handleFileChange(filePath: string): void {
        // Track change event for mass change detection
        this.recentChangeEvents.push(filePath);
        
        // Check if we're experiencing a mass change (e.g., git branch switch)
        if (this.recentChangeEvents.length > this.massChangeThreshold) {
            // Mass change detected - clear all caches and do full rebuild
            this.parser.clearCaches();
            this.recentChangeEvents = [];
            this.debouncedScanWorkspace(); // Full rebuild instead of incremental
            return;
        }
        
        // Normal incremental update
        this.debouncedIncrementalUpdate(filePath);
    }

    private handleYamlFileChange(uri: vscode.Uri): void {
        // Skip standard kustomization files (already handled by other watcher)
        const fileName = uri.fsPath.toLowerCase();
        if (fileName.endsWith('kustomization.yaml') || fileName.endsWith('kustomization.yml')) {
            return;
        }

        if (this.parser.isFluxKustomizationFile(uri.fsPath)) {
            this.handleFileChange(uri.fsPath);
        } else {
            this.debouncedFluxIndexOnly(uri.fsPath);
        }
    }

    private handleYamlFileDelete(uri: vscode.Uri): void {
        // Handle deletion for YAML files
        // For deleted files, we can't check if they were Flux Kustomizations,
        // but updateFileReferencesIncremental will handle it gracefully
        const fileName = uri.fsPath.toLowerCase();
        if (fileName.endsWith('kustomization.yaml') || fileName.endsWith('kustomization.yml')) {
            this.handleFileChange(uri.fsPath);
        } else {
            // For other YAML files, check cache or just update (will be handled gracefully)
            // The incremental update will check if file exists and handle deletion properly
            this.handleFileChange(uri.fsPath);
        }
    }

    private debouncedIncrementalUpdate(filePath: string): void {
        if (this.scanTimeout) {
            clearTimeout(this.scanTimeout);
        }
        this.scanTimeout = setTimeout(() => {
            void this.updateFileReferences(filePath);
        }, this.debounceDelay);
    }

    /** Update Flux CR index only (other YAML files are not tracked by the kustomize reference map). */
    private debouncedFluxIndexOnly(filePath: string): void {
        if (this.fluxIndexTimeout) {
            clearTimeout(this.fluxIndexTimeout);
        }
        this.fluxIndexTimeout = setTimeout(() => {
            this.fluxResourceIndex.updateFile(filePath);
        }, this.debounceDelay);
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
        await this.parser.buildReferenceMap();
        await this.fluxResourceIndex.rebuildFull();
    }

    /**
     * Update references incrementally for a specific file
     */
    public async updateFileReferences(filePath: string): Promise<void> {
        this.fluxResourceIndex.updateFile(filePath);
        await this.parser.updateFileReferencesIncremental(filePath);
    }

    public getParser(): KustomizeParser {
        return this.parser;
    }

    public getFluxResourceIndex(): FluxResourceIndex {
        return this.fluxResourceIndex;
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
        if (this.fluxIndexTimeout) {
            clearTimeout(this.fluxIndexTimeout);
        }
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
        }
    }
}