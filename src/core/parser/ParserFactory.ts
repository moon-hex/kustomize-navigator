// ParserFactory.ts - Updated to use KustomizeParser
import { KustomizeParser } from '../../kustomizeParser';
import { KustomizationFile } from '../../kustomizeParser';
import * as vscode from 'vscode';

export class ParserFactory {
    private static parser: KustomizeParser | null = null;

    /**
     * Initialize the parser with workspace root
     */
    public static initialize(workspaceRoot: string): void {
        this.parser = new KustomizeParser(workspaceRoot);
    }

    /**
     * Get the parser instance
     */
    private static getParser(): KustomizeParser {
        if (!this.parser) {
            const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
            if (!workspaceRoot) {
                throw new Error('No workspace root found');
            }
            this.initialize(workspaceRoot);
        }
        return this.parser!;
    }

    /**
     * Check if a file can be parsed as a kustomization
     */
    public static canParseFile(filePath: string): boolean {
        return this.getParser().isKustomizationFile(filePath);
    }

    /**
     * Parse a file using the parser
     */
    public static parseFile(filePath: string): KustomizationFile[] {
        return this.getParser().parseKustomizationFile(filePath);
    }

    /**
     * Get resolved references for a file
     */
    public static getResolvedReferences(filePath: string): string[] {
        return this.getParser().getReferencesForFile(filePath);
    }

    /**
     * Get file type based on content
     */
    public static getFileType(filePath: string): 'flux' | 'standard' | 'unknown' {
        const parser = this.getParser();
        // This is a simplification - you might want to enhance this based on your needs
        return parser.isKustomizationFile(filePath) ? 'standard' : 'unknown';
    }

    /**
     * Build the reference map
     */
    public static async buildReferenceMap(): Promise<void> {
        await this.getParser().buildReferenceMap();
    }
}