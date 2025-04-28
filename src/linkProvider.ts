import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as yaml from 'js-yaml';
import { KustomizeParser } from './kustomizeParser';

export class KustomizeLinkProvider implements vscode.DocumentLinkProvider {
    private diagnosticCollection: vscode.DiagnosticCollection;

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
            // Try to parse the YAML content
            const content = yaml.load(text) as any;
            if (!content) {
                console.log(`No YAML content in: ${document.fileName}`);
                return links;
            }

            // Check if this is a kustomization file
            const isKustomizationFile = path.basename(document.fileName).match(/^kustomization\.ya?ml$/);

            if (isKustomizationFile) {
                console.log(`Processing kustomization file: ${document.fileName}`);
                // Process kustomization.yaml references
                await this.processKustomizationReferences(document, content, links, diagnostics);
            } else {
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
                    await this.addLinkForReference(document, reference, baseDir, links, diagnostics);
                }
            }
        }

        // Handle JSON 6902 patches which have a path field
        if (Array.isArray(content.patchesJson6902)) {
            for (const patch of content.patchesJson6902) {
                if (patch.path) {
                    await this.addLinkForReference(document, patch.path, baseDir, links, diagnostics);
                }
            }
        }
    }

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

    private async addLinkForReference(
        document: vscode.TextDocument,
        reference: string,
        baseDir: string,
        links: vscode.DocumentLink[],
        diagnostics: vscode.Diagnostic[]
    ): Promise<void> {
        console.log(`Trying to add link for reference: ${reference}`);

        try {
            // Find the reference in the document text
            const text = document.getText();
            let referenceIndex = -1;
            let referenceLength = reference.length;

            // Try with quotes first
            const doubleQuoteIndex = text.indexOf(`"${reference}"`);
            const singleQuoteIndex = text.indexOf(`'${reference}'`);

            if (doubleQuoteIndex !== -1) {
                referenceIndex = doubleQuoteIndex + 1; // +1 to skip the quote
            } else if (singleQuoteIndex !== -1) {
                referenceIndex = singleQuoteIndex + 1; // +1 to skip the quote
            } else {
                // Try finding without quotes (YAML list items)
                // Look for pattern like "- reference" or "  - reference"
                const regExp = new RegExp(`[\\s-]+${reference}(?=[\\s,]|$)`, 'g');
                const match = regExp.exec(text);

                if (match) {
                    // Calculate the position where the actual reference starts (after "- ")
                    const matchStart = match.index;
                    const prefixLength = match[0].length - reference.length;
                    referenceIndex = matchStart + prefixLength;
                }
            }

            if (referenceIndex === -1) {
                console.log(`Could not find reference ${reference} in document text`);
                return;
            }

            // Resolve the reference to a file path
            let resolvedPath = path.resolve(baseDir, reference);
            console.log(`Resolved path: ${resolvedPath}`);

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
                    ? `Go to kustomization: ${reference}` 
                    : `Go to ${reference}`;
                    
                links.push(docLink);
                console.log(`Added link to ${resolvedPath}`);
            } else {
                // Add a diagnostic for missing file
                const diagnostic = new vscode.Diagnostic(
                    range,
                    `Referenced file not found: ${reference}`,
                    vscode.DiagnosticSeverity.Warning
                );
                diagnostic.source = 'Kustomize Navigator';
                diagnostics.push(diagnostic);
                console.log(`Added diagnostic for missing file: ${reference}`);

                // Still add a link, but it will point to a non-existent file
                const uri = vscode.Uri.file(resolvedPath);
                const docLink = new vscode.DocumentLink(range, uri);
                docLink.tooltip = `File not found: ${reference}`;
                links.push(docLink);
            }
        } catch (error) {
            console.error(`Error creating link for ${reference}:`, error);
        }
    }

    public dispose(): void {
        this.diagnosticCollection.dispose();
    }
}