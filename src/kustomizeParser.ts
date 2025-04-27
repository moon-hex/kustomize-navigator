import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { glob } from 'glob';

// Interface for parsed kustomization file
export interface KustomizationFile {
    filePath: string;
    resources: string[];
    bases: string[];
    patches: string[];
    patchesStrategicMerge: string[];
    patchesJson6902: Array<{ path: string }>;
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

    constructor(private workspaceRoot: string) {}

    /**
     * Find all kustomization files in the workspace
     */
    public async findKustomizationFiles(): Promise<string[]> {
        try {
            const files = await glob('**/kustomization.{yaml,yml}', { 
                cwd: this.workspaceRoot,
                ignore: ['**/node_modules/**']  
            });
            
            // Make paths absolute
            const absolutePaths = files.map(file => path.join(this.workspaceRoot, file));
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
        } catch (error) {
            console.log(`Error parsing file ${filePath}:`, error);
            return null;
        }
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
            const addReferences = (paths: string[]) => {
                for (const refPath of paths) {
                    try {
                        const resolvedPath = this.resolveReference(filePath, refPath);
                        references.push(resolvedPath);
                        
                        // Update back-references
                        if (!this.referenceMap.fileBackReferences.has(resolvedPath)) {
                            this.referenceMap.fileBackReferences.set(resolvedPath, []);
                        }
                        this.referenceMap.fileBackReferences.get(resolvedPath)!.push(filePath);
                    } catch (error) {
                        console.warn(`Failed to resolve reference ${refPath} from ${filePath}:`, error);
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
}