import * as yaml from 'js-yaml';

/**
 * Utility functions for parsing and analyzing YAML documents
 */
export class YamlUtils {
    /**
     * Parse multiple YAML documents from a single file
     */
    public static parseMultipleYamlDocuments(text: string): any[] {
        const documents: any[] = [];

        try {
            // Split by document separator and parse each
            const yamlDocs = text.split(/^---\s*$/m);

            for (const docText of yamlDocs) {
                const trimmed = docText.trim();
                if (!trimmed) { continue; }

                try {
                    const parsed = yaml.load(trimmed) as any;
                    if (parsed && typeof parsed === 'object') {
                        documents.push(parsed);
                    }
                } catch (error) {
                    console.warn(`Failed to parse YAML document:`, error);
                    // Continue with other documents
                }
            }
        } catch (error) {
            console.error(`Error parsing multiple YAML documents:`, error);
        }

        return documents;
    }

    /**
     * Check if a parsed YAML document is a Flux Kustomization CR
     */
    public static isFluxKustomizationDocument(content: any): boolean {
        if (!content || typeof content !== 'object') { return false; }

        return (content.apiVersion === 'kustomize.toolkit.fluxcd.io/v1beta2' ||
            content.apiVersion === 'kustomize.toolkit.fluxcd.io/v1beta1' ||
            content.apiVersion === 'kustomize.toolkit.fluxcd.io/v1') &&
            content.kind === 'Kustomization';
    }

    /**
     * Check if a parsed YAML document is a standard kustomization
     */
    public static isStandardKustomizationDocument(content: any): boolean {
        if (!content || typeof content !== 'object') { return false; }

        // Check for standard Kubernetes kustomization files
        if (content.apiVersion &&
            (content.apiVersion.startsWith('kustomize.config.k8s.io/'))) {
            return content.kind === 'Kustomization';
        }

        // For older kustomization files without explicit apiVersion, check for common fields
        const kustomizeFields = [
            'resources', 'bases', 'patchesStrategicMerge', 'patchesJson6902',
            'configMapGenerator', 'secretGenerator', 'generatorOptions',
            'namePrefix', 'nameSuffix', 'commonLabels', 'commonAnnotations'
        ];

        // Count how many Kustomize fields are present
        const fieldCount = kustomizeFields.filter(field => field in content).length;

        // If at least 2 Kustomize-specific fields are present, consider it a Kustomization
        return fieldCount >= 2;
    }

    /**
     * Check if any document in a YAML file contains Flux Kustomization CRs
     */
    public static containsFluxKustomizations(text: string): boolean {
        const documents = this.parseMultipleYamlDocuments(text);
        return documents.some(doc => this.isFluxKustomizationDocument(doc));
    }

    /**
     * Check if any document in a YAML file contains standard kustomizations
     */
    public static containsStandardKustomizations(text: string): boolean {
        const documents = this.parseMultipleYamlDocuments(text);
        return documents.some(doc => this.isStandardKustomizationDocument(doc));
    }

    /**
     * Get all Flux Kustomization documents from a YAML file
     */
    public static getFluxKustomizationDocuments(text: string): any[] {
        const documents = this.parseMultipleYamlDocuments(text);
        return documents.filter(doc => this.isFluxKustomizationDocument(doc));
    }

    /**
     * Get all standard kustomization documents from a YAML file
     */
    public static getStandardKustomizationDocuments(text: string): any[] {
        const documents = this.parseMultipleYamlDocuments(text);
        return documents.filter(doc => this.isStandardKustomizationDocument(doc));
    }

    /**
     * Find a reference string in the document text, handling quotes and YAML syntax
     */
    public static findReferenceInText(text: string, reference: string): number {
        // Try with double quotes first
        let index = text.indexOf(`"${reference}"`);
        if (index !== -1) {
            return index + 1; // +1 to skip the quote
        }

        // Try with single quotes
        index = text.indexOf(`'${reference}'`);
        if (index !== -1) {
            return index + 1; // +1 to skip the quote
        }

        // Try without quotes (YAML unquoted string)
        // Look for pattern like "path: reference" or "- reference"
        const patterns = [
            new RegExp(`path:\\s*${YamlUtils.escapeRegex(reference)}(?=\\s|$)`, 'g'),
            new RegExp(`-\\s*${YamlUtils.escapeRegex(reference)}(?=\\s|$)`, 'g'),
            new RegExp(`:\\s*${YamlUtils.escapeRegex(reference)}(?=\\s|$)`, 'g')
        ];

        for (const pattern of patterns) {
            const match = pattern.exec(text);
            if (match) {
                // Find where the reference starts within the match
                const matchStart = match.index;
                const matchText = match[0];
                const refStart = matchText.indexOf(reference);
                return matchStart + refStart;
            }
        }

        return -1;
    }

    /**
     * Escape special regex characters
     */
    public static escapeRegex(string: string): string {
        return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
}