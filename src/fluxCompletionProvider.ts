import * as vscode from 'vscode';
import * as fs from 'fs';

export class FluxCompletionProvider implements vscode.CompletionItemProvider {
    // Will store variables from configuration
    private standardVariables: string[] = [];

    // Keep track of all variables found in the workspace
    private workspaceVariables: Set<string> = new Set();

    // Add disposable to track configuration changes
    private disposables: vscode.Disposable[] = [];

    // For debouncing
    private scanTimeout: NodeJS.Timeout | undefined = undefined;
    private readonly debounceDelay = 500; // ms

    constructor() {
        // Read the configuration
        this.updateConfiguration();

        // Listen for configuration changes
        this.disposables.push(
            vscode.workspace.onDidChangeConfiguration(e => {
                if (e.affectsConfiguration('kustomizeNavigator.standardFluxVariables')) {
                    this.updateConfiguration();
                }
            })
        );

        // Scan the workspace for variables on initialization
        this.scanWorkspaceForVariables();

        // Set up file watcher to update variables when files change
        const watcher = vscode.workspace.createFileSystemWatcher('**/*.{yaml,yml}');
        this.disposables.push(
            // With debouncing
            watcher.onDidChange(() => this.debouncedScanWorkspace()),
            watcher.onDidCreate(() => this.debouncedScanWorkspace()),
            watcher.onDidDelete(() => this.debouncedScanWorkspace()),
            watcher
        );
    }

    private debouncedScanWorkspace() {
        if (this.scanTimeout) {
            clearTimeout(this.scanTimeout);
        }
        this.scanTimeout = setTimeout(() => {
            this.scanWorkspaceForVariables();
        }, this.debounceDelay);
    }

    private updateConfiguration() {
        const config = vscode.workspace.getConfiguration('kustomizeNavigator');
        this.standardVariables = config.get<string[]>('standardFluxVariables', [
            'cluster_env',
            'cluster_region',
            'cluster_name',
            'namespace',
            'app_name'
        ]);

        // Update workspace variables with the new standard variables
        this.standardVariables.forEach(variable => {
            this.workspaceVariables.add(variable);
        });
    }

    public async provideCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken
    ): Promise<vscode.CompletionItem[]> {
        // Get the current line text up to the cursor
        const linePrefix = document.lineAt(position).text.substring(0, position.character);

        // Check if we're typing a variable
        if (!linePrefix.endsWith('${')) {
            return [];
        }

        const completionItems: vscode.CompletionItem[] = [];

        // Add standard variables
        for (const variable of this.standardVariables) {
            const item = new vscode.CompletionItem(variable, vscode.CompletionItemKind.Variable);
            item.insertText = variable;
            item.detail = 'Flux standard variable';
            item.documentation = new vscode.MarkdownString(`Standard Flux variable: \`${variable}\``);
            completionItems.push(item);

            // Add version with default value
            const itemWithDefault = new vscode.CompletionItem(`${variable}:=default`, vscode.CompletionItemKind.Variable);
            itemWithDefault.insertText = `${variable}:=`;
            itemWithDefault.detail = 'Flux variable with default value';
            itemWithDefault.documentation = new vscode.MarkdownString(
                `Variable with default: \`\${${variable}:=default_value}\``
            );
            completionItems.push(itemWithDefault);
        }

        // Add variables found in the workspace that aren't in the standard list
        for (const variable of this.workspaceVariables) {
            if (!this.standardVariables.includes(variable)) {
                const item = new vscode.CompletionItem(variable, vscode.CompletionItemKind.Variable);
                item.insertText = variable;
                item.detail = 'Flux variable (found in workspace)';
                item.documentation = new vscode.MarkdownString(`Workspace-defined variable: \`${variable}\``);
                completionItems.push(item);

                // Add version with default value
                const itemWithDefault = new vscode.CompletionItem(`${variable}:=default`, vscode.CompletionItemKind.Variable);
                itemWithDefault.insertText = `${variable}:=`;
                itemWithDefault.detail = 'Flux variable with default value';
                itemWithDefault.documentation = new vscode.MarkdownString(
                    `Variable with default: \`\${${variable}:=default_value}\``
                );
                completionItems.push(itemWithDefault);
            }
        }

        return completionItems;
    }

    private async scanWorkspaceForVariables() {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            return;
        }

        // Reset workspace variables
        this.workspaceVariables.clear();

        // Add standard variables to the set
        for (const variable of this.standardVariables) {
            this.workspaceVariables.add(variable);
        }

        // Find all YAML files and scan for variables
        const yamlFiles = await vscode.workspace.findFiles('**/*.{yaml,yml}', '**/node_modules/**');

        for (const file of yamlFiles) {
            try {
                const content = fs.readFileSync(file.fsPath, 'utf8');
                const variableRegex = /\${([^:}]+)(?::=[^}]*)?}/g;
                let match;

                while ((match = variableRegex.exec(content))) {
                    const variableName = match[1].trim();
                    this.workspaceVariables.add(variableName);
                }
            } catch (error) {
                console.error(`Error scanning file ${file.fsPath} for variables:`, error);
            }
        }
    }

    public dispose() {
        for (const disposable of this.disposables) {
            disposable.dispose();
        }
        if (this.scanTimeout) {
            clearTimeout(this.scanTimeout);
        }
    }
}