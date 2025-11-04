import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { execSync } from 'child_process';
import { KustomizeParser } from './kustomizeParser';
import { YamlUtils } from './yamlUtils';

export class KustomizeLinkProvider implements vscode.DocumentLinkProvider {
    private diagnosticCollection: vscode.DiagnosticCollection;
    private gitRootCache = new Map<string, string>();

    constructor(private parser: KustomizeParser) {
        // Create a diagnostic collection for this provider
        this.diagnosticCollection = vscode.languages.createDiagnosticCollection('kustomize-navigator');
    }

    public async provideDocumentLinks(
        document: vscode.TextDocument,
        token: vscode.CancellationToken
    ): Promise<vscode.DocumentLink[]> {
        const text = document.getText();
        const links: vscode.DocumentLink[] = [];
        const diagnostics: vscode.Diagnostic[] = [];

        // Only process YAML files
        if (!document.fileName.endsWith('.yaml') && !document.fileName.endsWith('.yml')) {
            return links;
        }

        try {
            // Try to parse the YAML content - handle multiple documents
            const yamlDocuments = YamlUtils.parseMultipleYamlDocuments(text);

            if (yamlDocuments.length === 0) {
                return links;
            }

            // Process each YAML document
            for (let i = 0; i < yamlDocuments.length; i++) {
                const content = yamlDocuments[i];

                // Check if this document is a Flux Kustomization CR
                const isFluxKustomization = YamlUtils.isFluxKustomizationDocument(content);

                // Check if this document is a standard kustomization
                const isStandardKustomization = !isFluxKustomization &&
                    path.basename(document.fileName).match(/^kustomization\.ya?ml$/) &&
                    YamlUtils.isStandardKustomizationDocument(content);

                if (isFluxKustomization) {
                    await this.processFluxKustomizationReferences(document, content, links, diagnostics);
                } else if (isStandardKustomization) {
                    await this.processKustomizationReferences(document, content, links, diagnostics);
                }
            }

            // If no kustomization documents found, process back references
            const hasKustomizationDocs = yamlDocuments.some(doc =>
                YamlUtils.isFluxKustomizationDocument(doc) ||
                (path.basename(document.fileName).match(/^kustomization\.ya?ml$/) && YamlUtils.isStandardKustomizationDocument(doc))
            );

            if (!hasKustomizationDocs) {
                // For non-kustomization files, add links to files that reference this one
                await this.processBackReferences(document, links);
            }

            // Update diagnostics for this document
            this.diagnosticCollection.set(document.uri, diagnostics);
        } catch (error) {
            console.error(`Error processing links for ${document.fileName}:`, error);
        }

        return links;
    }

    /**
     * Process Flux Kustomization CR references (spec.path, patches, etc.)
     */
    private async processFluxKustomizationReferences(
        document: vscode.TextDocument,
        content: any,
        links: vscode.DocumentLink[],
        diagnostics: vscode.Diagnostic[]
    ): Promise<void> {
        if (!content.spec) {
            return;
        }

        const spec = content.spec;

        // Process spec.path - THIS IS THE KEY FIX
        if (spec.path && typeof spec.path === 'string') {
            await this.addFluxLinkForReference(document, 'path', spec.path, links, diagnostics);
        }

        // Process patches - supports string format, object with path, and inline patches
        if (Array.isArray(spec.patches)) {
            for (const patch of spec.patches) {
                if (patch === null || patch === undefined) {
                    continue;
                }
                if (typeof patch === 'string') {
                    // String format: patches: [patch.yaml]
                    await this.addFluxLinkForReference(document, 'patches', patch, links, diagnostics);
                } else if (typeof patch === 'object' && patch.path) {
                    // Object format with path: patches: [{path: patch.yaml, target: {...}}]
                    await this.addFluxLinkForReference(document, 'patches', patch.path, links, diagnostics);
                }
                // Inline patches (with patch field but no path) don't need linking
            }
        }

        // Process patchesStrategicMerge
        if (Array.isArray(spec.patchesStrategicMerge)) {
            for (const patch of spec.patchesStrategicMerge) {
                if (patch !== null && patch !== undefined && typeof patch === 'string') {
                    await this.addFluxLinkForReference(document, 'patchesStrategicMerge', patch, links, diagnostics);
                }
            }
        }

        // Process patchesJson6902
        if (Array.isArray(spec.patchesJson6902)) {
            for (const patch of spec.patchesJson6902) {
                if (patch !== null && patch !== undefined && typeof patch === 'object' && patch.path) {
                    await this.addFluxLinkForReference(document, 'patchesJson6902', patch.path, links, diagnostics);
                }
            }
        }

        // Process components
        if (Array.isArray(spec.components)) {
            for (const component of spec.components) {
                if (component !== null && component !== undefined && typeof component === 'string') {
                    await this.addFluxLinkForReference(document, 'components', component, links, diagnostics);
                }
            }
        }
    }

    /**
     * Process standard kustomization.yaml references
     */
    private async processKustomizationReferences(
        document: vscode.TextDocument,
        content: any,
        links: vscode.DocumentLink[],
        diagnostics: vscode.Diagnostic[]
    ): Promise<void> {
        const baseDir = path.dirname(document.fileName);

        // Process different types of references
        const referenceFields = [
            'resources',
            'bases',
            'components',
            'patchesStrategicMerge',
            'configurations',
            'crds',
            'generators',
            'transformers'
        ];

        for (const field of referenceFields) {
            if (Array.isArray(content[field])) {
                for (const reference of content[field]) {
                    if (reference !== null && reference !== undefined && typeof reference === 'string') {
                        await this.addStandardLinkForReference(document, reference, baseDir, links, diagnostics);
                    }
                }
            }
        }

        // Handle patches field - supports both string paths and objects with path field
        if (Array.isArray(content.patches)) {
            for (const patch of content.patches) {
                if (patch === null || patch === undefined) {
                    continue;
                }
                if (typeof patch === 'string') {
                    // String format: patches: [patch.yaml]
                    await this.addStandardLinkForReference(document, patch, baseDir, links, diagnostics);
                } else if (typeof patch === 'object' && patch.path) {
                    // Object format with path: patches: [{path: patch.yaml, target: {...}}]
                    await this.addStandardLinkForReference(document, patch.path, baseDir, links, diagnostics);
                }
                // Inline patches (with patch field but no path) don't need linking
            }
        }

        // Handle JSON 6902 patches which have a path field (deprecated but still supported)
        if (Array.isArray(content.patchesJson6902)) {
            for (const patch of content.patchesJson6902) {
                if (patch !== null && patch !== undefined && typeof patch === 'object' && patch.path) {
                    await this.addStandardLinkForReference(document, patch.path, baseDir, links, diagnostics);
                }
            }
        }
    }

    /**
     * Find the first line starting with apiVersion: in the document
     * Returns the line number, or null if not found
     */
    private findFirstApiVersionLine(document: vscode.TextDocument): number | null {
        for (let i = 0; i < document.lineCount; i++) {
            const line = document.lineAt(i);
            const trimmedLine = line.text.trim();
            if (trimmedLine.startsWith('apiVersion:')) {
                return i;
            }
        }
        return null;
    }

    /**
     * Process back references for non-kustomization files
     */
    private async processBackReferences(
        document: vscode.TextDocument,
        links: vscode.DocumentLink[]
    ): Promise<void> {
        // Get files that reference this file
        const backReferences = this.parser.getBackReferencesForFile(document.fileName);

        if (backReferences.length > 0) {
            // Find the first line starting with apiVersion:
            const apiVersionLineNum = this.findFirstApiVersionLine(document);
            
            if (apiVersionLineNum === null) {
                // Fallback to first line if apiVersion: not found
                const firstLine = document.lineAt(0);
                for (const ref of backReferences) {
                    const uri = vscode.Uri.file(ref.path);
                    const linkRange = new vscode.Range(
                        firstLine.range.start,
                        firstLine.range.end
                    );
                    const docLink = new vscode.DocumentLink(linkRange, uri);
                    docLink.tooltip = `Referenced by ${ref.type.toUpperCase()} Kustomization: ${path.basename(ref.path)}`;
                    links.push(docLink);
                }
                return;
            }

            const apiVersionLine = document.lineAt(apiVersionLineNum);
            // Select whole line until EOL or # (comment)
            const lineText = apiVersionLine.text;
            const commentIndex = lineText.indexOf('#');
            const endPosition = commentIndex >= 0 
                ? new vscode.Position(apiVersionLineNum, commentIndex)
                : apiVersionLine.range.end;

            for (const ref of backReferences) {
                const uri = vscode.Uri.file(ref.path);
                const linkRange = new vscode.Range(
                    apiVersionLine.range.start,
                    endPosition
                );
                const docLink = new vscode.DocumentLink(linkRange, uri);
                docLink.tooltip = `Referenced by ${ref.type.toUpperCase()} Kustomization: ${path.basename(ref.path)}`;
                links.push(docLink);
            }
        }
    }

    /**
     * Add a clickable link for a Flux Kustomization reference (Git root relative)
     * FIXED: Now properly resolves paths relative to Git root for Flux Kustomizations
     */
    private async addFluxLinkForReference(
        document: vscode.TextDocument,
        fieldName: string,
        reference: string,
        links: vscode.DocumentLink[],
        diagnostics: vscode.Diagnostic[]
    ): Promise<void> {

        try {
            // Find the reference in the document text
            const text = document.getText();
            const referenceIndex = YamlUtils.findReferenceInText(text, reference);

            if (referenceIndex === -1) {
                return;
            }

            // FIXED: Always resolve relative to Git repository root for Flux Kustomizations
            const gitRoot = this.findGitRoot(document.fileName);

            // Handle relative paths properly
            let resolvedPath: string;
            if (path.isAbsolute(reference)) {
                // If it's already absolute, use as-is
                resolvedPath = reference;
            } else {
                // Remove leading "./" if present and resolve relative to git root
                const cleanReference = reference.startsWith('./') ? reference.slice(2) : reference;
                resolvedPath = path.resolve(gitRoot, cleanReference);
            }


            // Create position and range for the link
            const pos = document.positionAt(referenceIndex);
            const range = new vscode.Range(
                pos,
                pos.translate(0, reference.length)
            );

            // Check if the target exists (using cached method)
            let fileExists = this.parser.cachedFileExists(resolvedPath);
            let targetPath = resolvedPath;
            let targetIsKustomization = false;

            // For Flux Kustomization paths, we expect them to point to directories containing kustomization files
            if (fileExists && this.parser.cachedIsDirectory(resolvedPath)) {
                const kustomizationPath = path.join(resolvedPath, 'kustomization.yaml');
                const kustomizationPathYml = path.join(resolvedPath, 'kustomization.yml');

                if (this.parser.cachedFileExists(kustomizationPath)) {
                    targetPath = kustomizationPath;
                    targetIsKustomization = true;
                    fileExists = true;
                } else if (this.parser.cachedFileExists(kustomizationPathYml)) {
                    targetPath = kustomizationPathYml;
                    targetIsKustomization = true;
                    fileExists = true;
                } else {
                    // Directory exists but no kustomization file - create one when clicked
                    targetPath = kustomizationPath;  // Default to kustomization.yaml
                    fileExists = false;
                }
            } else if (!fileExists && !resolvedPath.endsWith('.yaml') && !resolvedPath.endsWith('.yml')) {
                // If the target doesn't exist and doesn't have a yaml extension, treat it as a directory
                targetPath = path.join(resolvedPath, 'kustomization.yaml');
            }

            // Create the link
            const uri = vscode.Uri.file(targetPath);
            const docLink = new vscode.DocumentLink(range, uri);

            // Create appropriate tooltip
            if (fieldName === 'path') {
                docLink.tooltip = targetIsKustomization
                    ? `Open kustomization: ${path.basename(targetPath)} in ${reference}`
                    : `Create kustomization: ${path.basename(targetPath)} in ${reference}`;
            } else {
                docLink.tooltip = `Open Flux ${fieldName}: ${path.basename(targetPath)}`;
            }

            links.push(docLink);

            // Add diagnostic if file doesn't exist
            if (!fileExists) {
                let errorMessage: string;
                if (this.parser.cachedFileExists(path.dirname(targetPath))) {
                    errorMessage = `Directory exists but no kustomization.yaml file inside: ${reference}`;
                } else {
                    errorMessage = `Flux reference not found: ${reference} (resolved to: ${targetPath})`;
                }

                const diagnostic = new vscode.Diagnostic(
                    range,
                    errorMessage,
                    vscode.DiagnosticSeverity.Warning
                );
                diagnostic.source = 'Flux Kustomize Navigator';
                diagnostics.push(diagnostic);
            }

        } catch (error) {
            console.error(`Error creating Flux link for ${reference}:`, error);
        }
    }

    /**
     * Add a clickable link for a standard kustomization reference (file relative)
     */
    private async addStandardLinkForReference(
        document: vscode.TextDocument,
        reference: string,
        baseDir: string,
        links: vscode.DocumentLink[],
        diagnostics: vscode.Diagnostic[]
    ): Promise<void> {

        try {
            // Find the reference in the document text
            const text = document.getText();
            const referenceIndex = YamlUtils.findReferenceInText(text, reference);

            if (referenceIndex === -1) {
                return;
            }

            // Resolve the reference to a file path (relative to file location)
            let resolvedPath = path.resolve(baseDir, reference);

            // Create position and range for the link
            const pos = document.positionAt(referenceIndex);
            const range = new vscode.Range(
                pos,
                pos.translate(0, reference.length)
            );

            // Check if the file exists (using cached method)
            let fileExists = this.parser.cachedFileExists(resolvedPath);
            let targetIsKustomization = false;

            // If it's a directory, look for kustomization.yaml inside
            if (fileExists && this.parser.cachedIsDirectory(resolvedPath)) {
                const kustomizationPath = path.join(resolvedPath, 'kustomization.yaml');
                const kustomizationPathYml = path.join(resolvedPath, 'kustomization.yml');

                if (this.parser.cachedFileExists(kustomizationPath)) {
                    resolvedPath = kustomizationPath;
                    targetIsKustomization = true;
                    fileExists = true;
                } else if (this.parser.cachedFileExists(kustomizationPathYml)) {
                    resolvedPath = kustomizationPathYml;
                    targetIsKustomization = true;
                    fileExists = true;
                } else {
                    // Directory exists but no kustomization file - create one when clicked
                    resolvedPath = kustomizationPath;  // Default to kustomization.yaml
                    fileExists = false;
                }
            } else if (!fileExists && !resolvedPath.endsWith('.yaml') && !resolvedPath.endsWith('.yml')) {
                // If the target doesn't exist and doesn't have a yaml extension, treat it as a directory
                resolvedPath = path.join(resolvedPath, 'kustomization.yaml');
            }

            // Create link
            const uri = vscode.Uri.file(resolvedPath);
            const docLink = new vscode.DocumentLink(range, uri);
            docLink.tooltip = targetIsKustomization
                ? `Go to kustomization: ${reference} (file relative)`
                : `Create kustomization: ${reference} (file relative)`;

            links.push(docLink);

            // Add diagnostic if file doesn't exist
            if (!fileExists) {
                let errorMessage: string;
                if (this.parser.cachedFileExists(path.dirname(resolvedPath))) {
                    errorMessage = `Directory exists but no kustomization.yaml file inside: ${reference}`;
                } else {
                    errorMessage = `Referenced file not found: ${reference} (resolved to: ${resolvedPath})`;
                }

                const diagnostic = new vscode.Diagnostic(
                    range,
                    errorMessage,
                    vscode.DiagnosticSeverity.Warning
                );
                diagnostic.source = 'Kustomize Navigator';
                diagnostics.push(diagnostic);
            }
        } catch (error) {
            console.error(`Error creating standard link for ${reference}:`, error);
        }
    }

    /**
     * Find Git repository root for the given file
     */
    private findGitRoot(filePath: string): string {
        const cacheKey = path.dirname(filePath);

        // Check cache first
        if (this.gitRootCache.has(cacheKey)) {
            return this.gitRootCache.get(cacheKey)!;
        }

        try {
            const result = execSync('git rev-parse --show-toplevel', {
                cwd: path.dirname(filePath),
                encoding: 'utf8',
                stdio: ['ignore', 'pipe', 'ignore']
            });
            const gitRoot = result.trim();
            this.gitRootCache.set(cacheKey, gitRoot);
            return gitRoot;
        } catch (error) {
            // Fallback to directory of the file
            console.warn(`Could not find Git root for ${filePath}, using file directory`);
            const fallback = path.dirname(filePath);
            this.gitRootCache.set(cacheKey, fallback);
            return fallback;
        }
    }

    public dispose(): void {
        this.diagnosticCollection.dispose();
    }
}