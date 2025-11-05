// fluxDecorator.ts
import * as vscode from 'vscode';
import * as path from 'path';
import { KustomizeParser } from './kustomizeParser';

export class FluxVariableDecorator {
    private variableDecorationType!: vscode.TextEditorDecorationType;
    private defaultValueDecorationType!: vscode.TextEditorDecorationType;
    private kustomizeDecorationType!: vscode.TextEditorDecorationType;
    private fluxDecorationType!: vscode.TextEditorDecorationType;
    private readonly variablePattern = /\${([^}]+)}/g;
    private disposables: vscode.Disposable[] = [];
    
    constructor(private parser?: KustomizeParser) {
        // Initialize the decoration types
        this.createDecorationTypes();
        
        // Register handlers for document and editor events
        this.registerEventHandlers();
        
        // Listen for configuration changes
        this.disposables.push(
            vscode.workspace.onDidChangeConfiguration(e => {
                if (e.affectsConfiguration('kustomizeNavigator.fluxVariableColor') ||
                    e.affectsConfiguration('kustomizeNavigator.fluxDefaultValueColor') ||
                    e.affectsConfiguration('kustomizeNavigator.fluxApiColor') ||
                    e.affectsConfiguration('kustomizeNavigator.kustomizeApiColor')) {
                    
                    // Dispose of the old decoration types
                    this.disposeDecorationTypes();
                    
                    // Create new decoration types with the updated colors
                    this.createDecorationTypes();
                    
                    // Update decorations for all visible editors
                    vscode.window.visibleTextEditors.forEach(editor => {
                        this.updateDecorations(editor);
                    });
                }
            })
        );
        
        // Listen for theme changes to adjust contrast
        this.disposables.push(
            vscode.window.onDidChangeActiveColorTheme(() => {
                // Dispose of the old decoration types
                this.disposeDecorationTypes();
                
                // Create new decoration types with the updated theme settings
                this.createDecorationTypes();
                
                // Update decorations for all visible editors
                vscode.window.visibleTextEditors.forEach(editor => {
                    this.updateDecorations(editor);
                });
            })
        );
    }
    
    // Helper method to create decoration types with current config
    private createDecorationTypes(): void {
        const config = vscode.workspace.getConfiguration('kustomizeNavigator');
        const isDarkTheme = vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Dark;
        
        // Variable colors
        const variableColor = config.get<string>('fluxVariableColor', '#3498db');
        const defaultValueColor = config.get<string>('fluxDefaultValueColor', '#e67e22');
        
        // API version colors
        const kustomizeApiColor = config.get<string>('kustomizeApiColor', '#27ae60');
        const fluxApiColor = config.get<string>('fluxApiColor', '#e74c3c');
        
        // Adjust opacity based on theme
        const variableOpacity = isDarkTheme ? '08' : '14'; // Hex values: 8% for dark, 14% for light
        const borderOpacity = isDarkTheme ? '40' : '80';   // Hex values: 25% for dark, 50% for light
        
        // Variable decoration
        this.variableDecorationType = vscode.window.createTextEditorDecorationType({
            color: variableColor,
            fontWeight: 'bold',
            border: `1px dotted ${variableColor}${borderOpacity}`,
            backgroundColor: `${variableColor}${variableOpacity}`
        });
        
        // Default value decoration
        this.defaultValueDecorationType = vscode.window.createTextEditorDecorationType({
            color: defaultValueColor,
            fontWeight: 'bold',
            fontStyle: 'italic',
            backgroundColor: `${defaultValueColor}${variableOpacity}`
        });
        
        // Kustomize API version decoration (dynamic content via renderOptions)
        this.kustomizeDecorationType = vscode.window.createTextEditorDecorationType({
            // Note: Actual content is set via renderOptions in decoration options
        });
        
        // Flux API version decoration (dynamic content via renderOptions)
        this.fluxDecorationType = vscode.window.createTextEditorDecorationType({
            // Note: Actual content is set via renderOptions in decoration options
        });
    }
    
    private disposeDecorationTypes(): void {
        this.variableDecorationType.dispose();
        this.defaultValueDecorationType.dispose();
        this.kustomizeDecorationType.dispose();
        this.fluxDecorationType.dispose();
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
        const variableDecorations: vscode.DecorationOptions[] = [];
        const defaultValueDecorations: vscode.DecorationOptions[] = [];
        const kustomizeApiDecorations: vscode.DecorationOptions[] = [];
        const fluxApiDecorations: vscode.DecorationOptions[] = [];
        
        // Find and decorate variables
        let match;
        while ((match = this.variablePattern.exec(text))) {
            const variableContent = match[1];
            const fullMatch = match[0]; // Entire ${...} expression
            
            // Check if variable has a default value
            if (variableContent.includes(':=')) {
                // Split into variable name and default value
                const parts = variableContent.split(':=');
                const variableName = parts[0].trim();
                const defaultValue = parts[1].trim();
                
                // Position for the variable name part
                const varNameStartPos = editor.document.positionAt(match.index + 2); // Skip ${
                const varNameEndPos = editor.document.positionAt(match.index + 2 + variableName.length);
                
                // Position for the default value part including the := separator
                const defaultStartPos = editor.document.positionAt(match.index + 2 + variableName.length);
                const defaultEndPos = editor.document.positionAt(match.index + fullMatch.length - 1); // Skip closing }
                
                // Add decoration for variable name
                variableDecorations.push({
                    range: new vscode.Range(varNameStartPos, varNameEndPos),
                    hoverMessage: this.createHoverMessage(variableContent)
                });
                
                // Add decoration for default value with different styling
                defaultValueDecorations.push({
                    range: new vscode.Range(defaultStartPos, defaultEndPos),
                    hoverMessage: this.createHoverMessage(variableContent)
                });
            } else {
                // If no default value, decorate the whole variable
                const startPos = editor.document.positionAt(match.index);
                const endPos = editor.document.positionAt(match.index + fullMatch.length);
                
                variableDecorations.push({
                    range: new vscode.Range(startPos, endPos),
                    hoverMessage: this.createHoverMessage(variableContent)
                });
            }
        }
        
        // Find and decorate API versions
        const apiVersionPattern = /apiVersion:\s*([^\n\r]+)/g;
        while ((match = apiVersionPattern.exec(text))) {
            const apiVersion = match[1].trim();
            const startPos = editor.document.positionAt(match.index);
            const endPos = editor.document.positionAt(match.index + match[0].length);
            const range = new vscode.Range(startPos, endPos);
            
            // Get back references for this file
            let backRefText = '';
            let backRefHover: vscode.MarkdownString | undefined;
            if (this.parser) {
                const backRefs = this.parser.getBackReferencesForFile(editor.document.fileName);
                if (backRefs.length > 0) {
                    if (backRefs.length === 1) {
                        const refName = path.basename(path.dirname(backRefs[0].path)) + '/' + path.basename(backRefs[0].path);
                        backRefText = ` [Referenced by: ${refName}]`;
                    } else {
                        backRefText = ` [Referenced by: ${backRefs.length} files]`;
                    }
                    backRefHover = this.createBackReferenceHover(backRefs);
                }
            }
            
            // Check what type of API version it is
            if (apiVersion.startsWith('kustomize.config.k8s.io/')) {
                const config = vscode.workspace.getConfiguration('kustomizeNavigator');
                const kustomizeApiColor = config.get<string>('kustomizeApiColor', '#27ae60');
                
                kustomizeApiDecorations.push({
                    range,
                    renderOptions: {
                        after: {
                            contentText: ` [Kustomize]${backRefText}`,
                            color: kustomizeApiColor,
                            margin: '0 0 0 1em'
                        }
                    },
                    hoverMessage: backRefHover
                });
            } else if (apiVersion.startsWith('kustomize.toolkit.fluxcd.io/')) {
                const config = vscode.workspace.getConfiguration('kustomizeNavigator');
                const fluxApiColor = config.get<string>('fluxApiColor', '#e74c3c');
                
                fluxApiDecorations.push({
                    range,
                    renderOptions: {
                        after: {
                            contentText: ` [Flux]${backRefText}`,
                            color: fluxApiColor,
                            margin: '0 0 0 1em'
                        }
                    },
                    hoverMessage: backRefHover
                });
            } else if (backRefText) {
                // For non-kustomization files with back references, add a decoration
                const config = vscode.workspace.getConfiguration('kustomizeNavigator');
                const backRefColor = config.get<string>('kustomizeApiColor', '#27ae60');
                
                kustomizeApiDecorations.push({
                    range,
                    renderOptions: {
                        after: {
                            contentText: backRefText,
                            color: backRefColor,
                            margin: '0 0 0 1em'
                        }
                    },
                    hoverMessage: backRefHover
                });
            }
        }
        
        // Apply decorations
        editor.setDecorations(this.variableDecorationType, variableDecorations);
        editor.setDecorations(this.defaultValueDecorationType, defaultValueDecorations);
        editor.setDecorations(this.kustomizeDecorationType, kustomizeApiDecorations);
        editor.setDecorations(this.fluxDecorationType, fluxApiDecorations);
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

    private createBackReferenceHover(backRefs: Array<{path: string, type: 'flux' | 'k8s'}>): vscode.MarkdownString {
        const hoverMessage = new vscode.MarkdownString();
        hoverMessage.isTrusted = true;
        hoverMessage.supportHtml = true;
        
        hoverMessage.appendMarkdown(`### Referenced by:\n\n`);
        
        backRefs.forEach(ref => {
            const refUri = vscode.Uri.file(ref.path);
            const refName = path.basename(path.dirname(ref.path)) + '/' + path.basename(ref.path);
            hoverMessage.appendMarkdown(`- [\`${refName}\`](${refUri.toString()})\n`);
        });
        
        return hoverMessage;
    }
    
    public dispose() {
        this.disposeDecorationTypes();
        for (const disposable of this.disposables) {
            disposable.dispose();
        }
    }
}