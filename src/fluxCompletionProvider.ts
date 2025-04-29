// fluxCompletionProvider.ts
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as yaml from 'js-yaml';

export class FluxCompletionProvider implements vscode.CompletionItemProvider {
    // Standard Flux variables that are often used
    private readonly standardVariables = [
        'cluster_env',
        'cluster_region',
        'cluster_name',
        'namespace',
        'app_name'
    ];
    
    // Keep track of all variables found in the workspace
    private workspaceVariables: Set<string> = new Set();
    
    constructor() {
        // Scan the workspace for variables on initialization
        this.scanWorkspaceForVariables();
        
        // Set up file watcher to update variables when files change
        const watcher = vscode.workspace.createFileSystemWatcher('**/*.{yaml,yml}');
        watcher.onDidChange(() => this.scanWorkspaceForVariables());
        watcher.onDidCreate(() => this.scanWorkspaceForVariables());
        watcher.onDidDelete(() => this.scanWorkspaceForVariables());
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
        
        // Add variables found in the workspace
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
}