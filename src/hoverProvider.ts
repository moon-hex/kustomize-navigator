import * as vscode from 'vscode';
import * as path from 'path';
import { KustomizeParser, KustomizationPatch } from './kustomizeParser';

export class KustomizeHoverProvider implements vscode.HoverProvider {
    constructor(private parser: KustomizeParser) { }

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
            // Find the reference that contains the word
            let matchingReference: string | undefined;

            // First check string references
            const stringReferences = allReferences.filter(ref => typeof ref === 'string') as string[];
            matchingReference = stringReferences.find(ref => ref.includes(word));

            // If no match found, check object references with path property
            if (!matchingReference) {
                const objectReferences = allReferences.filter(ref =>
                    typeof ref === 'object' && ref !== null && 'path' in ref
                ) as KustomizationPatch[];

                const matchingObject = objectReferences.find(ref =>
                    typeof ref.path === 'string' && ref.path.includes(word)
                );

                if (matchingObject && matchingObject.path) {
                    matchingReference = matchingObject.path;
                }
            }

            if (!matchingReference) {
                return null;
            }

            // Resolve the reference
            let resolvedPath = path.resolve(baseDir, matchingReference);
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
                hoverContent.supportHtml = true;  // Enable HTML support
                hoverContent.appendMarkdown(`## Kustomization: \`${reference}\`\n\n`);
                if (targetKustomization.resources.length > 0) {
                    hoverContent.appendMarkdown(`### Resources (${targetKustomization.resources.length})\n`);

                    // Make each resource clickable
                    targetKustomization.resources.forEach(resource => {
                        const resourcePath = path.resolve(path.dirname(resolvedPath), resource);
                        const resourceUri = vscode.Uri.file(resourcePath);
                        hoverContent.appendMarkdown(`- [\`${resource}\`](${resourceUri.toString()})\n`);
                    });
                    hoverContent.appendMarkdown('\n');
                }

                if (targetKustomization.bases.length > 0) {
                    hoverContent.appendMarkdown(`### Bases (${targetKustomization.bases.length})\n`);

                    // Make each base clickable
                    targetKustomization.bases.forEach(base => {
                        const basePath = path.resolve(path.dirname(resolvedPath), base);
                        let baseUri;

                        if (this.parser.isDirectory(basePath)) {
                            // If it's a directory, try to find the kustomization file
                            const kustomizationPath = path.join(basePath, 'kustomization.yaml');
                            const kustomizationPathYml = path.join(basePath, 'kustomization.yml');

                            if (this.parser.fileExists(kustomizationPath)) {
                                baseUri = vscode.Uri.file(kustomizationPath);
                            } else if (this.parser.fileExists(kustomizationPathYml)) {
                                baseUri = vscode.Uri.file(kustomizationPathYml);
                            } else {
                                baseUri = vscode.Uri.file(basePath);
                            }
                        } else {
                            baseUri = vscode.Uri.file(basePath);
                        }

                        hoverContent.appendMarkdown(`- [\`${base}\`](${baseUri.toString()})\n`);
                    });
                    hoverContent.appendMarkdown('\n');
                }

                if (targetKustomization.patches.length > 0 || targetKustomization.patchesStrategicMerge.length > 0) {
                    const patchCount = targetKustomization.patches.length + targetKustomization.patchesStrategicMerge.length;
                    hoverContent.appendMarkdown(`### Patches (${patchCount})\n`);

                    // Make each patch clickable
                    const processPatches = (patches: any[]) => {
                        patches.forEach(patch => {
                            let patchPath;
                            let displayName;

                            if (typeof patch === 'string') {
                                // Simple string patch reference
                                patchPath = path.resolve(path.dirname(resolvedPath), patch);
                                displayName = patch;
                            } else if (patch && typeof patch === 'object') {
                                // Object-style patch which might have a path property
                                if (patch.path && typeof patch.path === 'string') {
                                    patchPath = path.resolve(path.dirname(resolvedPath), patch.path);
                                    displayName = patch.path;
                                } else {
                                    // Skip patches without a path property
                                    return;
                                }
                            } else {
                                // Skip invalid patches
                                return;
                            }

                            const patchUri = vscode.Uri.file(patchPath);
                            hoverContent.appendMarkdown(`- [\`${displayName}\`](${patchUri.toString()})\n`);
                        });
                    };

                    // Process regular patches
                    if (targetKustomization.patches.length > 0) {
                        hoverContent.appendMarkdown(`### Patches (${targetKustomization.patches.length})\n`);
                        processPatches(targetKustomization.patches);
                        hoverContent.appendMarkdown('\n');
                    }

                    // Process strategic merge patches separately
                    if (targetKustomization.patchesStrategicMerge.length > 0) {
                        hoverContent.appendMarkdown(`### Strategic Merge Patches (${targetKustomization.patchesStrategicMerge.length})\n`);
                        processPatches(targetKustomization.patchesStrategicMerge);
                        hoverContent.appendMarkdown('\n');
                    }

                    // Process JSON 6902 patches
                    if (targetKustomization.patchesJson6902.length > 0) {
                        hoverContent.appendMarkdown(`### JSON 6902 Patches (${targetKustomization.patchesJson6902.length})\n`);
                        targetKustomization.patchesJson6902.forEach(patch => {
                            if (patch && typeof patch === 'object' && patch.path && typeof patch.path === 'string') {
                                const patchPath = path.resolve(path.dirname(resolvedPath), patch.path);
                                const patchUri = vscode.Uri.file(patchPath);

                                let targetInfo = '';
                                if (patch.target && typeof patch.target === 'object') {
                                    if (patch.target.kind) {
                                        targetInfo += ` (Kind: ${patch.target.kind}`;
                                        if (patch.target.name) {
                                            targetInfo += `, Name: ${patch.target.name}`;
                                        }
                                        targetInfo += ')';
                                    }
                                }

                                hoverContent.appendMarkdown(`- [\`${patch.path}\`](${patchUri.toString()})${targetInfo}\n`);
                            }
                        });
                        hoverContent.appendMarkdown('\n');
                    }

                    hoverContent.appendMarkdown('\n');
                }

                // We're removing the explicit "Open File" link since we've made all resources clickable
                // and there's already ctrl+click behavior

                return new vscode.Hover(hoverContent, wordRange);
            }
        } catch (error) {
            console.error('Error providing hover:', error);
        }

        return null;
    }
}