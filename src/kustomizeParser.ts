import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { glob } from 'glob';
import { execSync } from 'child_process';

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

    // Cache for Git root detection
    private gitRootCache = new Map<string, string>();

    constructor(private workspaceRoot: string) { }

    /**
     * Find Git repository root for a given file path
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
            // Fallback to workspace root if git command fails
            console.warn(`Git command failed for ${filePath}, using workspace root`);
            this.gitRootCache.set(cacheKey, this.workspaceRoot);
            return this.workspaceRoot;
        }
    }

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
     * Parse a kustomization file (handles both types)
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
                const result = this.parseFluxKustomization(filePath, parsed);
                return result ? result.kustomization : null;
            }

            // Handle standard kustomization.yaml
            return this.parseStandardKustomization(filePath, parsed);
        } catch (error) {
            console.log(`Error parsing file ${filePath}:`, error);
            return null;
        }
    }

    /**
     * Get resolved references for a Flux Kustomization CR
     */
    private getFluxResolvedReferences(filePath: string): string[] {
        try {
            const fileContent = fs.readFileSync(filePath, 'utf8');
            const parsed = yaml.load(fileContent) as any;

            if (!parsed || !this.isFluxKustomizationFile(filePath)) {
                return [];
            }

            const result = this.parseFluxKustomization(filePath, parsed);
            return result ? result.resolvedReferences : [];
        } catch (error) {
            console.log(`Error getting Flux references for ${filePath}:`, error);
            return [];
        }
    }

    /**
     * Parse a Flux Kustomization CR with Git root-relative path resolution
     */
    private parseFluxKustomization(filePath: string, parsed: any): { kustomization: KustomizationFile; resolvedReferences: string[] } | null {
        if (!parsed.spec) {
            return null;
        }

        const spec = parsed.spec;
        const references: string[] = [];

        // Handle spec.path - resolve relative to Git root
        if (spec.path && typeof spec.path === 'string') {
            const resolvedPath = this.resolveReference(filePath, spec.path);

            // Check if path points to directory with kustomization.yaml
            if (this.isDirectory(resolvedPath)) {
                const kustomizationYaml = path.join(resolvedPath, 'kustomization.yaml');
                const kustomizationYml = path.join(resolvedPath, 'kustomization.yml');

                if (this.fileExists(kustomizationYaml)) {
                    references.push(kustomizationYaml);
                } else if (this.fileExists(kustomizationYml)) {
                    references.push(kustomizationYml);
                }
            } else if (this.fileExists(resolvedPath)) {
                references.push(resolvedPath);
            }
        }

        // Handle patches - also resolve relative to Git root
        const processPatchReferences = (patches: any[]) => {
            patches.forEach(patch => {
                let patchPath: string | undefined;

                if (typeof patch === 'string') {
                    patchPath = patch;
                } else if (patch && typeof patch === 'object' && patch.path) {
                    patchPath = patch.path;
                }

                if (patchPath) {
                    const resolvedPath = this.resolveReference(filePath, patchPath);
                    if (this.fileExists(resolvedPath)) {
                        references.push(resolvedPath);
                    }
                }
            });
        };

        if (Array.isArray(spec.patches)) {
            processPatchReferences(spec.patches);
        }
        if (Array.isArray(spec.patchesStrategicMerge)) {
            processPatchReferences(spec.patchesStrategicMerge);
        }
        if (Array.isArray(spec.patchesJson6902)) {
            processPatchReferences(spec.patchesJson6902);
        }

        const kustomization: KustomizationFile = {
            filePath,
            resources: [],
            bases: [],
            patches: Array.isArray(spec.patches) ? spec.patches : [],
            patchesStrategicMerge: Array.isArray(spec.patchesStrategicMerge) ? spec.patchesStrategicMerge : [],
            patchesJson6902: Array.isArray(spec.patchesJson6902) ? spec.patchesJson6902 : [],
            components: Array.isArray(spec.components) ? spec.components : [],
            configurations: [],
            crds: [],
            generators: [],
            transformers: [],
        };

        return { kustomization, resolvedReferences: references };
    }

    /**
     * Resolve reference path based on file type
     */
    private resolveReference(basePath: string, reference: string): string {
        const isFluxKustomization = this.isFluxKustomizationFile(basePath);

        if (isFluxKustomization) {
            // For Flux Kustomization CRs, resolve relative to Git repository root
            const gitRoot = this.findGitRoot(basePath);
            return path.resolve(gitRoot, reference);
        } else {
            // For standard kustomization files, resolve relative to file location
            const baseDir = path.dirname(basePath);
            return path.resolve(baseDir, reference);
        }
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
     * Enhanced build reference map with Flux support
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

            let references: string[] = [];

            if (this.isFluxKustomizationFile(filePath)) {
                // For Flux CRs, get the resolved references using separate method
                references = this.getFluxResolvedReferences(filePath);
            } else {
                // For standard kustomizations, process normally
                const addReferences = (paths: (string | KustomizationPatch)[]) => {
                    for (const refPath of paths) {
                        try {
                            let resolvedPath;
                            if (typeof refPath === 'string') {
                                resolvedPath = this.resolveReference(filePath, refPath);
                            } else if (refPath && typeof refPath === 'object' && refPath.path) {
                                resolvedPath = this.resolveReference(filePath, refPath.path);
                            } else {
                                continue;
                            }
                            references.push(resolvedPath);
                        } catch (error) {
                            console.warn(`Failed to resolve reference from ${filePath}:`, error);
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
            }

            // Store references and update back-references
            this.referenceMap.fileReferences.set(filePath, references);

            references.forEach(resolvedPath => {
                if (!this.referenceMap.fileBackReferences.has(resolvedPath)) {
                    this.referenceMap.fileBackReferences.set(resolvedPath, []);
                }
                this.referenceMap.fileBackReferences.get(resolvedPath)!.push(filePath);
            });
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