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
        console.log(`Providing links for: ${document.fileName}`);
        const text = document.getText();
        const links: vscode.DocumentLink[] = [];
        const diagnostics: vscode.Diagnostic[] = [];

        // Only process YAML files
        if (!document.fileName.endsWith('.yaml') && !document.fileName.endsWith('.yml')) {
            console.log(`Skipping non-YAML file: ${document.fileName}`);
            return links;
        }

        try {
            // Try to parse the YAML content - handle multiple documents
            const yamlDocuments = YamlUtils.parseMultipleYamlDocuments(text);

            if (yamlDocuments.length === 0) {
                console.log(`No YAML content in: ${document.fileName}`);
                return links;
            }

            console.log(`Found ${yamlDocuments.length} YAML document(s) in: ${document.fileName}`);

            // Process each YAML document
            for (let i = 0; i < yamlDocuments.length; i++) {
                const content = yamlDocuments[i];
                console.log(`Processing YAML document ${i + 1}/${yamlDocuments.length}`);

                // Check if this document is a Flux Kustomization CR
                const isFluxKustomization = YamlUtils.isFluxKustomizationDocument(content);

                // Check if this document is a standard kustomization
                const isStandardKustomization = !isFluxKustomization &&
                    path.basename(document.fileName).match(/^kustomization\.ya?ml$/) &&
                    YamlUtils.isStandardKustomizationDocument(content);

                if (isFluxKustomization) {
                    console.log(`Processing Flux Kustomization CR in document ${i + 1}: ${document.fileName}`);
                    await this.processFluxKustomizationReferences(document, content, links, diagnostics);
                } else if (isStandardKustomization) {
                    console.log(`Processing standard kustomization in document ${i + 1}: ${document.fileName}`);
                    await this.processKustomizationReferences(document, content, links, diagnostics);
                }
            }

            // If no kustomization documents found, process back references
            const hasKustomizationDocs = yamlDocuments.some(doc =>
                YamlUtils.isFluxKustomizationDocument(doc) ||
                (path.basename(document.fileName).match(/^kustomization\.ya?ml$/) && YamlUtils.isStandardKustomizationDocument(doc))
            );

            if (!hasKustomizationDocs) {
                console.log(`Processing non-kustomization file: ${document.fileName}`);
                // For non-kustomization files, add links to files that reference this one
                await this.processBackReferences(document, links);
            }

            // Update diagnostics for this document
            this.diagnosticCollection.set(document.uri, diagnostics);

            console.log(`Found ${links.length} links and ${diagnostics.length} diagnostics in: ${document.fileName}`);
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

        // Process patches
        if (Array.isArray(spec.patches)) {
            for (const patch of spec.patches) {
                if (typeof patch === 'string') {
                    await this.addFluxLinkForReference(document, 'patches', patch, links, diagnostics);
                } else if (patch && typeof patch === 'object' && patch.path) {
                    await this.addFluxLinkForReference(document, 'patches', patch.path, links, diagnostics);
                }
            }
        }

        // Process patchesStrategicMerge
        if (Array.isArray(spec.patchesStrategicMerge)) {
            for (const patch of spec.patchesStrategicMerge) {
                if (typeof patch === 'string') {
                    await this.addFluxLinkForReference(document, 'patchesStrategicMerge', patch, links, diagnostics);
                }
            }
        }

        // Process patchesJson6902
        if (Array.isArray(spec.patchesJson6902)) {
            for (const patch of spec.patchesJson6902) {
                if (patch && typeof patch === 'object' && patch.path) {
                    await this.addFluxLinkForReference(document, 'patchesJson6902', patch.path, links, diagnostics);
                }
            }
        }

        // Process components
        if (Array.isArray(spec.components)) {
            for (const component of spec.components) {
                if (typeof component === 'string') {
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
            'patches',
            'patchesStrategicMerge',
            'configurations',
            'crds',
            'generators',
            'transformers'
        ];

        for (const field of referenceFields) {
            if (Array.isArray(content[field])) {
                console.log(`Found ${content[field].length} entries in ${field}`);
                for (const reference of content[field]) {
                    await this.addStandardLinkForReference(document, reference, baseDir, links, diagnostics);
                }
            }
        }

        // Handle JSON 6902 patches which have a path field
        if (Array.isArray(content.patchesJson6902)) {
            for (const patch of content.patchesJson6902) {
                if (patch.path) {
                    await this.addStandardLinkForReference(document, patch.path, baseDir, links, diagnostics);
                }
            }
        }
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
        console.log(`Found ${backReferences.length} back references for: ${document.fileName}`);

        if (backReferences.length > 0) {
            // Add a comment at the top of the file showing the back references
            const firstLine = document.lineAt(0);
            const range = new vscode.Range(
                new vscode.Position(0, 0),
                new vscode.Position(0, 0)
            );

            for (const ref of backReferences) {
                const uri = vscode.Uri.file(ref);
                const linkRange = new vscode.Range(
                    firstLine.range.start,
                    firstLine.range.start.translate(0, 30)
                );
                const docLink = new vscode.DocumentLink(linkRange, uri);
                docLink.tooltip = `Referenced by: ${path.basename(ref)}`;
                links.push(docLink);
                console.log(`Added back reference link to: ${ref}`);
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
        console.log(`Adding Flux link for ${fieldName}: ${reference}`);

        try {
            // Find the reference in the document text
            const text = document.getText();
            const referenceIndex = YamlUtils.findReferenceInText(text, reference);

            if (referenceIndex === -1) {
                console.log(`Could not find Flux reference ${reference} in document text`);
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

            console.log(`Flux path resolved: ${reference} → ${resolvedPath} (via Git root: ${gitRoot})`);

            // Create position and range for the link
            const pos = document.positionAt(referenceIndex);
            const range = new vscode.Range(
                pos,
                pos.translate(0, reference.length)
            );

            // Check if the target exists
            let fileExists = fs.existsSync(resolvedPath);
            let targetPath = resolvedPath;
            let targetIsKustomization = false;

            // For Flux Kustomization paths, we expect them to point to directories containing kustomization files
            if (fileExists && fs.statSync(resolvedPath).isDirectory()) {
                const kustomizationPath = path.join(resolvedPath, 'kustomization.yaml');
                const kustomizationPathYml = path.join(resolvedPath, 'kustomization.yml');

                if (fs.existsSync(kustomizationPath)) {
                    targetPath = kustomizationPath;
                    targetIsKustomization = true;
                    fileExists = true;
                    console.log(`Found kustomization.yaml inside Flux target directory: ${targetPath}`);
                } else if (fs.existsSync(kustomizationPathYml)) {
                    targetPath = kustomizationPathYml;
                    targetIsKustomization = true;
                    fileExists = true;
                    console.log(`Found kustomization.yml inside Flux target directory: ${targetPath}`);
                } else {
                    // Directory exists but no kustomization file
                    console.log(`Flux target directory exists but contains no kustomization file: ${resolvedPath}`);
                    fileExists = false; // Mark as not found since we need a kustomization file
                }
            } else if (fileExists && fs.statSync(resolvedPath).isFile()) {
                // If it's already a file, check if it's a kustomization file
                if (this.parser.isKustomizationFile(resolvedPath)) {
                    targetIsKustomization = true;
                    console.log(`Flux target is already a kustomization file: ${targetPath}`);
                } else {
                    console.log(`Flux target is a regular file: ${targetPath}`);
                }
            } else {
                // Path doesn't exist at all
                console.log(`Flux target path does not exist: ${resolvedPath}`);
                fileExists = false;
            }

            // Create the link only if we found a valid target
            if (fileExists) {
                const uri = vscode.Uri.file(targetPath);
                const docLink = new vscode.DocumentLink(range, uri);

                // Create appropriate tooltip
                if (fieldName === 'path') {
                    docLink.tooltip = targetIsKustomization
                        ? `Open kustomization: ${path.basename(targetPath)} in ${reference}`
                        : `Open file: ${path.basename(targetPath)} in ${reference}`;
                } else {
                    docLink.tooltip = `Open Flux ${fieldName}: ${path.basename(targetPath)}`;
                }

                links.push(docLink);
                console.log(`Added Flux link to kustomization file: ${targetPath}`);
            } else {
                // Add diagnostic for missing file/directory
                let errorMessage: string;
                if (fs.existsSync(resolvedPath)) {
                    errorMessage = `Directory found but no kustomization.yaml file inside: ${reference}`;
                } else {
                    errorMessage = `Flux reference not found: ${reference} (resolved to: ${resolvedPath})`;
                }

                const diagnostic = new vscode.Diagnostic(
                    range,
                    errorMessage,
                    vscode.DiagnosticSeverity.Warning
                );
                diagnostic.source = 'Flux Kustomize Navigator';
                diagnostics.push(diagnostic);
                console.log(`Added diagnostic for missing Flux reference: ${errorMessage}`);
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
        console.log(`Trying to add standard link for reference: ${reference}`);

        try {
            // Find the reference in the document text
            const text = document.getText();
            const referenceIndex = YamlUtils.findReferenceInText(text, reference);

            if (referenceIndex === -1) {
                console.log(`Could not find reference ${reference} in document text`);
                return;
            }

            // Resolve the reference to a file path (relative to file location)
            let resolvedPath = path.resolve(baseDir, reference);
            console.log(`Standard path resolved: ${reference} → ${resolvedPath}`);

            // Create position and range for the link
            const pos = document.positionAt(referenceIndex);
            const range = new vscode.Range(
                pos,
                pos.translate(0, reference.length)
            );

            // Check if the file exists
            let fileExists = fs.existsSync(resolvedPath);
            let targetIsKustomization = false;

            // If it's a directory, look for kustomization.yaml inside
            if (fileExists && fs.statSync(resolvedPath).isDirectory()) {
                const kustomizationPath = path.join(resolvedPath, 'kustomization.yaml');
                const kustomizationPathYml = path.join(resolvedPath, 'kustomization.yml');

                if (fs.existsSync(kustomizationPath)) {
                    resolvedPath = kustomizationPath;
                    targetIsKustomization = true;
                    console.log(`Found kustomization.yaml inside directory`);
                } else if (fs.existsSync(kustomizationPathYml)) {
                    resolvedPath = kustomizationPathYml;
                    targetIsKustomization = true;
                    console.log(`Found kustomization.yml inside directory`);
                } else {
                    fileExists = false;
                    console.log(`Directory exists but no kustomization file found inside`);
                }
            }

            // Create link if file exists
            if (fileExists) {
                // Create and add the document link with a simple tooltip
                const uri = vscode.Uri.file(resolvedPath);
                const docLink = new vscode.DocumentLink(range, uri);
                docLink.tooltip = targetIsKustomization
                    ? `Go to kustomization: ${reference} (file relative)`
                    : `Go to ${reference} (file relative)`;

                links.push(docLink);
                console.log(`Added standard link to ${resolvedPath}`);
            } else {
                // Add a diagnostic for missing file
                const diagnostic = new vscode.Diagnostic(
                    range,
                    `Referenced file not found: ${reference} (resolved to: ${resolvedPath})`,
                    vscode.DiagnosticSeverity.Warning
                );
                diagnostic.source = 'Kustomize Navigator';
                diagnostics.push(diagnostic);
                console.log(`Added diagnostic for missing file: ${reference} -> ${resolvedPath}`);

                // Still add a link, but it will point to a non-existent file
                const uri = vscode.Uri.file(resolvedPath);
                const docLink = new vscode.DocumentLink(range, uri);
                docLink.tooltip = `File not found: ${reference} (resolved to: ${resolvedPath})`;
                links.push(docLink);
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
            console.log(`Git root found for ${filePath}: ${gitRoot}`);
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