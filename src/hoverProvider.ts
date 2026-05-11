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
                    ...kustomization.crds,
                    ...kustomization.generators,
                    ...kustomization.transformers,
                ];

                const patchesJson6902Paths = kustomization.patchesJson6902
                    .map((p) =>
                        p && typeof p === 'object' && typeof p.path === 'string' ? p.path : null
                    )
                    .filter((p): p is string => p !== null);

                // Find the reference that contains the word
                let matchingReference: string | undefined;

                // First check string references (including JSON6902 paths, which are not in `patches`)
                const stringReferences = [
                    ...(allReferences.filter((ref) => typeof ref === 'string') as string[]),
                    ...patchesJson6902Paths,
                ];
                matchingReference = stringReferences.find((ref) => ref.includes(word));

                // If no match found, check object references with path property
                if (!matchingReference) {
                    const objectReferences = [
                        ...(allReferences.filter(
                            (ref) => typeof ref === 'object' && ref !== null && 'path' in ref
                        ) as KustomizationPatch[]),
                        ...kustomization.patchesJson6902,
                    ];

                    const matchingObject = objectReferences.find(
                        (ref) => typeof ref.path === 'string' && ref.path.includes(word)
                    );

                    if (matchingObject?.path) {
                        matchingReference = matchingObject.path;
                    }
                }

                if (!matchingReference) {
                    continue; // Try next kustomization if no match found
                }

                if (YamlUtils.isRemoteResourceUri(matchingReference)) {
                    const remoteHover = new vscode.MarkdownString();
                    remoteHover.isTrusted = true;
                    remoteHover.supportHtml = true;
                    remoteHover.appendMarkdown(`### Remote resource (URI)\n\n`);
                    remoteHover.appendMarkdown(`[\`${matchingReference}\`](${matchingReference})\n`);
                    return new vscode.Hover(remoteHover, wordRange);
                }

                // Resolve the reference — use the parser so Flux Kustomizations resolve
                // relative to the git root rather than the document directory.
                let resolvedPath = this.parser.resolveReferenceFor(docPath, matchingReference);
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

                        const refBaseDir = path.dirname(resolvedPath);

                        // Add resources section if any
                        if (targetKustomization.resources.length > 0) {
                            hoverContent.appendMarkdown(`#### Resources (${targetKustomization.resources.length})\n`);
                            this.appendSimplePathOrUrlLinks(
                                hoverContent,
                                targetKustomization.resources,
                                refBaseDir
                            );
                            hoverContent.appendMarkdown('\n');
                        }

                        if (targetKustomization.components.length > 0) {
                            hoverContent.appendMarkdown(`#### Components (${targetKustomization.components.length})\n`);
                            this.appendSimplePathOrUrlLinks(
                                hoverContent,
                                targetKustomization.components,
                                refBaseDir
                            );
                            hoverContent.appendMarkdown('\n');
                        }

                        if (targetKustomization.configurations.length > 0) {
                            hoverContent.appendMarkdown(
                                `#### Configurations (${targetKustomization.configurations.length})\n`
                            );
                            this.appendSimplePathOrUrlLinks(
                                hoverContent,
                                targetKustomization.configurations,
                                refBaseDir
                            );
                            hoverContent.appendMarkdown('\n');
                        }

                        if (targetKustomization.crds.length > 0) {
                            hoverContent.appendMarkdown(`#### CRDs (${targetKustomization.crds.length})\n`);
                            this.appendSimplePathOrUrlLinks(hoverContent, targetKustomization.crds, refBaseDir);
                            hoverContent.appendMarkdown('\n');
                        }

                        if (targetKustomization.generators.length > 0) {
                            hoverContent.appendMarkdown(
                                `#### Generators (${targetKustomization.generators.length})\n`
                            );
                            this.appendSimplePathOrUrlLinks(
                                hoverContent,
                                targetKustomization.generators,
                                refBaseDir
                            );
                            hoverContent.appendMarkdown('\n');
                        }

                        if (targetKustomization.transformers.length > 0) {
                            hoverContent.appendMarkdown(
                                `#### Transformers (${targetKustomization.transformers.length})\n`
                            );
                            this.appendSimplePathOrUrlLinks(
                                hoverContent,
                                targetKustomization.transformers,
                                refBaseDir
                            );
                            hoverContent.appendMarkdown('\n');
                        }

                        // Add bases section if any
                        if (targetKustomization.bases.length > 0) {
                            hoverContent.appendMarkdown(`#### Bases (${targetKustomization.bases.length})\n`);
                            for (const base of targetKustomization.bases) {
                                if (YamlUtils.isRemoteResourceUri(base)) {
                                    hoverContent.appendMarkdown(`- [\`${base}\`](${base})\n`);
                                    continue;
                                }
                                const basePath = path.resolve(refBaseDir, base);
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
                                        const patchUri = YamlUtils.isRemoteResourceUri(patch.path)
                                            ? vscode.Uri.parse(patch.path)
                                            : vscode.Uri.file(
                                                  path.resolve(refBaseDir, patch.path)
                                              );

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

    /**
     * Markdown links for plain path strings: file URI or raw https? URL.
     */
    private appendSimplePathOrUrlLinks(
        hoverContent: vscode.MarkdownString,
        items: string[],
        baseDir: string
    ): void {
        for (const item of items) {
            if (YamlUtils.isRemoteResourceUri(item)) {
                hoverContent.appendMarkdown(`- [\`${item}\`](${item})\n`);
            } else {
                const fullPath = path.resolve(baseDir, item);
                hoverContent.appendMarkdown(
                    `- [\`${item}\`](${vscode.Uri.file(fullPath).toString()})\n`
                );
            }
        }
    }

    private processPatches(patches: any[], basePath: string, hoverContent: vscode.MarkdownString): void {
        for (const patch of patches) {
            let patchPath: string | undefined;
            let displayName: string | undefined;
            let isInline = false;

            if (typeof patch === 'string') {
                // String format: patches: [patch.yaml]
                patchPath = patch;
                displayName = patch;
            } else if (patch && typeof patch === 'object') {
                if (patch.path && typeof patch.path === 'string') {
                    // Object format with path: patches: [{path: patch.yaml, target: {...}}]
                    patchPath = patch.path;
                    displayName = patch.path;
                } else if (patch.patch) {
                    // Inline patch format: patches: [{patch: |-...}, target: {...}]
                    isInline = true;
                    displayName = 'inline patch';
                }
            }

            if (isInline) {
                // Show inline patch info
                let targetInfo = '';
                if (patch?.target?.kind) {
                    targetInfo = ` (Target: ${patch.target.kind}`;
                    if (patch.target.name) {
                        targetInfo += `/${patch.target.name}`;
                    }
                    targetInfo += ')';
                }
                hoverContent.appendMarkdown(`- \`${displayName}\`${targetInfo}\n`);
            } else if (patchPath && displayName) {
                // Show linkable patch — web URI for remote, file URI for local
                const patchUri = YamlUtils.isRemoteResourceUri(patchPath)
                    ? vscode.Uri.parse(patchPath)
                    : vscode.Uri.file(path.resolve(path.dirname(basePath), patchPath));
                
                let targetInfo = '';
                if (patch?.target?.kind) {
                    targetInfo = ` (Target: ${patch.target.kind}`;
                    if (patch.target.name) {
                        targetInfo += `/${patch.target.name}`;
                    }
                    targetInfo += ')';
                }
                
                hoverContent.appendMarkdown(`- [\`${displayName}\`](${patchUri.toString()})${targetInfo}\n`);
            }
        }
    }
    
}