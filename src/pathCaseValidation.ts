import * as fs from 'fs';
import * as path from 'path';

/**
 * Windows and default macOS volumes are case-insensitive; path existence checks can pass
 * with wrong spelling that breaks on Linux (e.g. Flux). Linux is already case-sensitive.
 */
export function platformNeedsPathCaseValidation(): boolean {
    return process.platform === 'win32' || process.platform === 'darwin';
}

const winLongPathPrefix = /^\\\\\?\\/;

function stripWindowsLongPathPrefix(p: string): string {
    return p.replace(winLongPathPrefix, '');
}

/**
 * Compare two absolute normalized paths for identical spelling (case-sensitive),
 * except the Windows drive letter is compared case-insensitively.
 */
export function pathsMatchDiskSpelling(a: string, b: string): boolean {
    const na = path.normalize(stripWindowsLongPathPrefix(a));
    const nb = path.normalize(stripWindowsLongPathPrefix(b));
    if (process.platform === 'win32') {
        const sa = na.split(/[/\\]/).filter((s) => s.length > 0);
        const sb = nb.split(/[/\\]/).filter((s) => s.length > 0);
        if (sa.length !== sb.length) {
            return false;
        }
        for (let i = 0; i < sa.length; i++) {
            const pa = sa[i];
            const pb = sb[i];
            if (i === 0 && /^[a-zA-Z]:$/.test(pa) && /^[a-zA-Z]:$/.test(pb)) {
                if (pa.toLowerCase() !== pb.toLowerCase()) {
                    return false;
                }
            } else if (pa !== pb) {
                return false;
            }
        }
        return true;
    }
    return na === nb;
}

/**
 * Walk from anchorRoot toward targetAbsolute using readdir; any segment that matches only
 * case-insensitively (not byte-identical) is treated as a Linux/Flux mismatch.
 */
export function pathSegmentsMatchDiskSpelling(anchorRoot: string, targetAbsolute: string): boolean {
    const anchor = path.resolve(anchorRoot);
    const target = path.resolve(targetAbsolute);
    const rel = path.relative(anchor, target);
    if (!rel || rel === '.') {
        return true;
    }
    const parts = rel.split(path.sep).filter((p) => p.length > 0);
    if (parts.some((p) => p === '..')) {
        return true;
    }

    let current = anchor;
    for (const part of parts) {
        let entries: fs.Dirent[];
        try {
            entries = fs.readdirSync(current, { withFileTypes: true });
        } catch {
            return true;
        }
        const exact = entries.find((e) => e.name === part);
        if (exact) {
            current = path.join(current, exact.name);
            continue;
        }
        const wrongCase = entries.find((e) => e.name.toLowerCase() === part.toLowerCase());
        if (wrongCase) {
            return false;
        }
        return true;
    }
    return true;
}

/**
 * Method 1: native realpath spelling vs resolved path.
 * Method 2: segment walk from anchor (Git root or kustomization dir).
 * Both must pass when they are conclusive (segment walk skipped outside anchor).
 */
export function validateResolvedPathCase(anchorRoot: string, resolvedAbsolutePath: string): boolean {
    if (!platformNeedsPathCaseValidation()) {
        return true;
    }

    let realpathOk = true;
    try {
        const canon = fs.realpathSync.native(resolvedAbsolutePath);
        realpathOk = pathsMatchDiskSpelling(resolvedAbsolutePath, canon);
    } catch {
        realpathOk = true;
    }

    const segmentsOk = pathSegmentsMatchDiskSpelling(anchorRoot, resolvedAbsolutePath);
    return realpathOk && segmentsOk;
}
