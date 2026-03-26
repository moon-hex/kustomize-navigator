import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { glob } from 'glob';
import { YamlUtils } from './yamlUtils';

function primaryKey(kind: string, namespace: string, name: string): string {
    return `${kind}|${namespace}|${name}`;
}

function looseKey(kind: string, name: string): string {
    return `${kind}|${name}`;
}

/**
 * Indexes Kubernetes/Flux YAML documents by kind + namespace + name for cross-resource navigation.
 */
export class FluxResourceIndex {
    private byKindNsName = new Map<string, vscode.Uri>();
    private byKindName = new Map<string, vscode.Uri[]>();
    private fileToPrimaryKeys = new Map<string, Set<string>>();

    constructor(private readonly workspaceRoot: string) {}

    public async rebuildFull(): Promise<void> {
        this.byKindNsName.clear();
        this.byKindName.clear();
        this.fileToPrimaryKeys.clear();

        const files = await glob('**/*.{yaml,yml}', {
            cwd: this.workspaceRoot,
            ignore: ['**/node_modules/**'],
            nodir: true,
        });

        for (const rel of files) {
            const abs = path.join(this.workspaceRoot, rel);
            this.indexFile(abs);
        }
    }

    public updateFile(fsPath: string): void {
        const normalized = path.normalize(fsPath);
        this.removeFile(normalized);
        if (fs.existsSync(normalized)) {
            this.indexFile(normalized);
        }
    }

    public removeFile(fsPath: string): void {
        const normalized = path.normalize(fsPath);
        const keys = this.fileToPrimaryKeys.get(normalized);
        if (!keys) {
            return;
        }
        for (const pk of keys) {
            const uri = this.byKindNsName.get(pk);
            if (uri && path.normalize(uri.fsPath) === normalized) {
                this.byKindNsName.delete(pk);
            }
        }
        this.fileToPrimaryKeys.delete(normalized);
        this.rebuildLooseMap();
    }

    private appendLooseForPk(pk: string, uri: vscode.Uri): void {
        const first = pk.indexOf('|');
        const last = pk.lastIndexOf('|');
        if (first === -1 || last <= first) {
            return;
        }
        const kind = pk.slice(0, first);
        const name = pk.slice(last + 1);
        const lk = looseKey(kind, name);
        const arr = this.byKindName.get(lk) ?? [];
        if (!arr.some(u => u.fsPath === uri.fsPath)) {
            arr.push(uri);
        }
        this.byKindName.set(lk, arr);
    }

    private rebuildLooseMap(): void {
        this.byKindName.clear();
        for (const [pk, uri] of this.byKindNsName.entries()) {
            this.appendLooseForPk(pk, uri);
        }
    }

    public lookup(refKind: string, refName: string, refNamespace: string | undefined, defaultNamespace: string): vscode.Uri | undefined {
        const kind = refKind.trim();
        const name = refName.trim();
        const ns = (refNamespace ?? defaultNamespace ?? '').trim();

        const pk = primaryKey(kind, ns, name);
        const direct = this.byKindNsName.get(pk);
        if (direct) {
            return direct;
        }

        const loose = looseKey(kind, name);
        const candidates = this.byKindName.get(loose);
        if (candidates?.length === 1) {
            return candidates[0];
        }
        return undefined;
    }

    private indexFile(absPath: string): void {
        let text: string;
        try {
            text = fs.readFileSync(absPath, 'utf8');
        } catch {
            return;
        }

        const docs = YamlUtils.parseMultipleYamlDocuments(text);
        const uri = vscode.Uri.file(absPath);
        const normalized = path.normalize(absPath);
        const keySet = new Set<string>();

        for (const doc of docs) {
            if (!doc || typeof doc !== 'object') {
                continue;
            }
            const kind = doc.kind;
            const meta = doc.metadata;
            if (typeof kind !== 'string' || !meta || typeof meta !== 'object') {
                continue;
            }
            const docName = meta.name;
            if (typeof docName !== 'string' || docName.length === 0) {
                continue;
            }
            const ns = typeof meta.namespace === 'string' ? meta.namespace : '';
            const pk = primaryKey(kind, ns, docName);

            keySet.add(pk);
            if (!this.byKindNsName.has(pk)) {
                this.byKindNsName.set(pk, uri);
                this.appendLooseForPk(pk, uri);
            }
        }

        if (keySet.size > 0) {
            this.fileToPrimaryKeys.set(normalized, keySet);
        }
    }
}
