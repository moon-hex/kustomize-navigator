// ParserFactory.ts - Fixed imports
import { BaseParser } from './BaseParser';
import { FluxKustomizationParser } from './FluxKustomizationParser';
import { StandardKustomizationParser } from './StandardKustomizationParser';
import { KustomizationFile } from '../models/KustomizationFile';
import { ParseResult } from '../models/ParsedDocument';

export class ParserFactory {
    private static parsers: BaseParser[] = [
        new FluxKustomizationParser(),
        new StandardKustomizationParser()
    ];

    /**
     * Get the appropriate parser for a file
     */
    public static getParser(filePath: string): BaseParser | null {
        for (const parser of this.parsers) {
            if (parser.canParse(filePath)) {
                return parser;
            }
        }
        return null;
    }

    /**
     * Get all available parsers
     */
    public static getAllParsers(): BaseParser[] {
        return [...this.parsers];
    }

    /**
     * Get parsers by type
     */
    public static getParsersByType(type: 'flux' | 'standard'): BaseParser[] {
        return this.parsers.filter(parser => parser.getParserType() === type);
    }

    /**
     * Check if a file can be parsed as a kustomization
     */
    public static canParseFile(filePath: string): boolean {
        return this.parsers.some(parser => parser.canParse(filePath));
    }

    /**
     * Parse a file using the appropriate parser
     */
    public static parseFile(filePath: string): KustomizationFile | null {
        const parser = this.getParser(filePath);
        return parser ? parser.parse(filePath) : null;
    }

    /**
     * Parse document structure using the appropriate parser
     */
    public static parseDocument(filePath: string): ParseResult | null {
        const parser = this.getParser(filePath);
        return parser ? parser.parseDocument(filePath) : null;
    }

    /**
     * Get resolved references using the appropriate parser
     */
    public static getResolvedReferences(filePath: string): string[] {
        const parser = this.getParser(filePath);
        return parser ? parser.getResolvedReferences(filePath) : [];
    }

    /**
     * Validate a kustomization file using the appropriate parser
     */
    public static validateFile(filePath: string): string[] {
        const parser = this.getParser(filePath);
        if (!parser) {
            return ['No suitable parser found for file'];
        }

        const errors: string[] = [];

        // Use specific validation if available
        if (parser instanceof FluxKustomizationParser) {
            errors.push(...parser.validateFluxKustomization(filePath));
        } else if (parser instanceof StandardKustomizationParser) {
            errors.push(...parser.validateStandardKustomization(filePath));
        }

        return errors;
    }

    /**
     * Get file type based on parser
     */
    public static getFileType(filePath: string): 'flux' | 'standard' | 'unknown' {
        const parser = this.getParser(filePath);
        return parser ? parser.getParserType() : 'unknown';
    }

    /**
     * Register a new parser
     */
    public static registerParser(parser: BaseParser): void {
        // Add parser at the beginning so custom parsers take precedence
        this.parsers.unshift(parser);
    }

    /**
     * Unregister a parser
     */
    public static unregisterParser(parserType: string): boolean {
        const index = this.parsers.findIndex(p => p.getParserType() === parserType);
        if (index > -1) {
            this.parsers.splice(index, 1);
            return true;
        }
        return false;
    }
}