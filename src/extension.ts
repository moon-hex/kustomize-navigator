import * as vscode from 'vscode';
import { KustomizeFileWatcher } from './fileWatcher';
import { KustomizeLinkProvider } from './linkProvider';
import { KustomizeHoverProvider } from './hoverProvider';
import { FluxVariableDecorator } from './fluxDecorator';
import { FluxCompletionProvider } from './fluxCompletionProvider';
import { FluxDiagnosticProvider } from './fluxDiagnostics';
import { KustomizeParser } from './kustomizeParser';
import { PatchTransformProvider } from './patchTransformProvider';
import { WorkspaceGitIndex } from './workspaceGitIndex';

export async function activate(context: vscode.ExtensionContext) {
    console.log('Kustomize Navigator checking if workspace contains kustomization files...');

    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
        console.log('Kustomize Navigator: No workspace folder is open');
        return;
    }

    const workspaceRoots = workspaceFolders.map(f => f.uri.fsPath);

    // Read performance configuration
    const performanceConfig = vscode.workspace.getConfiguration('kustomizeNavigator.performance');
    const enableFileSystemCache = performanceConfig.get<boolean>('enableFileSystemCache', true);

    // Check for kustomization files before initializing watcher (uses all roots)
    const parser = new KustomizeParser(workspaceRoots, enableFileSystemCache);
    const kustomizationFiles = await parser.findKustomizationFiles();

    if (kustomizationFiles.length === 0) {
        console.log('Kustomize Navigator: No kustomization files found in workspace, not activating extension');
        return;
    }

    console.log(`Kustomize Navigator extension is now active (found ${kustomizationFiles.length} kustomization files across ${workspaceRoots.length} workspace root(s))`);

    // Build workspace git index (for cross-repo Flux link resolution)
    const gitIndex = new WorkspaceGitIndex();
    await gitIndex.initialize();

    // Initialize the file watcher with all roots
    const fileWatcher = new KustomizeFileWatcher(workspaceRoots, enableFileSystemCache);
    await fileWatcher.initialize();

    // When workspace folders change, update roots in watcher and git index
    context.subscriptions.push(
        vscode.workspace.onDidChangeWorkspaceFolders(async (e) => {
            if (e.added.length > 0 || e.removed.length > 0) {
                const newRoots = (vscode.workspace.workspaceFolders ?? []).map(f => f.uri.fsPath);
                await fileWatcher.updateWorkspaceRoots(newRoots);
                // gitIndex handles its own rescan via its own onDidChangeWorkspaceFolders listener
            }
        })
    );

    // Register link provider (receives git index for cross-repo resolution)
    const linkProvider = new KustomizeLinkProvider(
        fileWatcher.getParser(),
        fileWatcher.getFluxResourceIndex(),
        gitIndex
    );
    const linkProviderDisposable = vscode.languages.registerDocumentLinkProvider(
        { language: 'yaml' },
        linkProvider
    );

    // Register hover provider
    const hoverProvider = new KustomizeHoverProvider(fileWatcher.getParser());
    const hoverProviderDisposable = vscode.languages.registerHoverProvider(
        { language: 'yaml' },
        hoverProvider
    );

    // Check if variable highlighting is enabled in config
    const config = vscode.workspace.getConfiguration('kustomizeNavigator');
    const highlightEnabled = config.get<boolean>('highlightFluxVariables', true);

    let fluxDecorator;
    if (highlightEnabled) {
        fluxDecorator = new FluxVariableDecorator(fileWatcher.getParser());
        context.subscriptions.push(fluxDecorator);
    }

    // Register Flux variable completion provider
    const completionProvider = new FluxCompletionProvider();
    const completionProviderDisposable = vscode.languages.registerCompletionItemProvider(
        { language: 'yaml' },
        completionProvider,
        '$', '{' // Triggered by ${
    );

    // Register Flux diagnostic provider
    const diagnosticProvider = new FluxDiagnosticProvider();

    // Register patch transform code action provider
    const patchTransformProvider = new PatchTransformProvider();
    const codeActionProviderDisposable = vscode.languages.registerCodeActionsProvider(
        { language: 'yaml' },
        patchTransformProvider,
        {
            providedCodeActionKinds: PatchTransformProvider.providedCodeActionKinds
        }
    );

    context.subscriptions.push(
        gitIndex,
        fileWatcher,
        linkProviderDisposable,
        linkProvider,
        hoverProviderDisposable,
        completionProviderDisposable,
        diagnosticProvider,
        codeActionProviderDisposable
    );

    vscode.window.showInformationMessage(`Kustomize Navigator: Initialized successfully (found ${kustomizationFiles.length} kustomization files)`);
}

export function deactivate() {
    // Cleanup will be handled by the disposables
}
// Import path for the visualization HTML
import * as path from 'path';
