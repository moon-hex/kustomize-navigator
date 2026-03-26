import * as assert from 'assert';
import {
    findSourceRefNameIndex,
    findChartRefNameIndex,
    findArtifactGeneratorSourceNameIndex,
} from '../../fluxYamlRefs';

suite('fluxYamlRefs', () => {
    test('findSourceRefNameIndex locates name value', () => {
        const yaml = `apiVersion: kustomize.toolkit.fluxcd.io/v1
kind: Kustomization
metadata:
  name: app
  namespace: ns
spec:
  sourceRef:
    kind: GitRepository
    name: my-repo
  path: ./
`;
        const idx = findSourceRefNameIndex(yaml, 'GitRepository', 'my-repo');
        assert.ok(idx >= 0);
        assert.strictEqual(yaml.slice(idx, idx + 'my-repo'.length), 'my-repo');
    });

    test('findChartRefNameIndex locates chartRef name', () => {
        const yaml = `apiVersion: helm.toolkit.fluxcd.io/v2
kind: HelmRelease
metadata:
  name: podinfo
  namespace: apps
spec:
  chartRef:
    kind: OCIRepository
    name: podinfo-chart
`;
        const idx = findChartRefNameIndex(yaml, 'OCIRepository', 'podinfo-chart');
        assert.ok(idx >= 0);
        assert.strictEqual(yaml.slice(idx, idx + 'podinfo-chart'.length), 'podinfo-chart');
    });

    test('findArtifactGeneratorSourceNameIndex locates source name', () => {
        const yaml = `apiVersion: source.extensions.fluxcd.io/v1beta1
kind: ArtifactGenerator
metadata:
  name: gen
  namespace: apps
spec:
  sources:
    - alias: backend
      kind: GitRepository
      name: my-backend
  artifacts: []
`;
        const idx = findArtifactGeneratorSourceNameIndex(yaml, 'GitRepository', 'my-backend');
        assert.ok(idx >= 0);
        assert.strictEqual(yaml.slice(idx, idx + 'my-backend'.length), 'my-backend');
    });
});
