import * as vscode from 'vscode';
import { KustomizeFileWatcher } from './fileWatcher';
import { KustomizeParser } from './kustomizeParser';
import { KustomizeLinkProvider } from './linkProvider';
import { KustomizeHoverProvider } from './hoverProvider';
import { FluxVariableDecorator } from './fluxDecorator';
import { FluxCompletionProvider } from './fluxCompletionProvider';
import { FluxDiagnosticProvider } from './fluxDiagnostics';

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
        // This workspace contains kustomization files, register providers

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

        // Add disposables to context.subscriptions
        context.subscriptions.push(
            fileWatcher,
            linkProviderDisposable,
            linkProvider,
            hoverProviderDisposable,
            completionProviderDisposable,
            diagnosticProvider
        );

        // Log success
        vscode.window.showInformationMessage(`Kustomize Navigator: Initialized successfully (found ${kustomizationFiles.length} kustomization files)`);
    } else {
        // No kustomization files found, so don't register the providers
        console.log('Kustomize Navigator: No kustomization files found in workspace, disabling extension');
        fileWatcher.dispose();
    }
    // Register commands for toggling diagnostic checks
    const toggleAllChecksCommand = vscode.commands.registerCommand(
        'kustomize-navigator.toggleAllChecks',
        async () => {
            const diagnosticsConfig = vscode.workspace.getConfiguration('kustomizeNavigator.diagnostics');
            const currentState = diagnosticsConfig.get<boolean>('enabled', true);

            // Toggle the master switch
            await diagnosticsConfig.update('enabled', !currentState, vscode.ConfigurationTarget.Global);

            vscode.window.showInformationMessage(
                `Kustomize Navigator: All diagnostic checks ${!currentState ? 'enabled' : 'disabled'}`
            );
        }
    );

    const resetChecksCommand = vscode.commands.registerCommand(
        'kustomize-navigator.resetChecksToDefault',
        async () => {
            const checksConfig = vscode.workspace.getConfiguration('kustomizeNavigator.diagnostics.checks');

            // Reset all check configurations to default (true)
            const checkKeys = [
                'resourceNaming', 'namespaceRequired', 'recursiveDependencies',
                'imageTags', 'securityIssues', 'fluxVersions', 'gitopsComponents',
                'performanceIssues', 'variableSubstitution', 'indentation'
            ];

            for (const key of checkKeys) {
                await checksConfig.update(key, true, vscode.ConfigurationTarget.Global);
            }

            // Also ensure master toggle is on
            const diagnosticsConfig = vscode.workspace.getConfiguration('kustomizeNavigator.diagnostics');
            await diagnosticsConfig.update('enabled', true, vscode.ConfigurationTarget.Global);

            vscode.window.showInformationMessage(
                'Kustomize Navigator: All diagnostic checks reset to default (enabled)'
            );
        }
    );

    context.subscriptions.push(toggleAllChecksCommand, resetChecksCommand);
}

export function deactivate() {
    // Cleanup will be handled by the disposables
}
