import * as vscode from 'vscode';
import * as path from 'path';
import { KustomizeParser, KustomizationPatch } from './kustomizeParser';
import { YamlUtils } from './yamlUtils';

export class KustomizeHoverProvider implements vscode.HoverProvider {
    constructor(private parser: KustomizeParser) { }

    public async provideHover(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken
    ): Promise<vscode.Hover | null> {
        try {
            // If position is at the very top of the document, show back references
            if (position.line === 0 && position.character < 10) {
                const backRefHover = await this.provideBackReferenceHover(document);
                if (backRefHover) {
                    return backRefHover;
                }
            }
            
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
            const docPath = document.fileName;
            const baseDir = path.dirname(docPath);

            // Look for references that match the word under cursor
            const kustomizations = this.parser.parseKustomizationFile(docPath);
            if (kustomizations.length === 0) {
                return null;
            }

            // Process each kustomization file in the document
            for (const kustomization of kustomizations) {
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

                    if (matchingObject?.path) {
                        matchingReference = matchingObject.path;
                    }
                }

                if (!matchingReference) {
                    continue; // Try next kustomization if no match found
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
                    const targetKustomizations = this.parser.parseKustomizationFile(resolvedPath);
                    if (targetKustomizations.length === 0) {
                        continue;
                    }

                    // Create a detailed markdown hover
                    const hoverContent = new vscode.MarkdownString();
                    hoverContent.isTrusted = true;
                    hoverContent.supportHtml = true;

                    // Process each target kustomization
                    for (const targetKustomization of targetKustomizations) {
                        hoverContent.appendMarkdown(`### Kustomization: \`${matchingReference}\`\n\n`);

                        // Add resources section if any
                        if (targetKustomization.resources.length > 0) {
                            hoverContent.appendMarkdown(`#### Resources (${targetKustomization.resources.length})\n`);
                            for (const resource of targetKustomization.resources) {
                                const resourcePath = path.resolve(path.dirname(resolvedPath), resource);
                                const resourceUri = vscode.Uri.file(resourcePath);
                                hoverContent.appendMarkdown(`- [\`${resource}\`](${resourceUri.toString()})\n`);
                            }
                            hoverContent.appendMarkdown('\n');
                        }

                        // Add bases section if any
                        if (targetKustomization.bases.length > 0) {
                            hoverContent.appendMarkdown(`#### Bases (${targetKustomization.bases.length})\n`);
                            for (const base of targetKustomization.bases) {
                                const basePath = path.resolve(path.dirname(resolvedPath), base);
                                let baseUri;

                                if (this.parser.isDirectory(basePath)) {
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
                            }
                            hoverContent.appendMarkdown('\n');
                        }

                        // Add patches sections if any
                        const hasPatches = targetKustomization.patches.length > 0 || 
                                         targetKustomization.patchesStrategicMerge.length > 0 || 
                                         targetKustomization.patchesJson6902.length > 0;

                        if (hasPatches) {
                            // Process regular patches
                            if (targetKustomization.patches.length > 0) {
                                hoverContent.appendMarkdown(`#### Patches (${targetKustomization.patches.length})\n`);
                                this.processPatches(targetKustomization.patches, resolvedPath, hoverContent);
                                hoverContent.appendMarkdown('\n');
                            }

                            // Process strategic merge patches
                            if (targetKustomization.patchesStrategicMerge.length > 0) {
                                hoverContent.appendMarkdown(`#### Strategic Merge Patches (${targetKustomization.patchesStrategicMerge.length})\n`);
                                this.processPatches(targetKustomization.patchesStrategicMerge, resolvedPath, hoverContent);
                                hoverContent.appendMarkdown('\n');
                            }

                            // Process JSON 6902 patches
                            if (targetKustomization.patchesJson6902.length > 0) {
                                hoverContent.appendMarkdown(`#### JSON 6902 Patches (${targetKustomization.patchesJson6902.length})\n`);
                                for (const patch of targetKustomization.patchesJson6902) {
                                    if (patch?.path && typeof patch.path === 'string') {
                                        const patchPath = path.resolve(path.dirname(resolvedPath), patch.path);
                                        const patchUri = vscode.Uri.file(patchPath);

                                        let targetInfo = '';
                                        if (patch.target?.kind) {
                                            targetInfo = ` (Kind: ${patch.target.kind}`;
                                            if (patch.target.name) {
                                                targetInfo += `, Name: ${patch.target.name}`;
                                            }
                                            targetInfo += ')';
                                        }

                                        hoverContent.appendMarkdown(`- [\`${patch.path}\`](${patchUri.toString()})${targetInfo}\n`);
                                    }
                                }
                                hoverContent.appendMarkdown('\n');
                            }
                        }

                        return new vscode.Hover(hoverContent, wordRange);
                    }
                }
            }
        } catch (error) {
            console.error('Error providing hover:', error);
        }

        return null;
    }

    private processPatches(patches: any[], basePath: string, hoverContent: vscode.MarkdownString): void {
        for (const patch of patches) {
            let patchPath: string | undefined;
            let displayName: string | undefined;

            if (typeof patch === 'string') {
                patchPath = patch;
                displayName = patch;
            } else if (patch?.path && typeof patch.path === 'string') {
                patchPath = patch.path;
                displayName = patch.path;
            }

            if (patchPath && displayName) {
                const fullPath = path.resolve(path.dirname(basePath), patchPath);
                const patchUri = vscode.Uri.file(fullPath);
                hoverContent.appendMarkdown(`- [\`${displayName}\`](${patchUri.toString()})\n`);
            }
        }
    }
    
    private async provideBackReferenceHover(document: vscode.TextDocument): Promise<vscode.Hover | null> {
        // Get back references
        const backRefs = this.parser.getBackReferencesForFile(document.fileName);
        
        if (!backRefs || backRefs.length === 0) {
            return null;
        }
        
        // Create markdown for hover
        const hoverContent = new vscode.MarkdownString();
        hoverContent.isTrusted = true;
        hoverContent.supportHtml = true;
        
        // Get document count for current file
        const currentFileContent = document.getText();
        const currentFileDocs = YamlUtils.parseMultipleYamlDocuments(currentFileContent);
        const currentDocCount = currentFileDocs.length;
        
        hoverContent.appendMarkdown(`### File Information\n\n`);
        hoverContent.appendMarkdown(`- Contains ${currentDocCount} YAML document${currentDocCount > 1 ? 's' : ''}\n\n`);
        
        // Separate Flux and K8s references
        const fluxRefs = backRefs.filter(ref => ref.type === 'flux');
        const k8sRefs = backRefs.filter(ref => ref.type === 'k8s');
        
        // Process Flux references
        if (fluxRefs.length > 0) {
            hoverContent.appendMarkdown(`### Referenced by ${fluxRefs.length} Flux Kustomization${fluxRefs.length > 1 ? 's' : ''}\n\n`);
            
            // Process each Flux reference to get document counts
            const fluxRefDetails = await Promise.all(fluxRefs.map(async ref => {
                const refUri = vscode.Uri.file(ref.path);
                const refName = path.basename(path.dirname(ref.path)) + '/' + path.basename(ref.path);
                
                // Get document count for the referencing file
                const refContent = await vscode.workspace.fs.readFile(refUri);
                const refDocs = YamlUtils.parseMultipleYamlDocuments(refContent.toString());
                const refDocCount = refDocs.length;
                
                // Get document types
                const docTypes = new Set<string>();
                refDocs.forEach(doc => {
                    if (doc.kind) {
                        docTypes.add(doc.kind);
                    }
                });
                
                return {
                    uri: refUri,
                    name: refName,
                    docCount: refDocCount,
                    docTypes: Array.from(docTypes)
                };
            }));
            
            // Sort Flux references by document count
            fluxRefDetails.sort((a, b) => b.docCount - a.docCount);
            
            // Make each Flux reference clickable with document information
            fluxRefDetails.forEach(ref => {
                hoverContent.appendMarkdown(`- [\`${ref.name}\`](${ref.uri.toString()})`);
                hoverContent.appendMarkdown(` (${ref.docCount} document${ref.docCount > 1 ? 's' : ''}`);
                if (ref.docTypes.length > 0) {
                    hoverContent.appendMarkdown(`, types: ${ref.docTypes.join(', ')}`);
                }
                hoverContent.appendMarkdown(')\n');
            });
            
            hoverContent.appendMarkdown('\n');
        }
        
        // Process K8s references
        if (k8sRefs.length > 0) {
            hoverContent.appendMarkdown(`### Referenced by ${k8sRefs.length} K8s Kustomization${k8sRefs.length > 1 ? 's' : ''}\n\n`);
            
            // Process each K8s reference to get document counts
            const k8sRefDetails = await Promise.all(k8sRefs.map(async ref => {
                const refUri = vscode.Uri.file(ref.path);
                const refName = path.basename(path.dirname(ref.path)) + '/' + path.basename(ref.path);
                
                // Get document count for the referencing file
                const refContent = await vscode.workspace.fs.readFile(refUri);
                const refDocs = YamlUtils.parseMultipleYamlDocuments(refContent.toString());
                const refDocCount = refDocs.length;
                
                // Get document types
                const docTypes = new Set<string>();
                refDocs.forEach(doc => {
                    if (doc.kind) {
                        docTypes.add(doc.kind);
                    }
                });
                
                return {
                    uri: refUri,
                    name: refName,
                    docCount: refDocCount,
                    docTypes: Array.from(docTypes)
                };
            }));
            
            // Sort K8s references by document count
            k8sRefDetails.sort((a, b) => b.docCount - a.docCount);
            
            // Make each K8s reference clickable with document information
            k8sRefDetails.forEach(ref => {
                hoverContent.appendMarkdown(`- [\`${ref.name}\`](${ref.uri.toString()})`);
                hoverContent.appendMarkdown(` (${ref.docCount} document${ref.docCount > 1 ? 's' : ''}`);
                if (ref.docTypes.length > 0) {
                    hoverContent.appendMarkdown(`, types: ${ref.docTypes.join(', ')}`);
                }
                hoverContent.appendMarkdown(')\n');
            });
        }
        
        // Return hover at the top of the document
        return new vscode.Hover(hoverContent, new vscode.Range(0, 0, 0, 0));
    }
}