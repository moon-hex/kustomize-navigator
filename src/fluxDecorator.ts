// fluxDecorator.ts
import * as vscode from 'vscode';

export class FluxVariableDecorator {
    private decorationType: vscode.TextEditorDecorationType; // Remove 'readonly'
    private readonly variablePattern = /\${([^}]+)}/g;
    private disposables: vscode.Disposable[] = [];
    
    constructor() {
        // Initialize the decoration type
        this.decorationType = this.createDecorationType();
        
        // Register handlers for document and editor events
        this.registerEventHandlers();
        
        // Listen for configuration changes
        this.disposables.push(
            vscode.workspace.onDidChangeConfiguration(e => {
                if (e.affectsConfiguration('kustomizeNavigator.fluxVariableColor')) {
                    // Dispose of the old decoration type
                    const oldDecorationType = this.decorationType;
                    
                    // Create a new decoration type with the updated color
                    this.decorationType = this.createDecorationType();
                    
                    // Update decorations for all visible editors
                    vscode.window.visibleTextEditors.forEach(editor => {
                        this.updateDecorations(editor);
                    });
                    
                    // Dispose of the old decoration type after updating
                    oldDecorationType.dispose();
                }
            })
        );
    }
    
    // Helper method to create a decoration type with current config
    private createDecorationType(): vscode.TextEditorDecorationType {
        const config = vscode.workspace.getConfiguration('kustomizeNavigator');
        const highlightColor = config.get<string>('fluxVariableColor', '#3498db');
        
        return vscode.window.createTextEditorDecorationType({
            color: highlightColor,
            fontWeight: 'bold',
            border: `1px dotted ${highlightColor}`,
            backgroundColor: `${highlightColor}14` // 14 is hex for 8% opacity
        });
    }
    
    private registerEventHandlers() {
        // Update decorations when the active editor changes
        this.disposables.push(
            vscode.window.onDidChangeActiveTextEditor(editor => {
                if (editor) {
                    this.updateDecorations(editor);
                }
            })
        );
        
        // Update decorations when the document changes
        this.disposables.push(
            vscode.workspace.onDidChangeTextDocument(event => {
                const editor = vscode.window.activeTextEditor;
                if (editor && event.document === editor.document) {
                    this.updateDecorations(editor);
                }
            })
        );
        
        // Update decorations for the current editor on startup
        if (vscode.window.activeTextEditor) {
            this.updateDecorations(vscode.window.activeTextEditor);
        }
    }
    
    private updateDecorations(editor: vscode.TextEditor) {
        // Skip non-YAML files
        if (!editor.document.fileName.endsWith('.yaml') && !editor.document.fileName.endsWith('.yml')) {
            return;
        }
        
        const text = editor.document.getText();
        const decorations: vscode.DecorationOptions[] = [];
        
        let match;
        while ((match = this.variablePattern.exec(text))) {
            const startPos = editor.document.positionAt(match.index);
            const endPos = editor.document.positionAt(match.index + match[0].length);
            
            const decoration = {
                range: new vscode.Range(startPos, endPos),
                hoverMessage: this.createHoverMessage(match[1])
            };
            
            decorations.push(decoration);
        }
        
        editor.setDecorations(this.decorationType, decorations);
    }
    
    private createHoverMessage(variableContent: string): vscode.MarkdownString {
        const hoverMessage = new vscode.MarkdownString();
        
        // Extract variable name and default value if present
        const parts = variableContent.split(':=');
        const variableName = parts[0].trim();
        const defaultValue = parts.length > 1 ? parts[1].trim() : 'undefined';
        
        hoverMessage.appendMarkdown(`### Flux Variable Substitution\n\n`);
        hoverMessage.appendMarkdown(`**Variable:** \`${variableName}\`\n\n`);
        
        if (parts.length > 1) {
            hoverMessage.appendMarkdown(`**Default Value:** \`${defaultValue}\`\n\n`);
        }
        
        hoverMessage.appendMarkdown(`*This variable will be substituted during Flux's post-build phase.*\n\n`);
        hoverMessage.appendMarkdown(`[Flux Documentation](https://fluxcd.io/flux/components/kustomize/kustomization/#variable-substitution)`);
        
        return hoverMessage;
    }
    
    public dispose() {
        this.decorationType.dispose();
        for (const disposable of this.disposables) {
            disposable.dispose();
        }
    }
}