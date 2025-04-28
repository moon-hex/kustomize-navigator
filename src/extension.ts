import * as vscode from 'vscode';
import { KustomizeFileWatcher } from './fileWatcher';
import { KustomizeParser } from './kustomizeParser';
import { KustomizeHoverProvider } from './hoverProvider';
// Fix the import to use the class name
import { KustomizeLinkProvider } from './linkProvider';

export async function activate(context: vscode.ExtensionContext) {
    console.log('Kustomize Navigator extension is now active');

    // Get the workspace folder
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
        vscode.window.showInformationMessage('Kustomize Navigator: No workspace folder is open');
        return;
    }
 
    const workspaceRoot = workspaceFolders[0].uri.fsPath;

    // Initialize the file watcher
    const fileWatcher = new KustomizeFileWatcher(workspaceRoot);
    await fileWatcher.initialize();

    // Find kustomization files to check if this is a GitOps repository
    const kustomizationFiles = await fileWatcher.getParser().findKustomizationFiles();

    if (kustomizationFiles.length > 0) {
        // This workspace contains kustomization files, register the provider for all YAML files
        const linkProvider = new KustomizeLinkProvider(fileWatcher.getParser());
        const linkProviderDisposable = vscode.languages.registerDocumentLinkProvider(
            { language: 'yaml' },
            linkProvider
        );

        // Add disposables to context.subscriptions
        context.subscriptions.push(fileWatcher, linkProviderDisposable, linkProvider);

        // Log success
        vscode.window.showInformationMessage(`Kustomize Navigator: Initialized successfully (found ${kustomizationFiles.length} kustomization files)`);
    } else {
        // No kustomization files found, so don't register the provider
        console.log('Kustomize Navigator: No kustomization files found in workspace, disabling extension');
        fileWatcher.dispose();
    }
    if (kustomizationFiles.length > 0) {
        // This workspace contains kustomization files, register the providers
        const linkProvider = new KustomizeLinkProvider(fileWatcher.getParser());
        const linkProviderDisposable = vscode.languages.registerDocumentLinkProvider(
            { language: 'yaml' },
            linkProvider
        );

        // Register hover provider for detailed resource information
        const hoverProvider = new KustomizeHoverProvider(fileWatcher.getParser());
        const hoverProviderDisposable = vscode.languages.registerHoverProvider(
            { language: 'yaml' },
            hoverProvider
        );

        // Add disposables to context.subscriptions
        context.subscriptions.push(
            fileWatcher,
            linkProviderDisposable,
            linkProvider,
            hoverProviderDisposable
        );

        // Log success
        vscode.window.showInformationMessage(`Kustomize Navigator: Initialized successfully (found ${kustomizationFiles.length} kustomization files)`);
    }
}

export function deactivate() {
    // Cleanup will be handled by the disposables
}
