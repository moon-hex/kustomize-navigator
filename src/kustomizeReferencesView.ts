import * as vscode from 'vscode';
import * as path from 'path';
import { KustomizeParser } from './kustomizeParser';

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
    
    private updateStatusBar(editor: vscode.TextEditor | undefined): void {
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
        
        if (backRefs.length > 0) {
            this.statusBarItem.text = `$(references) ${backRefs.length} References`;
            this.statusBarItem.tooltip = `This file is referenced by ${backRefs.length} Kustomize files`;
            this.statusBarItem.show();
        } else {
            this.statusBarItem.hide();
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
        public readonly contextValue?: string,
        public readonly children?: ReferenceItem[],
        public readonly description?: string
    ) {
        super(label, collapsibleState);
        this.tooltip = description || resourceUri.fsPath;
        
        // Only add command for non-category items
        if (contextValue !== 'category') {
            this.command = {
                command: 'vscode.open',
                title: 'Open File',
                arguments: [resourceUri]
            };
        }
        
        // Add appropriate icons
        if (this.contextValue === 'kustomization') {
            this.iconPath = new vscode.ThemeIcon('extensions');
        } else if (this.contextValue === 'resource') {
            this.iconPath = new vscode.ThemeIcon('file-code');
        } else if (this.contextValue === 'category') {
            this.iconPath = new vscode.ThemeIcon('folder');
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
    
    private getRootItems(): Thenable<ReferenceItem[]> {
        const items: ReferenceItem[] = [];
        
        if (!this.currentFile) {
            return Promise.resolve(items);
        }
        
        const filePath = this.currentFile.fsPath;
        
        // Check if this is a kustomization file
        if (this.parser.isKustomizationFile(filePath)) {
            // Get forward references (files this kustomization references)
            const forwardRefs = this.parser.getReferencesForFile(filePath) || [];
            
            if (forwardRefs.length > 0) {
                // Group references by type
                const kustomizationRefs: string[] = [];
                const resourceRefs: string[] = [];
                
                forwardRefs.forEach(ref => {
                    if (this.parser.isKustomizationFile(ref)) {
                        kustomizationRefs.push(ref);
                    } else {
                        resourceRefs.push(ref);
                    }
                });
                
                // Create children for kustomization references
                const kustomizationChildren = kustomizationRefs.map(ref => {
                    const filename = path.basename(ref);
                    const folderName = path.basename(path.dirname(ref));
                    const displayName = `${folderName}/${filename}`;
                    
                    return new ReferenceItem(
                        displayName,
                        vscode.TreeItemCollapsibleState.None,
                        vscode.Uri.file(ref),
                        'kustomization',
                        undefined,
                        ref
                    );
                });
                
                // Create children for resource references
                const resourceChildren = resourceRefs.map(ref => {
                    return new ReferenceItem(
                        path.basename(ref),
                        vscode.TreeItemCollapsibleState.None,
                        vscode.Uri.file(ref),
                        'resource',
                        undefined,
                        ref
                    );
                });
                
                // Add kustomization references category if there are any
                if (kustomizationChildren.length > 0) {
                    items.push(new ReferenceItem(
                        `Kustomization References (${kustomizationChildren.length})`,
                        vscode.TreeItemCollapsibleState.Expanded,
                        this.currentFile,
                        'category',
                        kustomizationChildren
                    ));
                }
                
                // Add resource references category if there are any
                if (resourceChildren.length > 0) {
                    items.push(new ReferenceItem(
                        `Resource References (${resourceChildren.length})`,
                        vscode.TreeItemCollapsibleState.Expanded,
                        this.currentFile,
                        'category',
                        resourceChildren
                    ));
                }
            }
            
            // Get backward references (files that reference this kustomization)
            const backRefs = this.parser.getBackReferencesForFile(filePath) || [];
            
            if (backRefs.length > 0) {
                const backChildren = backRefs.map(ref => {
                    const filename = path.basename(ref);
                    const folderName = path.basename(path.dirname(ref));
                    const displayName = `${folderName}/${filename}`;
                    
                    return new ReferenceItem(
                        displayName,
                        vscode.TreeItemCollapsibleState.None,
                        vscode.Uri.file(ref),
                        'kustomization',
                        undefined,
                        ref
                    );
                });
                
                // Add backward references category
                items.push(new ReferenceItem(
                    `Referenced By (${backRefs.length})`,
                    vscode.TreeItemCollapsibleState.Expanded,
                    this.currentFile,
                    'category',
                    backChildren
                ));
            }
        } else {
            // For non-kustomization files, just show what references them
            const backRefs = this.parser.getBackReferencesForFile(filePath) || [];
            
            if (backRefs.length > 0) {
                const backChildren = backRefs.map(ref => {
                    const filename = path.basename(ref);
                    const folderName = path.basename(path.dirname(ref));
                    const displayName = `${folderName}/${filename}`;
                    
                    return new ReferenceItem(
                        displayName,
                        vscode.TreeItemCollapsibleState.None,
                        vscode.Uri.file(ref),
                        'kustomization',
                        undefined,
                        ref
                    );
                });
                
                // Add backward references category
                items.push(new ReferenceItem(
                    `Referenced By (${backRefs.length})`,
                    vscode.TreeItemCollapsibleState.Expanded,
                    this.currentFile,
                    'category',
                    backChildren
                ));
            }
        }
        
        // If no items were created, show a message
        if (items.length === 0) {
            const noReferencesItem = new ReferenceItem(
                'No references found',
                vscode.TreeItemCollapsibleState.None,
                this.currentFile,
                'message'
            );
            items.push(noReferencesItem);
        }
        
        return Promise.resolve(items);
    }
}