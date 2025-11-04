// fluxDiagnostics.ts
import * as vscode from 'vscode';
import * as yaml from 'js-yaml';

export class FluxDiagnosticProvider {
    private diagnosticCollection: vscode.DiagnosticCollection;
    private diagnosticConfig: { [key: string]: boolean } = {};
    private disposables: vscode.Disposable[] = [];

    constructor() {
        this.diagnosticCollection = vscode.languages.createDiagnosticCollection('flux-kustomize');

        // Initialize config
        this.updateConfiguration();

        // Listen for configuration changes
        this.disposables.push(
            vscode.workspace.onDidChangeConfiguration(e => {
                if (e.affectsConfiguration('kustomizeNavigator.diagnostics')) {
                    this.updateConfiguration();
                    // Re-analyze all open documents
                    vscode.workspace.textDocuments.forEach(this.analyzeDiagnostics, this);
                }
            })
        );

        // Register event handlers
        this.disposables.push(
            vscode.workspace.onDidOpenTextDocument(this.analyzeDiagnostics, this),
            vscode.workspace.onDidChangeTextDocument(e => this.analyzeDiagnostics(e.document), this),
            vscode.workspace.onDidCloseTextDocument(doc => {
                this.diagnosticCollection.delete(doc.uri);
            }, this)
        );

        // Analyze open documents
        vscode.workspace.textDocuments.forEach(this.analyzeDiagnostics, this);
    }

    private updateConfiguration() {
        const config = vscode.workspace.getConfiguration('kustomizeNavigator.diagnostics');

        // Get master toggle
        const masterEnabled = config.get<boolean>('enabled', true);

        // If master toggle is off, disable all checks
        if (!masterEnabled) {
            Object.keys(this.diagnosticConfig).forEach(key => {
                this.diagnosticConfig[key] = false;
            });
            return;
        }

        // Otherwise, get individual check settings
        const checksConfig = vscode.workspace.getConfiguration('kustomizeNavigator.diagnostics.checks');

        // Update all check configurations
        this.diagnosticConfig = {
            resourceNaming: checksConfig.get<boolean>('resourceNaming', true),
            namespaceRequired: checksConfig.get<boolean>('namespaceRequired', true),
            recursiveDependencies: checksConfig.get<boolean>('recursiveDependencies', true),
            imageTags: checksConfig.get<boolean>('imageTags', true),
            securityIssues: checksConfig.get<boolean>('securityIssues', true),
            fluxVersions: checksConfig.get<boolean>('fluxVersions', true),
            gitopsComponents: checksConfig.get<boolean>('gitopsComponents', true),
            performanceIssues: checksConfig.get<boolean>('performanceIssues', true),
            variableSubstitution: checksConfig.get<boolean>('variableSubstitution', true),
            indentation: checksConfig.get<boolean>('indentation', true),
            deprecatedPatches: checksConfig.get<boolean>('deprecatedPatches', true)
        };
    }
    private analyzeDiagnostics(document: vscode.TextDocument) {
        // Only process YAML files
        if (!document.fileName.endsWith('.yaml') && !document.fileName.endsWith('.yml')) {
            return;
        }
        // Clear existing diagnostics
        this.diagnosticCollection.delete(document.uri);

        // If all checks are disabled, exit early
        if (Object.values(this.diagnosticConfig).every(enabled => !enabled)) {
            return;
        }
        const diagnostics: vscode.Diagnostic[] = [];
        try {
            const content = document.getText();
            let parsed = null;

            try {
                parsed = yaml.load(content) as any;
            } catch (yamlError) {
                // YAML parsing error - handled by VS Code's built-in YAML support
            }

            // Run checks based on configuration
            if (this.diagnosticConfig.variableSubstitution) {
                this.checkVariableSubstitution(document, content, diagnostics);
                this.checkExtendedVariableIssues(document, content, diagnostics);
            }

            if (parsed) {
                if (this.diagnosticConfig.resourceNaming) {
                    this.checkResourceNaming(document, parsed, diagnostics);
                }
                if (this.diagnosticConfig.namespaceRequired) {
                    this.checkNamespace(document, parsed, diagnostics);
                }
                if (this.diagnosticConfig.recursiveDependencies) {
                    this.checkRecursiveDependencies(document, parsed, diagnostics);
                }
                if (this.diagnosticConfig.imageTags) {
                    this.checkImageTags(document, parsed, diagnostics);
                }
                if (this.diagnosticConfig.securityIssues) {
                    this.checkSecurityIssues(document, parsed, diagnostics);
                }
                if (this.diagnosticConfig.fluxVersions) {
                    this.checkFluxVersions(document, parsed, diagnostics);
                }
                if (this.diagnosticConfig.gitopsComponents) {
                    this.checkGitOpsComponents(document, parsed, diagnostics);
                }
                if (this.diagnosticConfig.performanceIssues) {
                    this.checkPerformanceIssues(document, parsed, diagnostics);
                }
                if (this.diagnosticConfig.deprecatedPatches) {
                    this.checkDeprecatedPatches(document, parsed, diagnostics);
                }
            }
            if (this.diagnosticConfig.indentation) {
                this.checkIndentation(document, diagnostics);
            }
            // Update diagnostics collection if we have any
            if (diagnostics.length > 0) {
                this.diagnosticCollection.set(document.uri, diagnostics);
            }
        } catch (error) {
            console.error(`Error analyzing diagnostics for ${document.fileName}:`, error);
        }
    }

    private checkVariableSubstitution(
        document: vscode.TextDocument,
        content: string,
        diagnostics: vscode.Diagnostic[]
    ) {
        const variableRegex = /\${([^}]*)}/g;
        let match;

        while ((match = variableRegex.exec(content))) {
            const variableContent = match[1];
            const startPos = document.positionAt(match.index);
            const endPos = document.positionAt(match.index + match[0].length);
            const range = new vscode.Range(startPos, endPos);

            // Check for empty variables
            if (!variableContent.trim()) {
                const diagnostic = new vscode.Diagnostic(
                    range,
                    'Empty variable substitution',
                    vscode.DiagnosticSeverity.Error
                );
                diagnostic.source = 'Flux Kustomize';
                diagnostics.push(diagnostic);
                continue;
            }

            // Check for invalid default value syntax
            if (variableContent.includes(':=')) {
                const parts = variableContent.split(':=');
                if (parts.length > 2) {
                    const diagnostic = new vscode.Diagnostic(
                        range,
                        'Invalid default value syntax. Use ${var:=default}',
                        vscode.DiagnosticSeverity.Warning
                    );
                    diagnostic.source = 'Flux Kustomize';
                    diagnostics.push(diagnostic);
                }
            }
        }
    }

    private checkFluxKustomization(
        document: vscode.TextDocument,
        content: string,
        diagnostics: vscode.Diagnostic[]
    ) {
        try {
            const parsed = yaml.load(content) as any;

            // Check for required fields in Flux Kustomization
            if (parsed &&
                parsed.apiVersion === 'kustomize.toolkit.fluxcd.io/v1beta2' &&
                parsed.kind === 'Kustomization') {

                // Check for missing required fields
                const requiredFields = ['spec', 'metadata.name', 'metadata.namespace'];
                for (const field of requiredFields) {
                    const parts = field.split('.');
                    let current = parsed;
                    let missing = false;

                    for (const part of parts) {
                        if (!current || !current[part]) {
                            missing = true;
                            break;
                        }
                        current = current[part];
                    }

                    if (missing) {
                        // Find the position for the diagnostic (approximate)
                        let pos;
                        if (field.startsWith('spec')) {
                            pos = content.indexOf('spec:');
                        } else if (field.startsWith('metadata')) {
                            pos = content.indexOf('metadata:');
                        } else {
                            pos = 0;
                        }

                        if (pos === -1) pos = 0;

                        const startPos = document.positionAt(pos);
                        const range = new vscode.Range(startPos, startPos.translate(0, field.length));

                        const diagnostic = new vscode.Diagnostic(
                            range,
                            `Missing required field: ${field}`,
                            vscode.DiagnosticSeverity.Error
                        );
                        diagnostic.source = 'Flux Kustomize';
                        diagnostics.push(diagnostic);
                    }
                }

                // Check if path is specified in spec
                if (parsed.spec && !parsed.spec.path) {
                    const specPos = content.indexOf('spec:');
                    if (specPos !== -1) {
                        const startPos = document.positionAt(specPos);
                        const range = new vscode.Range(startPos, startPos.translate(0, 20));

                        const diagnostic = new vscode.Diagnostic(
                            range,
                            'Missing required field: spec.path',
                            vscode.DiagnosticSeverity.Error
                        );
                        diagnostic.source = 'Flux Kustomize';
                        diagnostics.push(diagnostic);
                    }
                }
            }
        } catch (error) {
            console.error(`Error checking Flux Kustomization in ${document.fileName}:`, error);
        }
    }
    // Check if resource names follow best practices
    private checkResourceNaming(document: vscode.TextDocument, parsed: any, diagnostics: vscode.Diagnostic[]) {
        if (!parsed || !parsed.metadata || !parsed.metadata.name) return;

        const name = parsed.metadata.name;
        const namePos = document.getText().indexOf(`name: ${name}`);

        if (namePos !== -1) {
            const startPos = document.positionAt(namePos + 6); // Position after "name: "
            const endPos = document.positionAt(namePos + 6 + name.length);
            const range = new vscode.Range(startPos, endPos);

            // Check for uppercase characters (Kubernetes names should be lowercase)
            if (/[A-Z]/.test(name)) {
                const diagnostic = new vscode.Diagnostic(
                    range,
                    'Resource names should be lowercase for better compatibility',
                    vscode.DiagnosticSeverity.Warning
                );
                diagnostic.source = 'Kubernetes Best Practices';
                diagnostics.push(diagnostic);
            }

            // Check for very long names that might cause issues
            if (name.length > 63) {
                const diagnostic = new vscode.Diagnostic(
                    range,
                    'Resource name exceeds 63 characters which is the limit for many Kubernetes objects',
                    vscode.DiagnosticSeverity.Warning
                );
                diagnostic.source = 'Kubernetes Best Practices';
                diagnostics.push(diagnostic);
            }

            // Check for non-DNS compliant characters
            if (!/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/.test(name)) {
                const diagnostic = new vscode.Diagnostic(
                    range,
                    'Resource name contains characters that are not DNS-compliant. Use only lowercase alphanumeric characters or "-"',
                    vscode.DiagnosticSeverity.Warning
                );
                diagnostic.source = 'Kubernetes Best Practices';
                diagnostics.push(diagnostic);
            }
        }
    }
    // Check if namespaced resources have a namespace specified
    private checkNamespace(document: vscode.TextDocument, parsed: any, diagnostics: vscode.Diagnostic[]) {
        if (!parsed || !parsed.kind) return;

        // List of resources that require a namespace (non-exhaustive)
        const namespacedResources = [
            'Deployment', 'Service', 'ConfigMap', 'Secret', 'Pod', 'StatefulSet',
            'DaemonSet', 'Job', 'CronJob', 'Ingress', 'PersistentVolumeClaim'
        ];

        if (namespacedResources.includes(parsed.kind) &&
            (!parsed.metadata || !parsed.metadata.namespace)) {

            // Find position for diagnostic
            const metadataPos = document.getText().indexOf('metadata:');
            if (metadataPos !== -1) {
                const startPos = document.positionAt(metadataPos);
                const endPos = document.positionAt(metadataPos + 9);
                const range = new vscode.Range(startPos, endPos);

                const diagnostic = new vscode.Diagnostic(
                    range,
                    `${parsed.kind} should have a namespace specified for better resource management`,
                    vscode.DiagnosticSeverity.Warning
                );
                diagnostic.source = 'Kubernetes Best Practices';
                diagnostics.push(diagnostic);
            }
        }
    }
    // Check for potential recursive dependencies in Flux kustomizations
    private checkRecursiveDependencies(document: vscode.TextDocument, parsed: any, diagnostics: vscode.Diagnostic[]) {
        if (!parsed || !parsed.apiVersion || !parsed.kind) return;

        if (parsed.apiVersion === 'kustomize.toolkit.fluxcd.io/v1beta2' &&
            parsed.kind === 'Kustomization' &&
            parsed.spec && parsed.spec.dependsOn) {

            const currentName = parsed.metadata?.name;
            const dependencies = parsed.spec.dependsOn;

            // Check if the kustomization depends on itself
            if (Array.isArray(dependencies) && currentName &&
                dependencies.some(dep => typeof dep === 'string' ? dep === currentName : dep.name === currentName)) {

                const dependsOnPos = document.getText().indexOf('dependsOn:');
                if (dependsOnPos !== -1) {
                    const startPos = document.positionAt(dependsOnPos);
                    const endPos = document.positionAt(dependsOnPos + 10);
                    const range = new vscode.Range(startPos, endPos);

                    const diagnostic = new vscode.Diagnostic(
                        range,
                        'Kustomization has a self-reference in dependsOn which would create a circular dependency',
                        vscode.DiagnosticSeverity.Error
                    );
                    diagnostic.source = 'Flux Kustomize';
                    diagnostics.push(diagnostic);
                }
            }
        }
    }
    // Check for inconsistent indentation
    private checkIndentation(document: vscode.TextDocument, diagnostics: vscode.Diagnostic[]) {
        const text = document.getText();
        const lines = text.split('\n');

        let prevIndent = 0;
        let prevIndentSize = 0;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (!line.trim()) continue; // Skip empty lines

            // Count leading spaces
            const leadingSpaces = line.length - line.trimLeft().length;

            if (leadingSpaces > 0) {
                // Determine indentation size on first indented line
                if (prevIndent === 0 && leadingSpaces > 0) {
                    prevIndentSize = leadingSpaces;
                    prevIndent = leadingSpaces;
                    continue;
                }

                // Check if indentation is not a multiple of the indent size
                if (prevIndentSize > 0 && leadingSpaces % prevIndentSize !== 0) {
                    const range = new vscode.Range(
                        new vscode.Position(i, 0),
                        new vscode.Position(i, leadingSpaces)
                    );

                    const diagnostic = new vscode.Diagnostic(
                        range,
                        `Inconsistent indentation. Expected a multiple of ${prevIndentSize} spaces`,
                        vscode.DiagnosticSeverity.Warning
                    );
                    diagnostic.source = 'YAML Formatting';
                    diagnostics.push(diagnostic);
                }

                prevIndent = leadingSpaces;
            }
        }
    }
    // Check for hardcoded image tags, especially 'latest'
    private checkImageTags(document: vscode.TextDocument, parsed: any, diagnostics: vscode.Diagnostic[]) {
        if (!parsed) return;

        // Recursively search for container image references
        const checkContainers = (obj: any, path: string) => {
            if (!obj || typeof obj !== 'object') return;

            if (Array.isArray(obj)) {
                obj.forEach((item, index) => {
                    checkContainers(item, `${path}[${index}]`);
                });
                return;
            }

            // Check for container image references
            if (obj.image && typeof obj.image === 'string') {
                // Find position in document
                const imagePos = document.getText().indexOf(`image: ${obj.image}`);
                if (imagePos === -1) return;

                const startPos = document.positionAt(imagePos + 7); // after "image: "
                const endPos = document.positionAt(imagePos + 7 + obj.image.length);
                const range = new vscode.Range(startPos, endPos);

                // Check for 'latest' tag
                if (obj.image.endsWith(':latest')) {
                    const diagnostic = new vscode.Diagnostic(
                        range,
                        'Using ":latest" tag is not recommended for production as it makes deployments unpredictable',
                        vscode.DiagnosticSeverity.Warning
                    );
                    diagnostic.source = 'Kubernetes Best Practices';
                    diagnostics.push(diagnostic);
                }

                // Check for missing tag (defaults to 'latest')
                if (!obj.image.includes(':')) {
                    const diagnostic = new vscode.Diagnostic(
                        range,
                        'Image tag not specified. This defaults to ":latest" which is not recommended for production',
                        vscode.DiagnosticSeverity.Warning
                    );
                    diagnostic.source = 'Kubernetes Best Practices';
                    diagnostics.push(diagnostic);
                }
            }

            // Recurse through properties
            for (const key in obj) {
                checkContainers(obj[key], `${path}.${key}`);
            }
        };

        checkContainers(parsed, 'root');
    }
    // Check for version mismatches in Flux resources
    private checkFluxVersions(document: vscode.TextDocument, parsed: any, diagnostics: vscode.Diagnostic[]) {
        if (!parsed || !parsed.apiVersion || !parsed.kind) return;

        // Check for deprecated Flux API versions
        if (parsed.apiVersion === 'kustomize.toolkit.fluxcd.io/v1beta1' &&
            (parsed.kind === 'Kustomization' || parsed.kind === 'GitRepository')) {

            const apiVersionPos = document.getText().indexOf(parsed.apiVersion);
            if (apiVersionPos !== -1) {
                const startPos = document.positionAt(apiVersionPos);
                const endPos = document.positionAt(apiVersionPos + parsed.apiVersion.length);
                const range = new vscode.Range(startPos, endPos);

                const diagnostic = new vscode.Diagnostic(
                    range,
                    `Deprecated Flux API version. Consider upgrading to 'kustomize.toolkit.fluxcd.io/v1beta2'`,
                    vscode.DiagnosticSeverity.Warning
                );
                diagnostic.source = 'Flux API';
                diagnostics.push(diagnostic);
            }
        }
    }
    // Check if essential GitOps components are present
    private checkGitOpsComponents(document: vscode.TextDocument, parsed: any, diagnostics: vscode.Diagnostic[]) {
        if (!parsed || !parsed.apiVersion || !parsed.kind) return;

        // For Flux Kustomization, check if it has a valid source reference
        if (parsed.apiVersion === 'kustomize.toolkit.fluxcd.io/v1beta2' &&
            parsed.kind === 'Kustomization') {

            if (!parsed.spec || !parsed.spec.sourceRef) {
                const specPos = document.getText().indexOf('spec:');
                if (specPos !== -1) {
                    const startPos = document.positionAt(specPos);
                    const endPos = document.positionAt(specPos + 5);
                    const range = new vscode.Range(startPos, endPos);

                    const diagnostic = new vscode.Diagnostic(
                        range,
                        'Kustomization is missing sourceRef, which is required to specify the source for this kustomization',
                        vscode.DiagnosticSeverity.Error
                    );
                    diagnostic.source = 'Flux Configuration';
                    diagnostics.push(diagnostic);
                }
            } else if (!parsed.spec.sourceRef.kind || !parsed.spec.sourceRef.name) {
                const sourceRefPos = document.getText().indexOf('sourceRef:');
                if (sourceRefPos !== -1) {
                    const startPos = document.positionAt(sourceRefPos);
                    const endPos = document.positionAt(sourceRefPos + 10);
                    const range = new vscode.Range(startPos, endPos);

                    const diagnostic = new vscode.Diagnostic(
                        range,
                        'sourceRef is incomplete. It requires both kind and name to be specified',
                        vscode.DiagnosticSeverity.Error
                    );
                    diagnostic.source = 'Flux Configuration';
                    diagnostics.push(diagnostic);
                }
            }
        }
    }
    // Check for configurations that might cause performance issues
    private checkPerformanceIssues(document: vscode.TextDocument, parsed: any, diagnostics: vscode.Diagnostic[]) {
        if (!parsed) return;

        // Check for very low intervals in Flux resources
        if (parsed.apiVersion &&
            parsed.apiVersion.includes('toolkit.fluxcd.io') &&
            parsed.spec) {

            // Check interval settings
            if (parsed.spec.interval && typeof parsed.spec.interval === 'string') {
                const intervalValue = parseInt(parsed.spec.interval);
                const intervalUnit = parsed.spec.interval.replace(/[0-9]/g, '').trim();

                let tooFrequent = false;
                if ((intervalUnit === 's' && intervalValue < 30) ||
                    (intervalUnit === 'm' && intervalValue < 1)) {
                    tooFrequent = true;
                }

                if (tooFrequent) {
                    const intervalPos = document.getText().indexOf(`interval: ${parsed.spec.interval}`);
                    if (intervalPos !== -1) {
                        const startPos = document.positionAt(intervalPos + 10); // after "interval: "
                        const endPos = document.positionAt(intervalPos + 10 + parsed.spec.interval.length);
                        const range = new vscode.Range(startPos, endPos);

                        const diagnostic = new vscode.Diagnostic(
                            range,
                            'Very short sync interval might cause performance issues. Consider using a longer interval (1m or more)',
                            vscode.DiagnosticSeverity.Warning
                        );
                        diagnostic.source = 'Flux Performance';
                        diagnostics.push(diagnostic);
                    }
                }
            }
        }
    }
    // Extended check for variable substitution issues
    private checkExtendedVariableIssues(document: vscode.TextDocument, content: string, diagnostics: vscode.Diagnostic[]) {
        // Check for unclosed variable expressions
        const unclosedVarRegex = /\${([^}]*)$/gm;
        let match;

        while ((match = unclosedVarRegex.exec(content))) {
            const startPos = document.positionAt(match.index);
            const endPos = document.positionAt(match.index + match[0].length);
            const range = new vscode.Range(startPos, endPos);

            const diagnostic = new vscode.Diagnostic(
                range,
                'Unclosed variable substitution expression',
                vscode.DiagnosticSeverity.Error
            );
            diagnostic.source = 'Flux Variable Substitution';
            diagnostics.push(diagnostic);
        }

        // Check for nested variable expressions (not supported by Flux)
        const nestedVarRegex = /\${[^}]*\${[^}]*}/g;

        while ((match = nestedVarRegex.exec(content))) {
            const startPos = document.positionAt(match.index);
            const endPos = document.positionAt(match.index + match[0].length);
            const range = new vscode.Range(startPos, endPos);

            const diagnostic = new vscode.Diagnostic(
                range,
                'Nested variable substitution is not supported by Flux',
                vscode.DiagnosticSeverity.Error
            );
            diagnostic.source = 'Flux Variable Substitution';
            diagnostics.push(diagnostic);
        }

        // Check for variables in inappropriate places (e.g., in apiVersion or kind)
        const yamlLines = content.split('\n');

        for (let i = 0; i < yamlLines.length; i++) {
            const line = yamlLines[i];

            if ((line.startsWith('apiVersion:') || line.startsWith('kind:')) &&
                line.includes('${')) {

                const varMatch = /\${([^}]*)}/g.exec(line);
                if (varMatch) {
                    const lineStartPos = document.positionAt(
                        content.indexOf(line)
                    );
                    const varStartPos = new vscode.Position(
                        lineStartPos.line,
                        line.indexOf('${')
                    );
                    const varEndPos = new vscode.Position(
                        lineStartPos.line,
                        line.indexOf('${') + varMatch[0].length
                    );

                    const range = new vscode.Range(varStartPos, varEndPos);

                    const diagnostic = new vscode.Diagnostic(
                        range,
                        'Variable substitution should not be used in apiVersion or kind fields',
                        vscode.DiagnosticSeverity.Warning
                    );
                    diagnostic.source = 'Flux Variable Substitution';
                    diagnostics.push(diagnostic);
                }
            }
        }
    }
    // Check for common security misconfigurations
    private checkSecurityIssues(document: vscode.TextDocument, parsed: any, diagnostics: vscode.Diagnostic[]) {
        if (!parsed) return;

        // Check for privileged containers
        const checkPrivileged = (obj: any, path: string) => {
            if (!obj || typeof obj !== 'object') return;

            if (Array.isArray(obj)) {
                obj.forEach((item, index) => {
                    checkPrivileged(item, `${path}[${index}]`);
                });
                return;
            }

            // Check for privileged security context
            if (obj.securityContext && obj.securityContext.privileged === true) {
                // Find position in document
                const privilegedPos = document.getText().indexOf('privileged: true');
                if (privilegedPos === -1) return;

                const startPos = document.positionAt(privilegedPos);
                const endPos = document.positionAt(privilegedPos + 16);
                const range = new vscode.Range(startPos, endPos);

                const diagnostic = new vscode.Diagnostic(
                    range,
                    'Container is running with privileged security context which gives all capabilities of the host machine',
                    vscode.DiagnosticSeverity.Warning
                );
                diagnostic.source = 'Kubernetes Security';
                diagnostics.push(diagnostic);
            }

            // Check for hostNetwork
            if (obj.hostNetwork === true) {
                const hostNetworkPos = document.getText().indexOf('hostNetwork: true');
                if (hostNetworkPos === -1) return;

                const startPos = document.positionAt(hostNetworkPos);
                const endPos = document.positionAt(hostNetworkPos + 16);
                const range = new vscode.Range(startPos, endPos);

                const diagnostic = new vscode.Diagnostic(
                    range,
                    'Pod is using host network which gives access to the host network namespace',
                    vscode.DiagnosticSeverity.Warning
                );
                diagnostic.source = 'Kubernetes Security';
                diagnostics.push(diagnostic);
            }

            // Recurse through properties
            for (const key in obj) {
                checkPrivileged(obj[key], `${path}.${key}`);
            }
        };

        checkPrivileged(parsed, 'root');
    }

    private checkDeprecatedPatches(document: vscode.TextDocument, parsed: any, diagnostics: vscode.Diagnostic[]) {
        const text = document.getText();
        
        // Check for patchesStrategicMerge (deprecated in Kustomize v5.0.0, February 2023)
        if (parsed.patchesStrategicMerge && Array.isArray(parsed.patchesStrategicMerge) && parsed.patchesStrategicMerge.length > 0) {
            const fieldPos = text.indexOf('patchesStrategicMerge:');
            if (fieldPos !== -1) {
                const startPos = document.positionAt(fieldPos);
                const endPos = document.positionAt(fieldPos + 'patchesStrategicMerge'.length);
                const range = new vscode.Range(startPos, endPos);

                const diagnostic = new vscode.Diagnostic(
                    range,
                    "'patchesStrategicMerge' is deprecated. Use 'patches' field instead. Deprecated in Kustomize v5.0.0 (February 2023).",
                    vscode.DiagnosticSeverity.Warning
                );
                diagnostic.source = 'Kustomize Navigator';
                diagnostic.code = 'deprecated-patchesStrategicMerge';
                diagnostics.push(diagnostic);
            }
        }

        // Check for patchesJson6902 (deprecated in Kustomize v5.0.0, February 2023)
        if (parsed.patchesJson6902 && Array.isArray(parsed.patchesJson6902) && parsed.patchesJson6902.length > 0) {
            const fieldPos = text.indexOf('patchesJson6902:');
            if (fieldPos !== -1) {
                const startPos = document.positionAt(fieldPos);
                const endPos = document.positionAt(fieldPos + 'patchesJson6902'.length);
                const range = new vscode.Range(startPos, endPos);

                const diagnostic = new vscode.Diagnostic(
                    range,
                    "'patchesJson6902' is deprecated. Use 'patches' field instead. Deprecated in Kustomize v5.0.0 (February 2023).",
                    vscode.DiagnosticSeverity.Warning
                );
                diagnostic.source = 'Kustomize Navigator';
                diagnostic.code = 'deprecated-patchesJson6902';
                diagnostics.push(diagnostic);
            }
        }

        // Also check Flux Kustomization CRs (spec.patchesStrategicMerge and spec.patchesJson6902)
        if (parsed.spec) {
            if (parsed.spec.patchesStrategicMerge && Array.isArray(parsed.spec.patchesStrategicMerge) && parsed.spec.patchesStrategicMerge.length > 0) {
                const fieldPos = text.indexOf('patchesStrategicMerge:');
                if (fieldPos !== -1) {
                    const startPos = document.positionAt(fieldPos);
                    const endPos = document.positionAt(fieldPos + 'patchesStrategicMerge'.length);
                    const range = new vscode.Range(startPos, endPos);

                    const diagnostic = new vscode.Diagnostic(
                        range,
                        "'patchesStrategicMerge' is deprecated. Use 'patches' field instead. Deprecated in Kustomize v5.0.0 (February 2023).",
                        vscode.DiagnosticSeverity.Warning
                    );
                    diagnostic.source = 'Kustomize Navigator';
                    diagnostic.code = 'deprecated-patchesStrategicMerge';
                    diagnostics.push(diagnostic);
                }
            }

            if (parsed.spec.patchesJson6902 && Array.isArray(parsed.spec.patchesJson6902) && parsed.spec.patchesJson6902.length > 0) {
                const fieldPos = text.indexOf('patchesJson6902:');
                if (fieldPos !== -1) {
                    const startPos = document.positionAt(fieldPos);
                    const endPos = document.positionAt(fieldPos + 'patchesJson6902'.length);
                    const range = new vscode.Range(startPos, endPos);

                    const diagnostic = new vscode.Diagnostic(
                        range,
                        "'patchesJson6902' is deprecated. Use 'patches' field instead. Deprecated in Kustomize v5.0.0 (February 2023).",
                        vscode.DiagnosticSeverity.Warning
                    );
                    diagnostic.source = 'Kustomize Navigator';
                    diagnostic.code = 'deprecated-patchesJson6902';
                    diagnostics.push(diagnostic);
                }
            }
        }
    }

    public dispose() {
        this.diagnosticCollection.dispose();
        for (const disposable of this.disposables) {
            disposable.dispose();
        }
    }
}