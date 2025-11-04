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
     * Supports finding references in both string format and object format (e.g., path: reference)
     */
    public static findReferenceInText(text: string, reference: string): number {
        // Try with double quotes first (exact match)
        let index = text.indexOf(`"${reference}"`);
        if (index !== -1) {
            return index + 1; // +1 to skip the quote
        }

        // Try with single quotes (exact match)
        index = text.indexOf(`'${reference}'`);
        if (index !== -1) {
            return index + 1; // +1 to skip the quote
        }

        // Escape the reference for regex (handles special characters)
        const escapedRef = YamlUtils.escapeRegex(reference);
        
        // Word boundary check - ensure reference is not part of a larger word
        // For file paths, we want exact matches but allow them to be part of quoted strings
        // Use negative lookbehind and lookahead to ensure boundaries
        // Allow whitespace, colons, quotes, brackets, commas before/after
        const wordBoundaryStart = '(?<![\\w\\-./\\\\])'; // Not preceded by word char, hyphen, dot, slash, or backslash
        const wordBoundaryEnd = '(?![\\w\\-./\\\\])';   // Not followed by word char, hyphen, dot, slash, or backslash
        
        // Build patterns for various YAML formats
        const patterns = [
            // 1. Match "path: reference" (same line, with optional trailing comment or whitespace)
            //    Example: path: patch.yaml or path: patch.yaml # comment
            new RegExp(`path:\\s*${wordBoundaryStart}${escapedRef}${wordBoundaryEnd}(?=\\s|$|#|\\n|,|\\}|\\])`, 'g'),
            
            // 2. Match "- reference" (array item, block style)
            //    Example: - patch.yaml or - patch.yaml # comment
            new RegExp(`-\\s+${wordBoundaryStart}${escapedRef}${wordBoundaryEnd}(?=\\s|$|#|\\n|,|\\}|\\])`, 'g'),
            
            // 3. Match multiline YAML: "path:\n  reference" (with indentation)
            //    Example: path:\n    patch.yaml
            new RegExp(`path:\\s*\\n([ \\t]+)${wordBoundaryStart}${escapedRef}${wordBoundaryEnd}(?=\\s|$|#|\\n|,|\\}|\\])`, 'g'),
            
            // 4. Match flow style array: "[reference]" or "[reference1, reference2]"
            //    Example: [patch.yaml] or [patch1.yaml, patch2.yaml]
            new RegExp(`\\[\\s*${wordBoundaryStart}${escapedRef}${wordBoundaryEnd}\\s*[,\\]]`, 'g'),
            
            // 5. Match flow style object: "{path: reference}" or "{path: reference, ...}"
            //    Example: {path: patch.yaml} or {path: patch.yaml, target: {...}}
            new RegExp(`\\{[^}]*path:\\s*${wordBoundaryStart}${escapedRef}${wordBoundaryEnd}(?=\\s|,|\\}|$)`, 'g'),
            
            // 6. Match as standalone value after colon (but not if it's part of another key)
            //    Example: resources: [patch.yaml] or resources:\n  - patch.yaml
            //    This is more specific - only match if it's a simple value or in a list context
            new RegExp(`(?:^|\\n)\\s*\\w+\\s*:\\s*${wordBoundaryStart}${escapedRef}${wordBoundaryEnd}(?=\\s|$|#|\\n|,|\\}|\\])`, 'gm')
        ];

        for (const pattern of patterns) {
            // Reset regex lastIndex to search from beginning
            pattern.lastIndex = 0;
            const match = pattern.exec(text);
            if (match) {
                // Find where the reference starts within the match
                const matchStart = match.index;
                const matchText = match[0];
                const refStart = matchText.indexOf(reference);
                if (refStart !== -1) {
                    return matchStart + refStart;
                }
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