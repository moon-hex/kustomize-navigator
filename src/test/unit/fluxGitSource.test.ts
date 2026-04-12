import * as assert from 'assert';
import { gitRemotesMatch, normalizeGitRemoteUrl } from '../../fluxGitSource';

suite('fluxGitSource', () => {
    test('normalizeGitRemoteUrl maps ssh and https to same key', () => {
        const https = 'https://github.com/acme/infra.git';
        const ssh = 'git@github.com:acme/infra.git';
        assert.strictEqual(normalizeGitRemoteUrl(https), normalizeGitRemoteUrl(ssh));
    });

    test('gitRemotesMatch accepts equivalent remotes', () => {
        assert.strictEqual(
            gitRemotesMatch('https://gitlab.com/group/proj', 'git@gitlab.com:group/proj.git'),
            true
        );
    });

    test('gitRemotesMatch rejects different repos', () => {
        assert.strictEqual(
            gitRemotesMatch('https://github.com/a/x', 'https://github.com/b/x'),
            false
        );
    });
});
