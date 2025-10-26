import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';
import { KustomizeParser, KustomizationFile } from '../../kustomizeParser';

suite('KustomizeParser Unit Tests', () => {
    let parser: KustomizeParser;
    const testWorkspacePath = path.join(__dirname, '../fixtures');
    const validKustomizationPath = path.join(testWorkspacePath, 'valid/kustomization.yaml');
    const invalidKustomizationPath = path.join(testWorkspacePath, 'invalid/bad-kustomization.yaml');

    suiteSetup(() => {
        parser = new KustomizeParser(testWorkspacePath);
    });

    test('should find kustomization files in workspace', async () => {
        const files = await parser.findKustomizationFiles();
        assert.strictEqual(Array.isArray(files), true, 'Should return an array');
        assert.ok(files.length > 0, 'Should find at least one kustomization file');
        assert.ok(files.some(f => f.includes('valid/kustomization.yaml')), 
            'Should find the valid kustomization file');
    });

    test('should parse valid kustomization file', async () => {
        const results = parser.parseKustomizationFile(validKustomizationPath);
        
        assert.strictEqual(Array.isArray(results), true, 'Should return an array of KustomizationFile');
        assert.ok(results.length > 0, 'Should parse at least one kustomization document');
        
        const result = results[0];
        assert.ok(result.resources.includes('deployment.yaml'), 
            'Should include deployment.yaml in resources');
        assert.ok(result.resources.includes('service.yaml'), 
            'Should include service.yaml in resources');
    });

    test('should handle invalid kustomization file', async () => {
        const results = parser.parseKustomizationFile(invalidKustomizationPath);
        assert.strictEqual(Array.isArray(results), true, 'Should return an array');
        assert.strictEqual(results.length, 0, 'Should return empty array for invalid file');
    });

    test('should build reference map', async () => {
        const referenceMap = await parser.buildReferenceMap();
        
        assert.ok(referenceMap.fileReferences instanceof Map, 'Should have fileReferences map');
        assert.ok(referenceMap.fileBackReferences instanceof Map, 'Should have fileBackReferences map');
        
        // Check if our test files are in the reference map
        const references = parser.getReferencesForFile(validKustomizationPath);
        assert.ok(Array.isArray(references), 'Should return an array of references');
        assert.ok(references.some(r => r.includes('deployment.yaml')), 
            'Should find deployment.yaml in references');
    });

    test('should get back references', async () => {
        // First build the reference map
        await parser.buildReferenceMap();
        
        // Get back references for deployment.yaml
        const backRefs = parser.getBackReferencesForFile(
            path.join(path.dirname(validKustomizationPath), 'deployment.yaml')
        );
        
        assert.ok(Array.isArray(backRefs), 'Should return an array of back references');
        assert.ok(backRefs.some(ref => ref.path === validKustomizationPath), 
            'Should find kustomization.yaml in back references');
    });
}); 