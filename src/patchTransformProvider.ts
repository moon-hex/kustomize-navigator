// patchTransformProvider.ts
import * as vscode from 'vscode';
import * as yaml from 'js-yaml';
import * as fs from 'fs';
import * as path from 'path';

export class PatchTransformProvider implements vscode.CodeActionProvider {
    public static readonly providedCodeActionKinds = [
        vscode.CodeActionKind.QuickFix
    ];

    public provideCodeActions(
        document: vscode.TextDocument,
        range: vscode.Range | vscode.Selection,
        context: vscode.CodeActionContext,
        token: vscode.CancellationToken
    ): vscode.CodeAction[] {
        const actions: vscode.CodeAction[] = [];

        // Check if any diagnostics are for deprecated patches
        for (const diagnostic of context.diagnostics) {
            if (diagnostic.code === 'deprecated-patchesStrategicMerge' || 
                diagnostic.code === 'deprecated-patchesJson6902') {
                
                const action = this.createTransformAction(document, diagnostic);
                if (action) {
                    actions.push(action);
                }
            }
        }

        return actions;
    }

    private createTransformAction(
        document: vscode.TextDocument,
        diagnostic: vscode.Diagnostic
    ): vscode.CodeAction | null {
        const text = document.getText();
        let parsed: any;

        try {
            parsed = yaml.load(text);
        } catch (error) {
            return null;
        }

        if (!parsed) {
            return null;
        }

        const isFluxKustomization = parsed.apiVersion?.startsWith('kustomize.toolkit.fluxcd.io/') && 
                                   parsed.kind === 'Kustomization';

        const target = isFluxKustomization ? parsed.spec : parsed;

        if (!target) {
            return null;
        }

        // Transform patchesStrategicMerge
        if (diagnostic.code === 'deprecated-patchesStrategicMerge' && 
            target.patchesStrategicMerge && 
            Array.isArray(target.patchesStrategicMerge)) {
            
            const action = new vscode.CodeAction(
                'Convert patchesStrategicMerge to patches',
                vscode.CodeActionKind.QuickFix
            );
            action.diagnostics = [diagnostic];
            action.isPreferred = true;
            action.edit = new vscode.WorkspaceEdit();

            // Build the new patches array
            const existingPatches = target.patches || [];
            const newPatches = [...existingPatches];

            // Convert each patchesStrategicMerge entry to patches format
            // patchesStrategicMerge: [patch.yaml] -> patches: [patch.yaml]
            for (const patch of target.patchesStrategicMerge) {
                if (typeof patch === 'string') {
                    // Simple string format - keep as is
                    newPatches.push(patch);
                }
            }

            // Update the YAML content
            const updatedText = this.transformYaml(text, {
                removeField: 'patchesStrategicMerge',
                addPatches: newPatches
            }, isFluxKustomization);

            if (updatedText) {
                action.edit.replace(document.uri, new vscode.Range(0, 0, document.lineCount, 0), updatedText);
            }

            return action;
        }

        // Transform patchesJson6902
        if (diagnostic.code === 'deprecated-patchesJson6902' && 
            target.patchesJson6902 && 
            Array.isArray(target.patchesJson6902)) {
            
            const action = new vscode.CodeAction(
                'Convert patchesJson6902 to patches',
                vscode.CodeActionKind.QuickFix
            );
            action.diagnostics = [diagnostic];
            action.isPreferred = true;
            action.edit = new vscode.WorkspaceEdit();

            // Build the new patches array
            const existingPatches = target.patches || [];
            const newPatches = [...existingPatches];

            // Convert each patchesJson6902 entry to patches format
            // patchesJson6902: [{path: ..., target: ...}] -> patches: [{path: ..., target: ...}]
            for (const patch of target.patchesJson6902) {
                if (patch && typeof patch === 'object') {
                    // Already in correct format, just move it
                    newPatches.push(patch);
                }
            }

            // Update the YAML content
            const updatedText = this.transformYaml(text, {
                removeField: 'patchesJson6902',
                addPatches: newPatches
            }, isFluxKustomization);

            if (updatedText) {
                action.edit.replace(document.uri, new vscode.Range(0, 0, document.lineCount, 0), updatedText);
            }

            return action;
        }

        return null;
    }

    private transformYaml(
        originalText: string,
        updates: { removeField?: string; addPatches?: any[] },
        isFluxKustomization: boolean
    ): string | null {
        try {
            const parsed = yaml.load(originalText) as any;
            if (!parsed) {
                return null;
            }

            const target = isFluxKustomization ? parsed.spec : parsed;
            if (!target) {
                return null;
            }

            // Remove deprecated field
            if (updates.removeField && target[updates.removeField]) {
                delete target[updates.removeField];
            }

            // Merge patches
            if (updates.addPatches && updates.addPatches.length > 0) {
                const existingPatches = target.patches || [];
                const newPatches = updates.addPatches;
                
                // Only add patches that don't already exist
                const uniquePatches = [...existingPatches];
                for (const newPatch of newPatches) {
                    const exists = uniquePatches.some(existing => {
                        if (typeof existing === 'string' && typeof newPatch === 'string') {
                            return existing === newPatch;
                        }
                        if (typeof existing === 'object' && typeof newPatch === 'object') {
                            return existing.path === newPatch.path;
                        }
                        return false;
                    });
                    if (!exists) {
                        uniquePatches.push(newPatch);
                    }
                }
                target.patches = uniquePatches.length > 0 ? uniquePatches : undefined;
            }

            // Generate updated YAML preserving structure
            const options: yaml.DumpOptions = {
                indent: 2,
                lineWidth: -1,
                quotingType: '"',
                skipInvalid: false,
                sortKeys: false,
                noRefs: true
            };

            return yaml.dump(parsed, options);
        } catch (error) {
            console.error('Error transforming YAML:', error);
            return null;
        }
    }
}

