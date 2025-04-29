// fluxDiagnostics.ts
import * as vscode from 'vscode';
import * as yaml from 'js-yaml';

export class FluxDiagnosticProvider {
    private diagnosticCollection: vscode.DiagnosticCollection;
    
    constructor() {
        this.diagnosticCollection = vscode.languages.createDiagnosticCollection('flux-kustomize');
        
        // Register event handlers
        vscode.workspace.onDidOpenTextDocument(this.analyzeDiagnostics, this);
        vscode.workspace.onDidChangeTextDocument(e => this.analyzeDiagnostics(e.document), this);
        vscode.workspace.onDidCloseTextDocument(doc => {
            this.diagnosticCollection.delete(doc.uri);
        }, this);
        
        // Analyze open documents
        vscode.workspace.textDocuments.forEach(this.analyzeDiagnostics, this);
    }
    
    private analyzeDiagnostics(document: vscode.TextDocument) {
        // Only process YAML files
        if (!document.fileName.endsWith('.yaml') && !document.fileName.endsWith('.yml')) {
            return;
        }
        
        const diagnostics: vscode.Diagnostic[] = [];
        
        try {
            const content = document.getText();
            
            // Check for variable substitution issues
            this.checkVariableSubstitution(document, content, diagnostics);
            
            // Check for common Flux issues
            if (document.fileName.includes('kustomization')) {
                this.checkFluxKustomization(document, content, diagnostics);
            }
            
            // Update diagnostics
            this.diagnosticCollection.set(document.uri, diagnostics);
            
        } catch (error) {
            console.error(`Error analyzing diagnostics for ${document.fileName}:`, error);
        }
    }
    
    private checkVariableSubstitution(
        document: vscode.TextDocument,
        content: string,
        diagnostics: vscode.Diagnostic[]
    ) {
        const variableRegex = /\${([^}]*)}/g;
        let match;
        
        while ((match = variableRegex.exec(content))) {
            const variableContent = match[1];
            const startPos = document.positionAt(match.index);
            const endPos = document.positionAt(match.index + match[0].length);
            const range = new vscode.Range(startPos, endPos);
            
            // Check for empty variables
            if (!variableContent.trim()) {
                const diagnostic = new vscode.Diagnostic(
                    range,
                    'Empty variable substitution',
                    vscode.DiagnosticSeverity.Error
                );
                diagnostic.source = 'Flux Kustomize';
                diagnostics.push(diagnostic);
                continue;
            }
            
            // Check for invalid default value syntax
            if (variableContent.includes(':=')) {
                const parts = variableContent.split(':=');
                if (parts.length > 2) {
                    const diagnostic = new vscode.Diagnostic(
                        range,
                        'Invalid default value syntax. Use ${var:=default}',
                        vscode.DiagnosticSeverity.Warning
                    );
                    diagnostic.source = 'Flux Kustomize';
                    diagnostics.push(diagnostic);
                }
            }
        }
    }
    
    private checkFluxKustomization(
        document: vscode.TextDocument,
        content: string,
        diagnostics: vscode.Diagnostic[]
    ) {
        try {
            const parsed = yaml.load(content) as any;
            
            // Check for required fields in Flux Kustomization
            if (parsed && 
                parsed.apiVersion === 'kustomize.toolkit.fluxcd.io/v1beta2' && 
                parsed.kind === 'Kustomization') {
                
                // Check for missing required fields
                const requiredFields = ['spec', 'metadata.name', 'metadata.namespace'];
                for (const field of requiredFields) {
                    const parts = field.split('.');
                    let current = parsed;
                    let missing = false;
                    
                    for (const part of parts) {
                        if (!current || !current[part]) {
                            missing = true;
                            break;
                        }
                        current = current[part];
                    }
                    
                    if (missing) {
                        // Find the position for the diagnostic (approximate)
                        let pos;
                        if (field.startsWith('spec')) {
                            pos = content.indexOf('spec:');
                        } else if (field.startsWith('metadata')) {
                            pos = content.indexOf('metadata:');
                        } else {
                            pos = 0;
                        }
                        
                        if (pos === -1) pos = 0;
                        
                        const startPos = document.positionAt(pos);
                        const range = new vscode.Range(startPos, startPos.translate(0, field.length));
                        
                        const diagnostic = new vscode.Diagnostic(
                            range,
                            `Missing required field: ${field}`,
                            vscode.DiagnosticSeverity.Error
                        );
                        diagnostic.source = 'Flux Kustomize';
                        diagnostics.push(diagnostic);
                    }
                }
                
                // Check if path is specified in spec
                if (parsed.spec && !parsed.spec.path) {
                    const specPos = content.indexOf('spec:');
                    if (specPos !== -1) {
                        const startPos = document.positionAt(specPos);
                        const range = new vscode.Range(startPos, startPos.translate(0, 20));
                        
                        const diagnostic = new vscode.Diagnostic(
                            range,
                            'Missing required field: spec.path',
                            vscode.DiagnosticSeverity.Error
                        );
                        diagnostic.source = 'Flux Kustomize';
                        diagnostics.push(diagnostic);
                    }
                }
            }
        } catch (error) {
            console.error(`Error checking Flux Kustomization in ${document.fileName}:`, error);
        }
    }
    
    public dispose() {
        this.diagnosticCollection.dispose();
    }
}