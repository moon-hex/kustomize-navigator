import * as assert from 'assert';
import * as path from 'path';
import { KustomizeParser } from '../../kustomizeParser';
import { YamlUtils } from '../../yamlUtils';

suite('HTTP URL handling', () => {
    const fixturesPath = path.join(__dirname, '../fixtures');
    const remoteFixturePath = path.join(fixturesPath, 'valid/kustomization-with-remote.yaml');

    // ── YamlUtils.isHttpUrl ───────────────────────────────────────────────────

    test('isHttpUrl returns true for http:// and https://', () => {
        assert.strictEqual(YamlUtils.isHttpUrl('https://example.com/manifest.yaml'), true);
        assert.strictEqual(YamlUtils.isHttpUrl('http://example.com/manifest.yaml'), true);
    });

    test('isHttpUrl returns false for local paths and non-http schemes', () => {
        assert.strictEqual(YamlUtils.isHttpUrl('./base'), false);
        assert.strictEqual(YamlUtils.isHttpUrl('../base'), false);
        assert.strictEqual(YamlUtils.isHttpUrl('deployment.yaml'), false);
        assert.strictEqual(YamlUtils.isHttpUrl('oci://ghcr.io/org/repo'), false);
        assert.strictEqual(YamlUtils.isHttpUrl('git::https://github.com/org/repo'), false);
    });

    // ── KustomizeParser ───────────────────────────────────────────────────────

    test('parser does not add HTTP URLs to local reference map', async () => {
        const parser = new KustomizeParser(fixturesPath, false);
        await parser.buildReferenceMap();

        const refs = parser.getReferencesForFile(remoteFixturePath);

        const httpRefs = refs.filter(r => YamlUtils.isHttpUrl(r));
        assert.strictEqual(
            httpRefs.length,
            0,
            `Reference map must not contain HTTP URLs, found: ${httpRefs.join(', ')}`
        );
    });

    test('parser does not produce mangled file:///https:/ paths', async () => {
        const parser = new KustomizeParser(fixturesPath, false);
        await parser.buildReferenceMap();

        const refs = parser.getReferencesForFile(remoteFixturePath);

        const broken = refs.filter(r => r.includes('https:') || r.includes('http:'));
        assert.strictEqual(
            broken.length,
            0,
            `Reference map must not contain mangled HTTP paths, found: ${broken.join(', ')}`
        );
    });

    test('parser still resolves local resources alongside remote ones', async () => {
        const parser = new KustomizeParser(fixturesPath, false);
        await parser.buildReferenceMap();

        const refs = parser.getReferencesForFile(remoteFixturePath);

        assert.ok(
            refs.some(r => r.endsWith('deployment.yaml')),
            'deployment.yaml should still appear in references'
        );
        assert.ok(
            refs.some(r => r.endsWith('service.yaml')),
            'service.yaml should still appear in references'
        );
    });
});