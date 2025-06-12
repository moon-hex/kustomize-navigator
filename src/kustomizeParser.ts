import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { glob } from 'glob';
import { execSync } from 'child_process';
import { YamlUtils } from './yamlUtils';

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
    // Map of file paths to the files that reference them, with type information
    fileBackReferences: Map<string, Array<{path: string, type: 'flux' | 'k8s'}>>;
}

export class KustomizeParser {
    private referenceMap: KustomizeReferenceMap = {
        fileReferences: new Map<string, string[]>(),
        fileBackReferences: new Map<string, Array<{path: string, type: 'flux' | 'k8s'}>>()
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

            // Check if any document in the file is a kustomization
            return YamlUtils.containsFluxKustomizations(fileContent) ||
                YamlUtils.containsStandardKustomizations(fileContent);
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
            return YamlUtils.containsFluxKustomizations(fileContent);
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

    /**
     * Parse a kustomization file (handles both types and multiple documents)
     */
    public parseKustomizationFile(filePath: string): KustomizationFile[] {
        try {
            const fileContent = fs.readFileSync(filePath, 'utf8');

            // Get all kustomization documents from the file
            const fluxDocs = YamlUtils.getFluxKustomizationDocuments(fileContent);
            const standardDocs = YamlUtils.getStandardKustomizationDocuments(fileContent);

            const results: KustomizationFile[] = [];

            // Process all Flux Kustomization documents
            for (const doc of fluxDocs) {
                const result = this.parseFluxKustomization(filePath, doc);
                if (result) {
                    results.push(result.kustomization);
                }
            }

            // Process all standard Kustomization documents
            for (const doc of standardDocs) {
                const result = this.parseStandardKustomization(filePath, doc);
                results.push(result);
            }

            return results;
        } catch (error) {
            console.log(`Error parsing file ${filePath}:`, error);
            return [];
        }
    }

    /**
     * Get resolved references for a Flux Kustomization CR
     */
    private getFluxResolvedReferences(filePath: string): string[] {
        try {
            const fileContent = fs.readFileSync(filePath, 'utf8');
            const fluxDocs = YamlUtils.getFluxKustomizationDocuments(fileContent);

            if (fluxDocs.length === 0) {
                return [];
            }

            // Process all Flux Kustomization documents and combine their references
            const allReferences: string[] = [];
            for (const doc of fluxDocs) {
                const result = this.parseFluxKustomization(filePath, doc);
                if (result) {
                    allReferences.push(...result.resolvedReferences);
                }
            }

            return allReferences;
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
            // Handle relative paths properly
            if (path.isAbsolute(reference)) {
                return reference;
            } else {
                // Remove leading "./" if present and resolve relative to git root
                const cleanReference = reference.startsWith('./') ? reference.slice(2) : reference;
                return path.resolve(gitRoot, cleanReference);
            }
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
            fileBackReferences: new Map<string, Array<{path: string, type: 'flux' | 'k8s'}>>()
        };

        const kustomizationFiles = await this.findKustomizationFiles();

        for (const filePath of kustomizationFiles) {
            const kustomizations = this.parseKustomizationFile(filePath);
            if (kustomizations.length === 0) { continue; }

            const isFluxKustomization = this.isFluxKustomizationFile(filePath);
            let references: string[] = [];

            if (isFluxKustomization) {
                // For Flux CRs, get the resolved references using separate method
                references = this.getFluxResolvedReferences(filePath);
            } else {
                // For standard kustomizations, process all documents
                for (const kustomization of kustomizations) {
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

                                // For both Flux and K8s, if the path is a directory, look for kustomization.yaml
                                if (this.isDirectory(resolvedPath)) {
                                    const kustomizationPath = path.join(resolvedPath, 'kustomization.yaml');
                                    const kustomizationPathYml = path.join(resolvedPath, 'kustomization.yml');

                                    if (this.fileExists(kustomizationPath)) {
                                        resolvedPath = kustomizationPath;
                                    } else if (this.fileExists(kustomizationPathYml)) {
                                        resolvedPath = kustomizationPathYml;
                                    }
                                }

                                // Only add the reference if it exists
                                if (this.fileExists(resolvedPath)) {
                                    references.push(resolvedPath);
                                    console.log(`Added reference: ${filePath} -> ${resolvedPath}`);
                                }
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
            }

            // Store references and update back-references
            this.referenceMap.fileReferences.set(filePath, references);

            // Update back-references for each resolved path
            references.forEach(resolvedPath => {
                // Normalize the path to ensure consistent comparison
                const normalizedPath = path.normalize(resolvedPath);
                
                if (!this.referenceMap.fileBackReferences.has(normalizedPath)) {
                    this.referenceMap.fileBackReferences.set(normalizedPath, []);
                }
                
                // Only add the back reference if it's not already there
                const backRefs = this.referenceMap.fileBackReferences.get(normalizedPath)!;
                const refType = isFluxKustomization ? 'flux' : 'k8s';
                if (!backRefs.some(ref => ref.path === filePath)) {
                    backRefs.push({ path: filePath, type: refType });
                    console.log(`Added back reference: ${normalizedPath} <- ${filePath} (${refType})`);
                }
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
    public getBackReferencesForFile(filePath: string): Array<{path: string, type: 'flux' | 'k8s'}> {
        // Normalize the path to ensure consistent lookup
        const normalizedPath = path.normalize(filePath);
        return this.referenceMap.fileBackReferences.get(normalizedPath) || [];
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