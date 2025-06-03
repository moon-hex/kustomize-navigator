import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { glob } from 'glob';

// Interface for parsed kustomization file
export interface KustomizationPatch {
    path?: string;
    target?: {
        kind?: string;
        name?: string;
        [key: string]: any;
    };
    [key: string]: any;
}

export interface KustomizationFile {
    filePath: string;
    resources: string[];
    bases: string[];
    patches: (string | KustomizationPatch)[];
    patchesStrategicMerge: string[];
    patchesJson6902: KustomizationPatch[];
    components: string[];
    configurations: string[];
    crds: string[];
    generators: string[];
    transformers: string[];
}

// Interface for reference map
export interface KustomizeReferenceMap {
    // Map of file paths to the files they reference
    fileReferences: Map<string, string[]>;
    // Map of file paths to the files that reference them
    fileBackReferences: Map<string, string[]>;
}

export class KustomizeParser {
    private referenceMap: KustomizeReferenceMap = {
        fileReferences: new Map<string, string[]>(),
        fileBackReferences: new Map<string, string[]>()
    };

    constructor(private workspaceRoot: string) { }

    /**
     * Check if a YAML file is a Kustomize file by examining its content
     */
    public isKustomizationFile(filePath: string): boolean {
        try {
            const fileContent = fs.readFileSync(filePath, 'utf8');
            const parsed = yaml.load(fileContent) as any;

            if (!parsed) {
                return false;
            }

            // Check for Flux Kustomization CR first
            if (parsed.apiVersion === 'kustomize.toolkit.fluxcd.io/v1beta2' ||
                parsed.apiVersion === 'kustomize.toolkit.fluxcd.io/v1beta1' ||
                parsed.apiVersion === 'kustomize.toolkit.fluxcd.io/v1') {
                return parsed.kind === 'Kustomization';
            }

            // Check for standard Kubernetes kustomization files
            if (parsed.apiVersion &&
                (parsed.apiVersion.startsWith('kustomize.config.k8s.io/'))) {
                return parsed.kind === 'Kustomization';
            }

            // For older kustomization files without explicit apiVersion, check for common fields
            const kustomizeFields = [
                'resources', 'bases', 'patchesStrategicMerge', 'patchesJson6902',
                'configMapGenerator', 'secretGenerator', 'generatorOptions',
                'namePrefix', 'nameSuffix', 'commonLabels', 'commonAnnotations'
            ];

            // Count how many Kustomize fields are present
            const fieldCount = kustomizeFields.filter(field => field in parsed).length;

            // If at least 2 Kustomize-specific fields are present, consider it a Kustomization
            return fieldCount >= 2;
        } catch (error) {
            console.error(`Error checking if ${filePath} is a Kustomization file:`, error);
            return false;
        }
    }
    /**
    * Check if a file is a Flux Kustomization CR specifically
    */
    public isFluxKustomizationFile(filePath: string): boolean {
        try {
            const fileContent = fs.readFileSync(filePath, 'utf8');
            const parsed = yaml.load(fileContent) as any;

            if (!parsed) {
                return false;
            }

            return (parsed.apiVersion === 'kustomize.toolkit.fluxcd.io/v1beta2' ||
                parsed.apiVersion === 'kustomize.toolkit.fluxcd.io/v1beta1' ||
                parsed.apiVersion === 'kustomize.toolkit.fluxcd.io/v1') &&
                parsed.kind === 'Kustomization';
        } catch (error) {
            console.error(`Error checking if ${filePath} is a Flux Kustomization:`, error);
            return false;
        }
    }
    /**
     * Find all kustomization files in the workspace
     */
    public async findKustomizationFiles(): Promise<string[]> {
        try {
            // Find standard kustomization files
            const kustomizationFiles = await glob('**/kustomization.{yaml,yml}', {
                cwd: this.workspaceRoot,
                ignore: ['**/node_modules/**']
            });

            // Find Flux Kustomization CRs in all YAML files
            const allYamlFiles = await glob('**/*.{yaml,yml}', {
                cwd: this.workspaceRoot,
                ignore: ['**/node_modules/**', '**/kustomization.{yaml,yml}'] // Exclude already found files
            });

            const fluxKustomizations: string[] = [];

            // Check each YAML file to see if it's a Flux Kustomization
            for (const file of allYamlFiles) {
                const absolutePath = path.join(this.workspaceRoot, file);
                if (this.isFluxKustomizationFile(absolutePath)) {
                    fluxKustomizations.push(file);
                }
            }

            // Combine both types and make paths absolute
            const allFiles = [...kustomizationFiles, ...fluxKustomizations];
            const absolutePaths = allFiles.map(file => path.join(this.workspaceRoot, file));

            console.log(`Found ${kustomizationFiles.length} standard kustomization files and ${fluxKustomizations.length} Flux Kustomization CRs`);

            return absolutePaths;
        } catch (err) {
            console.error('Error finding kustomization files:', err);
            return [];
        }
    }

    // Rest of the class remains the same...
    // [remaining code is identical to the previous implementation]

    /**
     * Parse a single kustomization file
     */
    public parseKustomizationFile(filePath: string): KustomizationFile | null {
        try {
            const fileContent = fs.readFileSync(filePath, 'utf8');
            const parsed = yaml.load(fileContent) as any;

            if (!parsed) {
                return null;
            }

            // Handle Flux Kustomization CR
            if (this.isFluxKustomizationFile(filePath)) {
                return this.parseFluxKustomization(filePath, parsed);
            }

            // Handle standard kustomization.yaml
            return this.parseStandardKustomization(filePath, parsed);
        } catch (error) {
            console.log(`Error parsing file ${filePath}:`, error);
            return null;
        }
    }

    /**
     * Parse a Flux Kustomization CR
     */
    private parseFluxKustomization(filePath: string, parsed: any): KustomizationFile | null {
        if (!parsed.spec) {
            return null;
        }

        const spec = parsed.spec;

        return {
            filePath,
            // Flux Kustomizations reference a path in a source, not direct file references
            // But they can have patches and other references
            resources: [], // Flux Kustomizations don't directly list resources
            bases: [], // Flux uses sourceRef instead of bases
            patches: Array.isArray(spec.patches) ? spec.patches : [],
            patchesStrategicMerge: Array.isArray(spec.patchesStrategicMerge) ? spec.patchesStrategicMerge : [],
            patchesJson6902: Array.isArray(spec.patchesJson6902) ? spec.patchesJson6902 : [],
            components: Array.isArray(spec.components) ? spec.components : [],
            configurations: [], // Not typically used in Flux Kustomizations
            crds: [], // Not typically used in Flux Kustomizations
            generators: [], // Not typically used in Flux Kustomizations
            transformers: [], // Not typically used in Flux Kustomizations
        };
    }

    /**
     * Resolve a relative path reference from a kustomization file
     */
    private resolveReference(basePath: string, reference: string): string {
        // Handle both file and directory references
        const baseDir = path.dirname(basePath);
        const resolvedPath = path.resolve(baseDir, reference);

        // Check if it's a directory reference that might point to a kustomization file
        if (fs.existsSync(resolvedPath) && fs.statSync(resolvedPath).isDirectory()) {
            const kustomizationPath = path.join(resolvedPath, 'kustomization.yaml');
            const kustomizationPathYml = path.join(resolvedPath, 'kustomization.yml');

            if (fs.existsSync(kustomizationPath)) {
                return kustomizationPath;
            } else if (fs.existsSync(kustomizationPathYml)) {
                return kustomizationPathYml;
            }
        }

        return resolvedPath;
    }
    /**
     * Parse a standard kustomization.yaml file
     */
    private parseStandardKustomization(filePath: string, parsed: any): KustomizationFile {
        return {
            filePath,
            resources: Array.isArray(parsed.resources) ? parsed.resources : [],
            bases: Array.isArray(parsed.bases) ? parsed.bases : [],
            patches: Array.isArray(parsed.patches) ? parsed.patches : [],
            patchesStrategicMerge: Array.isArray(parsed.patchesStrategicMerge) ? parsed.patchesStrategicMerge : [],
            patchesJson6902: Array.isArray(parsed.patchesJson6902) ? parsed.patchesJson6902 : [],
            components: Array.isArray(parsed.components) ? parsed.components : [],
            configurations: Array.isArray(parsed.configurations) ? parsed.configurations : [],
            crds: Array.isArray(parsed.crds) ? parsed.crds : [],
            generators: Array.isArray(parsed.generators) ? parsed.generators : [],
            transformers: Array.isArray(parsed.transformers) ? parsed.transformers : [],
        };
    }
    /**
     * Build the reference map for all kustomization files
     */
    public async buildReferenceMap(): Promise<KustomizeReferenceMap> {
        this.referenceMap = {
            fileReferences: new Map<string, string[]>(),
            fileBackReferences: new Map<string, string[]>()
        };

        const kustomizationFiles = await this.findKustomizationFiles();

        for (const filePath of kustomizationFiles) {
            const kustomization = this.parseKustomizationFile(filePath);
            if (!kustomization) continue;

            const references: string[] = [];

            // Process all reference types
            const addReferences = (paths: (string | KustomizationPatch)[]) => {
                for (const refPath of paths) {
                    try {
                        // Handle both string and object paths
                        let resolvedPath;
                        if (typeof refPath === 'string') {
                            resolvedPath = this.resolveReference(filePath, refPath);
                        } else if (refPath && typeof refPath === 'object' && refPath.path) {
                            resolvedPath = this.resolveReference(filePath, refPath.path);
                        } else {
                            // Skip invalid references
                            continue;
                        }

                        references.push(resolvedPath);

                        // Update back-references
                        if (!this.referenceMap.fileBackReferences.has(resolvedPath)) {
                            this.referenceMap.fileBackReferences.set(resolvedPath, []);
                        }
                        this.referenceMap.fileBackReferences.get(resolvedPath)!.push(filePath);
                    } catch (error) {
                        console.warn(`Failed to resolve reference ${JSON.stringify(refPath)} from ${filePath}:`, error);
                    }
                }
            };

            // Add all reference types
            addReferences(kustomization.resources);
            addReferences(kustomization.bases);
            addReferences(kustomization.components);
            addReferences(kustomization.patches);
            addReferences(kustomization.patchesStrategicMerge);
            addReferences(kustomization.configurations);
            addReferences(kustomization.crds);

            // Handle JSON 6902 patches which have a path field
            kustomization.patchesJson6902.forEach(patch => {
                if (patch.path) {
                    addReferences([patch.path]);
                }
            });

            // Store references for this file
            this.referenceMap.fileReferences.set(filePath, references);
        }

        return this.referenceMap;
    }

    /**
     * Get references for a specific file
     */
    public getReferencesForFile(filePath: string): string[] {
        return this.referenceMap.fileReferences.get(filePath) || [];
    }

    /**
     * Get back-references for a specific file (files that reference this file)
     */
    public getBackReferencesForFile(filePath: string): string[] {
        return this.referenceMap.fileBackReferences.get(filePath) || [];
    }
    /**
 * Check if a path is a directory
 */
    public isDirectory(filePath: string): boolean {
        try {
            return fs.existsSync(filePath) && fs.statSync(filePath).isDirectory();
        } catch (error) {
            return false;
        }
    }

    /**
     * Check if a file exists
     */
    public fileExists(filePath: string): boolean {
        try {
            return fs.existsSync(filePath) && fs.statSync(filePath).isFile();
        } catch (error) {
            return false;
        }
    }
}