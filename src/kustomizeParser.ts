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

// Interface for file metadata tracking
interface FileMetadata {
    mtime: number; // File modification time
    references: string[]; // Cached references
    isFluxKustomization: boolean;
}

// Interface for cached file stats
interface CachedFileStat {
    mtime: number;
    isDirectory: boolean;
    isFile: boolean;
}

// Constant for non-existent file modification time
const NON_EXISTENT_FILE_MTIME = 0;

export class KustomizeParser {
    private referenceMap: KustomizeReferenceMap = {
        fileReferences: new Map<string, string[]>(),
        fileBackReferences: new Map<string, Array<{path: string, type: 'flux' | 'k8s'}>>()
    };

    // Cache for Git root detection
    private gitRootCache = new Map<string, string>();
    
    // Cache for file metadata to detect changes
    private fileMetadataCache = new Map<string, FileMetadata>();
    
    // Track which files reference which files (for dependency updates)
    private fileDependencyMap = new Map<string, Set<string>>();
    
    // Cache for file existence checks
    private fileExistsCache = new Map<string, { exists: boolean; mtime: number }>();
    
    // Cache for file stats
    private fileStatCache = new Map<string, CachedFileStat>();
    
    // Flag to enable/disable caching
    private enableFileSystemCache: boolean;

    constructor(private workspaceRoot: string, enableFileSystemCache: boolean = true) {
        this.enableFileSystemCache = enableFileSystemCache;
    }

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
            console.error(`Error parsing file ${filePath}:`, error);
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
            console.error(`Error getting Flux references for ${filePath}:`, error);
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
                // Skip null/undefined array elements
                if (patch === null || patch === undefined) {
                    return;
                }
                
                let patchPath: string | undefined;

                if (typeof patch === 'string') {
                    patchPath = patch;
                } else if (typeof patch === 'object' && patch.path) {
                    // Object format with path: patches: [{path: patch.yaml, target: {...}}]
                    patchPath = patch.path;
                }
                // Skip objects without path property (e.g., inline patches with only 'patch' field)

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
     * Get cached file stat or fetch from filesystem
     * Trusts cache entries (no validation on access) - relies on file watcher for invalidation
     */
    private getCachedStat(filePath: string): CachedFileStat | null {
        const normalizedPath = path.normalize(filePath);
        
        // If caching is disabled, fetch directly from filesystem
        if (!this.enableFileSystemCache) {
            try {
                const stat = fs.statSync(normalizedPath);
                return {
                    mtime: stat.mtimeMs,
                    isDirectory: stat.isDirectory(),
                    isFile: stat.isFile()
                };
            } catch {
                return null;
            }
        }
        
        // Check cache first - trust it by default (no validation)
        const cached = this.fileStatCache.get(normalizedPath);
        if (cached) {
            return cached;
        }
        
        // Cache miss - fetch from filesystem
        try {
            const stat = fs.statSync(normalizedPath);
            const cachedStat: CachedFileStat = {
                mtime: stat.mtimeMs,
                isDirectory: stat.isDirectory(),
                isFile: stat.isFile()
            };
            
            this.fileStatCache.set(normalizedPath, cachedStat);
            this.fileExistsCache.set(normalizedPath, { exists: true, mtime: stat.mtimeMs });
            
            return cachedStat;
        } catch (error) {
            // File doesn't exist or error accessing it
            this.fileExistsCache.set(normalizedPath, { exists: false, mtime: NON_EXISTENT_FILE_MTIME });
            this.fileStatCache.delete(normalizedPath);
            return null;
        }
    }

    /**
     * Check if file exists (cached if enabled)
     * Trusts cache entries (no validation on access) - relies on file watcher for invalidation
     * Includes safety fallback: if file operation fails unexpectedly, validates that entry
     */
    public cachedFileExists(filePath: string): boolean {
        const normalizedPath = path.normalize(filePath);
        
        // If caching is disabled, check directly
        if (!this.enableFileSystemCache) {
            try {
                return fs.existsSync(normalizedPath);
            } catch {
                return false;
            }
        }
        
        // Check cache first - trust it by default (no validation)
        const cached = this.fileExistsCache.get(normalizedPath);
        if (cached) {
            // If cached as non-existent, return immediately
            if (!cached.exists) {
                return false;
            }
            
            // Cached as exists - trust it, but we'll validate on actual file operation if it fails
            return true;
        }
        
        // Cache miss - check filesystem and cache result
        try {
            const stat = fs.statSync(normalizedPath);
            this.fileExistsCache.set(normalizedPath, { exists: true, mtime: stat.mtimeMs });
            // Also cache the stat
            this.fileStatCache.set(normalizedPath, {
                mtime: stat.mtimeMs,
                isDirectory: stat.isDirectory(),
                isFile: stat.isFile()
            });
            return true;
        } catch {
            this.fileExistsCache.set(normalizedPath, { exists: false, mtime: NON_EXISTENT_FILE_MTIME });
            this.fileStatCache.delete(normalizedPath);
            return false;
        }
    }
    
    /**
     * Safety validation: if a file operation fails unexpectedly, validate and update cache
     * This is a fallback for edge cases where file watcher might miss changes
     */
    public validateAndUpdateCache(filePath: string): void {
        if (!this.enableFileSystemCache) {
            return;
        }
        
        const normalizedPath = path.normalize(filePath);
        this.invalidateFileCache(normalizedPath);
        
        // Re-check and update cache
        try {
            const stat = fs.statSync(normalizedPath);
            this.fileExistsCache.set(normalizedPath, { exists: true, mtime: stat.mtimeMs });
            this.fileStatCache.set(normalizedPath, {
                mtime: stat.mtimeMs,
                isDirectory: stat.isDirectory(),
                isFile: stat.isFile()
            });
        } catch {
            this.fileExistsCache.set(normalizedPath, { exists: false, mtime: NON_EXISTENT_FILE_MTIME });
            this.fileStatCache.delete(normalizedPath);
        }
    }

    /**
     * Check if path is a directory (cached)
     */
    public cachedIsDirectory(filePath: string): boolean {
        const stat = this.getCachedStat(filePath);
        return stat?.isDirectory ?? false;
    }

    /**
     * Get file modification time (cached)
     */
    private getFileMtime(filePath: string): number {
        const stat = this.getCachedStat(filePath);
        return stat?.mtime ?? NON_EXISTENT_FILE_MTIME;
    }
    
    /**
     * Invalidate cache entries for a file (called when file changes)
     */
    private invalidateFileCache(filePath: string): void {
        const normalizedPath = path.normalize(filePath);
        this.fileExistsCache.delete(normalizedPath);
        this.fileStatCache.delete(normalizedPath);
    }

    /**
     * Check if a file has changed since last check
     */
    private hasFileChanged(filePath: string): boolean {
        const cached = this.fileMetadataCache.get(filePath);
        if (!cached) {
            return true; // File not in cache, consider it changed
        }

        const currentMtime = this.getFileMtime(filePath);
        return currentMtime !== cached.mtime;
    }

    /**
     * Process a single file and update its references
     */
    private processFileReferences(filePath: string): string[] {
        const kustomizations = this.parseKustomizationFile(filePath);
        if (kustomizations.length === 0) {
            return [];
        }

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
                        // Skip null/undefined array elements
                        if (refPath === null || refPath === undefined) {
                            continue;
                        }
                        
                        let resolvedPath: string | undefined;
                        try {
                            if (typeof refPath === 'string') {
                                resolvedPath = this.resolveReference(filePath, refPath);
                            } else if (typeof refPath === 'object' && refPath.path) {
                                // Object format with path: patches: [{path: patch.yaml, target: {...}}]
                                resolvedPath = this.resolveReference(filePath, refPath.path);
                            } else {
                                // Skip objects without path property (e.g., inline patches with only 'patch' field)
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
                            }
                        } catch (error) {
                            console.warn(`Failed to resolve reference from ${filePath}:`, error);
                            // Safety fallback: if file operation fails unexpectedly, validate cache
                            if (resolvedPath && this.enableFileSystemCache) {
                                this.validateAndUpdateCache(resolvedPath);
                            }
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
                    // Skip null/undefined array elements
                    if (patch === null || patch === undefined) {
                        return;
                    }
                    if (typeof patch === 'object' && patch.path) {
                        addReferences([patch.path]);
                    }
                });
            }
        }

        // Update metadata cache
        this.fileMetadataCache.set(filePath, {
            mtime: this.getFileMtime(filePath),
            references: [...references],
            isFluxKustomization
        });

        return references;
    }

    /**
     * Update references for a single file and update back-references
     */
    private updateFileReferences(filePath: string): void {
        // Remove old back-references for this file
        const oldReferences = this.referenceMap.fileReferences.get(filePath) || [];
        oldReferences.forEach(oldRef => {
            const normalizedOldRef = path.normalize(oldRef);
            const backRefs = this.referenceMap.fileBackReferences.get(normalizedOldRef);
            if (backRefs) {
                const index = backRefs.findIndex(ref => ref.path === filePath);
                if (index !== -1) {
                    backRefs.splice(index, 1);
                    // Remove empty back-reference entries
                    if (backRefs.length === 0) {
                        this.referenceMap.fileBackReferences.delete(normalizedOldRef);
                    }
                }
            }
        });

        // Get new references
        const newReferences = this.processFileReferences(filePath);
        
        // Store new references
        this.referenceMap.fileReferences.set(filePath, newReferences);

        // Update dependency map - track which files this file references
        const referencedFiles = new Set<string>();
        newReferences.forEach(ref => {
            const normalizedRef = path.normalize(ref);
            referencedFiles.add(normalizedRef);
            
            // Update back-references
            if (!this.referenceMap.fileBackReferences.has(normalizedRef)) {
                this.referenceMap.fileBackReferences.set(normalizedRef, []);
            }
            
            const backRefs = this.referenceMap.fileBackReferences.get(normalizedRef)!;
            const refType = this.fileMetadataCache.get(filePath)?.isFluxKustomization ? 'flux' : 'k8s';
            if (!backRefs.some(ref => ref.path === filePath)) {
                backRefs.push({ path: filePath, type: refType });
            }
        });

        // Update dependency map
        this.fileDependencyMap.set(filePath, referencedFiles);
    }

    /**
     * Update references for a file and any files that depend on it (cascade update)
     */
    public async updateFileReferencesIncremental(filePath: string): Promise<void> {
        const normalizedPath = path.normalize(filePath);
        
        // Check if file still exists (might have been deleted)
        if (!this.cachedFileExists(normalizedPath)) {
            // File was deleted - remove it from cache and update back-refs
            this.removeFileReferences(normalizedPath);
            return;
        }

        // Check if file has changed
        if (!this.hasFileChanged(normalizedPath)) {
            return;
        }
        
        // Invalidate cache for this file since it changed
        this.invalidateFileCache(normalizedPath);
        
        // Update this file's references
        this.updateFileReferences(normalizedPath);

        // Find files that reference this file and update them too (cascade)
        const backRefs = this.referenceMap.fileBackReferences.get(normalizedPath) || [];
        const filesToUpdate = new Set<string>();
        
        backRefs.forEach(backRef => {
            filesToUpdate.add(backRef.path);
        });

        // Update dependent files
        for (const dependentFile of filesToUpdate) {
            if (this.cachedFileExists(dependentFile)) {
                this.updateFileReferences(dependentFile);
            }
        }
    }

    /**
     * Remove a file from the reference map (when file is deleted)
     */
    private removeFileReferences(filePath: string): void {
        const normalizedPath = path.normalize(filePath);
        
        // Remove from file references
        const oldReferences = this.referenceMap.fileReferences.get(normalizedPath) || [];
        this.referenceMap.fileReferences.delete(normalizedPath);

        // Remove back-references: this file was referencing other files, so remove those back-refs
        oldReferences.forEach(oldRef => {
            const normalizedOldRef = path.normalize(oldRef);
            const backRefs = this.referenceMap.fileBackReferences.get(normalizedOldRef);
            if (backRefs) {
                const index = backRefs.findIndex(ref => ref.path === normalizedPath);
                if (index !== -1) {
                    backRefs.splice(index, 1);
                    if (backRefs.length === 0) {
                        this.referenceMap.fileBackReferences.delete(normalizedOldRef);
                    }
                }
            }
        });

        // Remove back-references pointing TO this file (files that reference the deleted file)
        const backRefsToThisFile = this.referenceMap.fileBackReferences.get(normalizedPath);
        if (backRefsToThisFile) {
            // Files that reference the deleted file need to be updated
            backRefsToThisFile.forEach(backRef => {
                // Remove the reference from those files (they'll be updated on next change)
                const refs = this.referenceMap.fileReferences.get(backRef.path);
                if (refs) {
                    const index = refs.indexOf(normalizedPath);
                    if (index !== -1) {
                        refs.splice(index, 1);
                    }
                }
            });
            this.referenceMap.fileBackReferences.delete(normalizedPath);
        }

        // Remove from caches
        this.fileMetadataCache.delete(normalizedPath);
        this.fileDependencyMap.delete(normalizedPath);
        this.invalidateFileCache(normalizedPath);
    }

    /**
     * Enhanced build reference map with Flux support (full rebuild)
     */
    public async buildReferenceMap(): Promise<KustomizeReferenceMap> {
        console.log('Building full reference map...');
        this.referenceMap = {
            fileReferences: new Map<string, string[]>(),
            fileBackReferences: new Map<string, Array<{path: string, type: 'flux' | 'k8s'}>>()
        };
        this.fileMetadataCache.clear();
        this.fileDependencyMap.clear();

        const kustomizationFiles = await this.findKustomizationFiles();

        for (const filePath of kustomizationFiles) {
            this.updateFileReferences(filePath);
        }

        console.log(`Reference map built: ${kustomizationFiles.length} files processed`);
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
     * Check if a path is a directory (cached)
     */
    public isDirectory(filePath: string): boolean {
        return this.cachedIsDirectory(filePath);
    }

    /**
     * Check if a file exists (cached)
     */
    public fileExists(filePath: string): boolean {
        const normalizedPath = path.normalize(filePath);
        if (!this.cachedFileExists(normalizedPath)) {
            return false;
        }
        const stat = this.getCachedStat(normalizedPath);
        return stat?.isFile ?? false;
    }
    
    /**
     * Clear all caches (useful for testing or when workspace changes significantly)
     */
    public clearCaches(): void {
        this.fileExistsCache.clear();
        this.fileStatCache.clear();
        this.fileMetadataCache.clear();
        this.gitRootCache.clear();
    }
}