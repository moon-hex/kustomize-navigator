import * as vscode from 'vscode';
import * as path from 'path';
import { KustomizeParser } from './kustomizeParser';

export class KustomizeHoverProvider implements vscode.HoverProvider {
    constructor(private parser: KustomizeParser) {}

    public async provideHover(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken
    ): Promise<vscode.Hover | null> {
        // Get the word at the cursor
        const wordRange = document.getWordRangeAtPosition(position);
        if (!wordRange) {
            return null;
        }
        
        const word = document.getText(wordRange);
        
        // Check if this is a kustomization file
        const isKustomizationFile = this.parser.isKustomizationFile(document.fileName);
        if (!isKustomizationFile) {
            return null;
        }
        
        // Parse the document to find references
        try {
            const content = document.getText();
            const docPath = document.fileName;
            const baseDir = path.dirname(docPath);
            
            // Look for references that match the word under cursor
            const kustomization = this.parser.parseKustomizationFile(docPath);
            if (!kustomization) {
                return null;
            }
            
            // Collect all references from the kustomization file
            const allReferences = [
                ...kustomization.resources,
                ...kustomization.bases,
                ...kustomization.components,
                ...kustomization.patches,
                ...kustomization.patchesStrategicMerge,
                ...kustomization.configurations,
                ...kustomization.crds
            ];
            
            // Find the reference that contains the word
            const reference = allReferences.find(ref => ref.includes(word));
            if (!reference) {
                return null;
            }
            
            // Resolve the reference
            let resolvedPath = path.resolve(baseDir, reference);
            let targetIsKustomization = false;
            
            // If it's a directory, look for kustomization.yaml inside
            if (this.parser.isDirectory(resolvedPath)) {
                const kustomizationPath = path.join(resolvedPath, 'kustomization.yaml');
                const kustomizationPathYml = path.join(resolvedPath, 'kustomization.yml');
                
                if (this.parser.fileExists(kustomizationPath)) {
                    resolvedPath = kustomizationPath;
                    targetIsKustomization = true;
                } else if (this.parser.fileExists(kustomizationPathYml)) {
                    resolvedPath = kustomizationPathYml;
                    targetIsKustomization = true;
                }
            } else if (this.parser.isKustomizationFile(resolvedPath)) {
                targetIsKustomization = true;
            }
            
            // If the target is a kustomization file, parse it to show resources
            if (targetIsKustomization && this.parser.fileExists(resolvedPath)) {
                const targetKustomization = this.parser.parseKustomizationFile(resolvedPath);
                if (!targetKustomization) {
                    return null;
                }
                
                // Create a detailed markdown hover
                const hoverContent = new vscode.MarkdownString();
                hoverContent.isTrusted = true;
                
                hoverContent.appendMarkdown(`## Kustomization: \`${reference}\`\n\n`);
                
                if (targetKustomization.resources.length > 0) {
                    hoverContent.appendMarkdown(`### Resources (${targetKustomization.resources.length})\n`);
                    targetKustomization.resources.forEach(resource => {
                        hoverContent.appendMarkdown(`- \`${resource}\`\n`);
                    });
                    hoverContent.appendMarkdown('\n');
                }
                
                if (targetKustomization.bases.length > 0) {
                    hoverContent.appendMarkdown(`### Bases (${targetKustomization.bases.length})\n`);
                    targetKustomization.bases.forEach(base => {
                        hoverContent.appendMarkdown(`- \`${base}\`\n`);
                    });
                    hoverContent.appendMarkdown('\n');
                }
                
                if (targetKustomization.patches.length > 0 || targetKustomization.patchesStrategicMerge.length > 0) {
                    const patchCount = targetKustomization.patches.length + targetKustomization.patchesStrategicMerge.length;
                    hoverContent.appendMarkdown(`### Patches (${patchCount})\n`);
                    [...targetKustomization.patches, ...targetKustomization.patchesStrategicMerge].forEach(patch => {
                        hoverContent.appendMarkdown(`- \`${patch}\`\n`);
                    });
                    hoverContent.appendMarkdown('\n');
                }
                
                hoverContent.appendMarkdown(`[Open File](${vscode.Uri.file(resolvedPath).toString()})`);
                
                return new vscode.Hover(hoverContent, wordRange);
            }
        } catch (error) {
            console.error('Error providing hover:', error);
        }
        
        return null;
    }
}