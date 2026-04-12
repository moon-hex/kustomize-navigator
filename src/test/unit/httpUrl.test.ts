import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { pathToFileURL } from 'node:url';
import { KustomizeParser } from '../../kustomizeParser';
import { YamlUtils } from '../../yamlUtils';

suite('Remote URI handling', () => {
    const fixturesPath = path.join(__dirname, '../fixtures');
    const remoteFixturePath = path.join(fixturesPath, 'valid/kustomization-with-remote.yaml');

    // ── YamlUtils.isRemoteResourceUri ──────────────────────────────────────────

    test('isRemoteResourceUri is true for http(s) and common remote schemes', () => {
        assert.strictEqual(YamlUtils.isRemoteResourceUri('https://example.com/manifest.yaml'), true);
        assert.strictEqual(YamlUtils.isRemoteResourceUri('http://example.com/manifest.yaml'), true);
        assert.strictEqual(YamlUtils.isRemoteResourceUri('oci://ghcr.io/org/repo'), true);
        assert.strictEqual(YamlUtils.isRemoteResourceUri('ssh://git@host/repo.git'), true);
    });

    test('isRemoteResourceUri is true for git::https:// Terraform-style sources', () => {
        assert.strictEqual(YamlUtils.isRemoteResourceUri('git::https://github.com/org/repo'), true);
        assert.strictEqual(YamlUtils.isRemoteResourceUri('git::http://example.com/x'), true);
    });

    test('isRemoteResourceUri is false for local paths and file://', () => {
        assert.strictEqual(YamlUtils.isRemoteResourceUri('./base'), false);
        assert.strictEqual(YamlUtils.isRemoteResourceUri('../base'), false);
        assert.strictEqual(YamlUtils.isRemoteResourceUri('deployment.yaml'), false);
        assert.strictEqual(YamlUtils.isRemoteResourceUri('file:///tmp/x.yaml'), false);
        assert.strictEqual(YamlUtils.isRemoteResourceUri('  file:///C:/a/b  '), false);
    });

    test('isRemoteResourceUri is false for schemes without // (e.g. oci alone)', () => {
        assert.strictEqual(YamlUtils.isRemoteResourceUri('oci:local'), false);
    });

    // ── KustomizeParser ───────────────────────────────────────────────────────

    test('parser does not add remote URIs to local reference map', async () => {
        const parser = new KustomizeParser(fixturesPath, false);
        await parser.buildReferenceMap();

        const refs = parser.getReferencesForFile(remoteFixturePath);

        const remoteRefs = refs.filter((r) => YamlUtils.isRemoteResourceUri(r));
        assert.strictEqual(
            remoteRefs.length,
            0,
            `Reference map must not contain remote URIs, found: ${remoteRefs.join(', ')}`
        );
    });

    test('parser does not produce mangled paths embedding URI schemes', async () => {
        const parser = new KustomizeParser(fixturesPath, false);
        await parser.buildReferenceMap();

        const refs = parser.getReferencesForFile(remoteFixturePath);

        const broken = refs.filter((r) => /:\/\//.test(r));
        assert.strictEqual(
            broken.length,
            0,
            `Reference map must not contain mangled URI-like paths, found: ${broken.join(', ')}`
        );
    });

    test('parser still resolves local resources alongside remote ones', () => {
        const parser = new KustomizeParser(fixturesPath, false);
        const kustomizations = parser.parseKustomizationFile(remoteFixturePath);

        assert.ok(kustomizations.length > 0, 'Should parse the fixture file');

        const resources = kustomizations[0].resources ?? [];

        assert.ok(
            resources.includes('deployment.yaml'),
            `deployment.yaml should appear in resources, got: ${JSON.stringify(resources)}`
        );
        assert.ok(
            resources.includes('service.yaml'),
            `service.yaml should appear in resources, got: ${JSON.stringify(resources)}`
        );
    });

    test('parser skips https entries in generators (reference map)', async () => {
        const parser = new KustomizeParser(fixturesPath, false);
        await parser.buildReferenceMap();

        const refs = parser.getReferencesForFile(remoteFixturePath);
        const genRemote = refs.filter((r) => r.includes('generator.yaml'));
        assert.strictEqual(
            genRemote.length,
            0,
            `Reference map must not list remote generator URL as a local path, found: ${genRemote.join(', ')}`
        );
    });

    test('parser skips object patches whose path is a remote URI', async () => {
        const parser = new KustomizeParser(fixturesPath, false);
        await parser.buildReferenceMap();

        const refs = parser.getReferencesForFile(remoteFixturePath);
        const exampleRemote = refs.filter((r) => r.includes('example.com'));
        assert.strictEqual(
            exampleRemote.length,
            0,
            `Reference map must not resolve remote patch path to a local path, found: ${exampleRemote.join(', ')}`
        );
    });

    test('parser skips oci:// resources in reference map', async () => {
        const parser = new KustomizeParser(fixturesPath, false);
        await parser.buildReferenceMap();

        const refs = parser.getReferencesForFile(remoteFixturePath);
        const oci = refs.filter((r) => r.includes('ghcr.io'));
        assert.strictEqual(
            oci.length,
            0,
            `Reference map must not contain oci path segments, found: ${oci.join(', ')}`
        );
    });

    test('parser resolves file:// resource to a local path in reference map', async () => {
        const deploymentYaml = path.join(fixturesPath, 'valid/deployment.yaml');
        if (!fs.existsSync(deploymentYaml)) {
            return;
        }
        const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kn-uri-'));
        try {
            const fileHref = pathToFileURL(deploymentYaml).href;
            const kuPath = path.join(tmpRoot, 'kustomization.yaml');
            fs.writeFileSync(
                kuPath,
                `apiVersion: kustomize.config.k8s.io/v1beta1\nkind: Kustomization\nresources:\n  - ${fileHref}\n`,
                'utf8'
            );
            const parser = new KustomizeParser(tmpRoot, false);
            await parser.buildReferenceMap();
            const refs = parser.getReferencesForFile(kuPath);
            assert.ok(
                refs.some((r) => path.normalize(r) === path.normalize(deploymentYaml)),
                `Expected file URI resolved to ${deploymentYaml}, got: ${refs.join(', ')}`
            );
        } finally {
            fs.rmSync(tmpRoot, { recursive: true, force: true });
        }
    });
});
