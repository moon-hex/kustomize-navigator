/**
 * Find character offsets for Flux cross-resource link targets in YAML source text.
 */

export function stripYamlScalar(value: string): string {
    const t = value.trim();
    if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
        return t.slice(1, -1);
    }
    return t.replace(/\s+#.*$/, '').trim();
}

function lineIndentLen(line: string): number {
    const m = line.match(/^(\s*)/);
    return m ? m[1].length : 0;
}

function buildLineStartOffsets(text: string): { lines: string[]; offsets: number[] } {
    const lines = text.split(/\r?\n/);
    const offsets: number[] = [];
    let pos = 0;
    for (let i = 0; i < lines.length; i++) {
        offsets.push(pos);
        pos += lines[i].length;
        if (i < lines.length - 1) {
            const at = pos;
            if (text[at] === '\r' && text[at + 1] === '\n') {
                pos += 2;
            } else {
                pos += 1;
            }
        }
    }
    return { lines, offsets };
}

function positionAt(offsets: number[], lineIndex: number, column: number): number {
    return offsets[lineIndex] + column;
}

/**
 * Within a YAML block starting at line `blockLine` with indent `baseIndent`,
 * collect direct child `key: value` scalars until a line with indent <= baseIndent.
 */
function parseIndentedBlock(lines: string[], blockLine: number, baseIndent: number): Map<string, string> {
    const fields = new Map<string, string>();
    for (let j = blockLine + 1; j < lines.length; j++) {
        const line = lines[j];
        if (line.trim() === '' || line.trim().startsWith('#')) {
            continue;
        }
        const ind = lineIndentLen(line);
        if (ind <= baseIndent) {
            break;
        }
        const km = line.match(/^\s*([a-zA-Z0-9]+)\s*:\s*(.*)$/);
        if (km) {
            fields.set(km[1], stripYamlScalar(km[2]));
        }
    }
    return fields;
}

function findScalarKeyColumn(lines: string[], offsets: number[], lineIndex: number, key: string, value: string): number {
    const ln = lines[lineIndex];
    const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const m = ln.match(new RegExp(`^\\s*${escapedKey}:\\s*(.*)$`));
    if (!m || stripYamlScalar(m[1]) !== value) {
        return -1;
    }
    const prefix = ln.match(new RegExp(`^\\s*${escapedKey}:\\s*`));
    if (!prefix) {
        return -1;
    }
    const col = prefix[0].length;
    const rest = ln.slice(col);
    const si = rest.search(/\S/);
    return positionAt(offsets, lineIndex, col + (si === -1 ? 0 : si));
}

function findKeyInBlock(
    lines: string[],
    offsets: number[],
    blockStartLine: number,
    baseIndent: number,
    key: string,
    value: string
): number {
    for (let j = blockStartLine + 1; j < lines.length; j++) {
        const ln = lines[j];
        if (ln.trim() === '' || ln.trim().startsWith('#')) {
            continue;
        }
        const ind = lineIndentLen(ln);
        if (ind <= baseIndent) {
            break;
        }
        const idx = findScalarKeyColumn(lines, offsets, j, key, value);
        if (idx !== -1) {
            return idx;
        }
    }
    return -1;
}

/**
 * First `sourceRef:` block matching kind + name; returns start index of the name value in `text`.
 */
export function findSourceRefNameIndex(text: string, kind: string, name: string): number {
    const { lines, offsets } = buildLineStartOffsets(text);
    for (let i = 0; i < lines.length; i++) {
        if (!/^\s*sourceRef:\s*$/.test(lines[i])) {
            continue;
        }
        const baseIndent = lineIndentLen(lines[i]);
        const fields = parseIndentedBlock(lines, i, baseIndent);
        if (fields.get('kind') === kind && fields.get('name') === name) {
            return findKeyInBlock(lines, offsets, i, baseIndent, 'name', name);
        }
    }
    return -1;
}

/**
 * `chartRef:` for HelmRelease (kind + name).
 */
export function findChartRefNameIndex(text: string, kind: string, name: string): number {
    const { lines, offsets } = buildLineStartOffsets(text);
    for (let i = 0; i < lines.length; i++) {
        if (!/^\s*chartRef:\s*$/.test(lines[i])) {
            continue;
        }
        const baseIndent = lineIndentLen(lines[i]);
        const fields = parseIndentedBlock(lines, i, baseIndent);
        if (fields.get('kind') === kind && fields.get('name') === name) {
            return findKeyInBlock(lines, offsets, i, baseIndent, 'name', name);
        }
    }
    return -1;
}

/**
 * ArtifactGenerator `spec.sources` list item where kind + name match.
 */
export function findArtifactGeneratorSourceNameIndex(text: string, kind: string, name: string): number {
    const { lines, offsets } = buildLineStartOffsets(text);
    let inSpec = false;
    let specIndent = 0;
    let sourcesIndent = -1;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();
        if (trimmed.startsWith('#') || trimmed === '') {
            continue;
        }
        const ind = lineIndentLen(line);

        if (/^spec:\s*$/.test(trimmed)) {
            inSpec = true;
            specIndent = ind;
            sourcesIndent = -1;
            continue;
        }

        if (inSpec && sourcesIndent === -1 && /^\s*sources:\s*$/.test(line) && ind > specIndent) {
            sourcesIndent = ind;
            continue;
        }

        if (sourcesIndent >= 0 && ind > sourcesIndent && /^\s*-\s/.test(line)) {
            const itemDashLine = i;
            const dashIndent = ind;
            const fields = new Map<string, string>();
            for (let j = i + 1; j < lines.length; j++) {
                const lj = lines[j];
                if (lj.trim() === '' || lj.trim().startsWith('#')) {
                    continue;
                }
                const jind = lineIndentLen(lj);
                if (jind <= sourcesIndent) {
                    break;
                }
                if (jind === dashIndent && /^\s*-\s/.test(lj)) {
                    break;
                }
                const km = lj.match(/^\s*([a-zA-Z0-9]+)\s*:\s*(.*)$/);
                if (km && jind > dashIndent) {
                    fields.set(km[1], stripYamlScalar(km[2]));
                }
            }
            if (fields.get('kind') === kind && fields.get('name') === name) {
                return findKeyInBlock(lines, offsets, itemDashLine, sourcesIndent, 'name', name);
            }
        }

        if (inSpec && ind <= specIndent && !/^spec:\s*$/.test(trimmed)) {
            inSpec = false;
            sourcesIndent = -1;
        }
    }
    return -1;
}
