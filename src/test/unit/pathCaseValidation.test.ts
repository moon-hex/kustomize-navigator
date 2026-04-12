import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    pathsMatchDiskSpelling,
    pathSegmentsMatchDiskSpelling,
    platformNeedsPathCaseValidation,
    validateResolvedPathCase,
} from '../../pathCaseValidation';

suite('pathCaseValidation', () => {
    test('platformNeedsPathCaseValidation is boolean per OS', () => {
        const v = platformNeedsPathCaseValidation();
        assert.strictEqual(typeof v, 'boolean');
        if (process.platform === 'linux') {
            assert.strictEqual(v, false);
        }
    });

    test('pathsMatchDiskSpelling: posix identical paths', () => {
        assert.strictEqual(pathsMatchDiskSpelling('/a/b/c', '/a/b/c'), true);
        assert.strictEqual(pathsMatchDiskSpelling('/a/b/c', '/a/b/C'), false);
    });

    test('validateResolvedPathCase is a no-op on Linux', () => {
        if (process.platform !== 'linux') {
            return;
        }
        assert.strictEqual(validateResolvedPathCase('/tmp', '/tmp/nope'), true);
    });

    test('pathSegmentsMatchDiskSpelling accepts exact spelling', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kn-case-'));
        try {
            const sub = path.join(root, 'ExactDir');
            fs.mkdirSync(sub);
            const f = path.join(sub, 'file.yaml');
            fs.writeFileSync(f, 'x');
            assert.strictEqual(pathSegmentsMatchDiskSpelling(root, f), true);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    test('pathSegmentsMatchDiskSpelling detects wrong directory casing on Windows', function () {
        if (process.platform !== 'win32') {
            this.skip();
        }
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kn-case-'));
        try {
            const actual = path.join(root, 'RealName');
            fs.mkdirSync(actual);
            const f = path.join(actual, 'x.yaml');
            fs.writeFileSync(f, 'x');
            const wrongCaseTarget = path.join(root, 'realname', 'x.yaml');
            assert.strictEqual(pathSegmentsMatchDiskSpelling(root, wrongCaseTarget), false);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });
});
