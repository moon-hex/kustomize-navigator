import * as vscode from 'vscode';
import * as path from 'path';
import { KustomizeParser } from './kustomizeParser';
import { YamlUtils } from './yamlUtils';

export class KustomizeReferencesView {
    private readonly referencesTreeProvider: ReferencesTreeDataProvider;
    private treeView: vscode.TreeView<ReferenceItem>;
    private statusBarItem: vscode.StatusBarItem;
    
    constructor(private parser: KustomizeParser) {
        this.referencesTreeProvider = new ReferencesTreeDataProvider(parser);
        
        // Create the tree view
        this.treeView = vscode.window.createTreeView('kustomizeReferences', {
            treeDataProvider: this.referencesTreeProvider,
            showCollapseAll: true
        });
        
        // Create status bar item
        this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
        this.statusBarItem.command = 'workbench.view.explorer';

        // Update the tree view when the active editor changes
        vscode.window.onDidChangeActiveTextEditor(editor => {
            if (editor) {
                this.referencesTreeProvider.refresh(editor.document.uri);
                this.updateStatusBar(editor);
            }
        });
        
        // Update when the document is saved
        vscode.workspace.onDidSaveTextDocument(document => {
            this.referencesTreeProvider.refresh(document.uri);
            if (vscode.window.activeTextEditor && 
                vscode.window.activeTextEditor.document.uri.fsPath === document.uri.fsPath) {
                this.updateStatusBar(vscode.window.activeTextEditor);
            }
        });
        
        // Attempt to set initial file if there's an active editor
        if (vscode.window.activeTextEditor) {
            this.referencesTreeProvider.refresh(vscode.window.activeTextEditor.document.uri);
            this.updateStatusBar(vscode.window.activeTextEditor);
        }
    }
    
    private async updateStatusBar(editor: vscode.TextEditor | undefined): Promise<void> {
        if (!editor) {
            this.statusBarItem.hide();
            return;
        }
        
        const filePath = editor.document.uri.fsPath;
        
        // Check if this is a YAML file
        if (!filePath.endsWith('.yaml') && !filePath.endsWith('.yml')) {
            this.statusBarItem.hide();
            return;
        }
        
        const backRefs = this.parser.getBackReferencesForFile(filePath) || [];
        
        // Get document count for current file
        const fileContent = editor.document.getText();
        const yamlDocuments = YamlUtils.parseMultipleYamlDocuments(fileContent);
        const docCount = yamlDocuments.length;
        
        if (backRefs.length > 0) {
            // Get total document count from referencing files
            const refDocCounts = await Promise.all(backRefs.map(async ref => {
                const refContent = await vscode.workspace.fs.readFile(vscode.Uri.file(ref.path));
                const refDocs = YamlUtils.parseMultipleYamlDocuments(refContent.toString());
                return refDocs.length;
            }));
            const totalRefDocs = refDocCounts.reduce((sum, count) => sum + count, 0);
            
            this.statusBarItem.text = `$(references) ${backRefs.length} References (${totalRefDocs} total docs)`;
            this.statusBarItem.tooltip = `This file (${docCount} doc${docCount > 1 ? 's' : ''}) is referenced by ${backRefs.length} Kustomize files`;
            this.statusBarItem.show();
        } else {
            // Still show document count even if no references
            if (docCount > 1) {
                this.statusBarItem.text = `$(file-code) ${docCount} YAML Documents`;
                this.statusBarItem.tooltip = `This file contains ${docCount} YAML documents`;
                this.statusBarItem.show();
            } else {
                this.statusBarItem.hide();
            }
        }
    }
    
    public refresh(): void {
        this.referencesTreeProvider.refresh();
        if (vscode.window.activeTextEditor) {
            this.updateStatusBar(vscode.window.activeTextEditor);
        }
    }
    
    public dispose(): void {
        this.treeView.dispose();
        this.statusBarItem.dispose();
    }
}

// Tree item representing a reference
class ReferenceItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly resourceUri: vscode.Uri,
        public readonly contextValue: string,
        public readonly children?: ReferenceItem[],
        public readonly fullPath?: string | { path: string; type: 'flux' | 'k8s' },
        public readonly documentCount?: number,
        public readonly referenceType?: 'flux' | 'k8s'
    ) {
        super(label, collapsibleState);
        this.tooltip = this.getTooltip();
        this.description = this.getDescription();
        this.iconPath = this.getIconPath();

        // Add command for non-category items to make them clickable
        if (contextValue !== 'category') {
            this.command = {
                command: 'vscode.open',
                title: 'Open File',
                arguments: [resourceUri]
            };
        }
    }

    private getTooltip(): string {
        if (this.contextValue === 'category') {
            return this.label;
        }
        const typeInfo = this.referenceType ? ` (${this.referenceType.toUpperCase()} Kustomization)` : '';
        const docInfo = this.documentCount ? `\nContains ${this.documentCount} YAML document${this.documentCount > 1 ? 's' : ''}` : '';
        const pathInfo = typeof this.fullPath === 'string' ? this.fullPath : this.fullPath?.path;
        return `${this.label}${typeInfo}${docInfo}\nPath: ${pathInfo}`;
    }

    private getDescription(): string {
        if (this.contextValue === 'category') {
            return '';
        }
        const typeBadge = this.referenceType ? `[${this.referenceType.toUpperCase()}] ` : '';
        const docBadge = this.documentCount ? `(${this.documentCount} doc${this.documentCount > 1 ? 's' : ''})` : '';
        return `${typeBadge}${docBadge}`;
    }

    private getIconPath(): vscode.ThemeIcon | undefined {
        switch (this.contextValue) {
            case 'category':
                return new vscode.ThemeIcon('folder');
            case 'kustomization':
                return new vscode.ThemeIcon('file-code');
            default:
                return undefined;
        }
    }
}

// TreeDataProvider implementation
class ReferencesTreeDataProvider implements vscode.TreeDataProvider<ReferenceItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<ReferenceItem | undefined> = new vscode.EventEmitter<ReferenceItem | undefined>();
    readonly onDidChangeTreeData: vscode.Event<ReferenceItem | undefined> = this._onDidChangeTreeData.event;
    
    private currentFile: vscode.Uri | undefined;
    
    constructor(private parser: KustomizeParser) {}
    
    public refresh(uri?: vscode.Uri): void {
        if (uri) {
            this.currentFile = uri;
        }
        this._onDidChangeTreeData.fire(undefined);
    }
    
    getTreeItem(element: ReferenceItem): vscode.TreeItem {
        return element;
    }
    
    getChildren(element?: ReferenceItem): Thenable<ReferenceItem[]> {
        if (!this.currentFile) {
            return Promise.resolve([]);
        }
        
        // If this is the root level
        if (!element) {
            return this.getRootItems();
        }
        
        // If this is a category with children
        if (element.children) {
            return Promise.resolve(element.children);
        }
        
        return Promise.resolve([]);
    }
    
    private async getRootItems(): Promise<ReferenceItem[]> {
        const items: ReferenceItem[] = [];
        
        if (!this.currentFile) {
            return items;
        }
        
        const filePath = this.currentFile.fsPath;
        
        // Get backward references (files that reference this file)
        const backRefs = this.parser.getBackReferencesForFile(filePath) || [];
        
        if (backRefs.length > 0) {
            // Separate Flux and K8s references
            const fluxRefs = backRefs.filter(ref => ref.type === 'flux');
            const k8sRefs = backRefs.filter(ref => ref.type === 'k8s');

            // Process Flux references
            if (fluxRefs.length > 0) {
                const fluxChildren = await Promise.all(fluxRefs.map(async ref => {
                    const filename = path.basename(ref.path);
                    const folderName = path.basename(path.dirname(ref.path));
                    const displayName = `${folderName}/${filename}`;
                    
                    // Get document count for the file
                    const fileContent = await vscode.workspace.fs.readFile(vscode.Uri.file(ref.path));
                    const yamlDocuments = YamlUtils.parseMultipleYamlDocuments(fileContent.toString());
                    const docCount = yamlDocuments.length;
                    
                    return new ReferenceItem(
                        displayName,
                        vscode.TreeItemCollapsibleState.None,
                        vscode.Uri.file(ref.path),
                        'kustomization',
                        undefined,
                        { path: ref.path, type: 'flux' },
                        docCount,
                        'flux'
                    );
                }));
                
                // Add Flux references category with total document count
                const totalFluxDocs = fluxChildren.reduce((sum, item) => sum + (item.documentCount || 1), 0);
                items.push(new ReferenceItem(
                    `Referenced by Flux (${fluxRefs.length} files, ${totalFluxDocs} total documents)`,
                    vscode.TreeItemCollapsibleState.Expanded,
                    this.currentFile,
                    'category',
                    fluxChildren
                ));
            }

            // Process K8s references
            if (k8sRefs.length > 0) {
                const k8sChildren = await Promise.all(k8sRefs.map(async ref => {
                    const filename = path.basename(ref.path);
                    const folderName = path.basename(path.dirname(ref.path));
                    const displayName = `${folderName}/${filename}`;
                    
                    // Get document count for the file
                    const fileContent = await vscode.workspace.fs.readFile(vscode.Uri.file(ref.path));
                    const yamlDocuments = YamlUtils.parseMultipleYamlDocuments(fileContent.toString());
                    const docCount = yamlDocuments.length;
                    
                    return new ReferenceItem(
                        displayName,
                        vscode.TreeItemCollapsibleState.None,
                        vscode.Uri.file(ref.path),
                        'kustomization',
                        undefined,
                        { path: ref.path, type: 'k8s' },
                        docCount,
                        'k8s'
                    );
                }));
                
                // Add K8s references category with total document count
                const totalK8sDocs = k8sChildren.reduce((sum, item) => sum + (item.documentCount || 1), 0);
                items.push(new ReferenceItem(
                    `Referenced by K8s (${k8sRefs.length} files, ${totalK8sDocs} total documents)`,
                    vscode.TreeItemCollapsibleState.Expanded,
                    this.currentFile,
                    'category',
                    k8sChildren
                ));
            }
        }
        
        return items;
    }
}