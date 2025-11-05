import * as vscode from 'vscode';
import { KustomizeFileWatcher } from './fileWatcher';
import { KustomizeLinkProvider } from './linkProvider';
import { KustomizeHoverProvider } from './hoverProvider';
import { FluxVariableDecorator } from './fluxDecorator';
import { FluxCompletionProvider } from './fluxCompletionProvider';
import { FluxDiagnosticProvider } from './fluxDiagnostics';
import { KustomizeParser } from './kustomizeParser';
import { PatchTransformProvider } from './patchTransformProvider';

export async function activate(context: vscode.ExtensionContext) {
    console.log('Kustomize Navigator checking if workspace contains kustomization files...');

    // Get the workspace folder
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
        console.log('Kustomize Navigator: No workspace folder is open');
        return;
    }

    const workspaceRoot = workspaceFolders[0].uri.fsPath;
    
    // Read performance configuration
    const performanceConfig = vscode.workspace.getConfiguration('kustomizeNavigator.performance');
    const enableFileSystemCache = performanceConfig.get<boolean>('enableFileSystemCache', true);
    
    // Check for kustomization files before initializing watcher
    const parser = new KustomizeParser(workspaceRoot, enableFileSystemCache);
    const kustomizationFiles = await parser.findKustomizationFiles();

    if (kustomizationFiles.length === 0) {
        console.log('Kustomize Navigator: No kustomization files found in workspace, not activating extension');
        return;
    }
    
    console.log(`Kustomize Navigator extension is now active (found ${kustomizationFiles.length} kustomization files)`);
    
    // Initialize the file watcher only if we found kustomization files
    const fileWatcher = new KustomizeFileWatcher(workspaceRoot, enableFileSystemCache);
    await fileWatcher.initialize();
    
    // Register link provider
    const linkProvider = new KustomizeLinkProvider(fileWatcher.getParser());
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
        // Register Flux variable decorator
        fluxDecorator = new FluxVariableDecorator();
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
    
    // Add disposables to context.subscriptions
    context.subscriptions.push(
        fileWatcher,
        linkProviderDisposable,
        linkProvider,
        hoverProviderDisposable,
        completionProviderDisposable,
        diagnosticProvider,
        codeActionProviderDisposable
    );

    // Log success
    vscode.window.showInformationMessage(`Kustomize Navigator: Initialized successfully (found ${kustomizationFiles.length} kustomization files)`);
}

export function deactivate() {
    // Cleanup will be handled by the disposables
}
// Import path for the visualization HTML
import * as path from 'path';
