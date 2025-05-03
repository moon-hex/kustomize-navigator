# Kustomize Navigator

A Visual Studio Code extension that enhances your Kubernetes GitOps workflow by providing intelligent navigation between Kustomize YAML files.

## Features

- **Smart Link Detection**: Automatically identifies Kustomize files by content, not just filename
- **Ctrl+Click Navigation**: Easily navigate between related Kustomize files with ctrl+click
- **Resource Verification**: Displays warnings for references to non-existent files
- **Back-Reference Support**: Shows which files reference the current file
- **GitOps Ready**: Works with any Kubernetes GitOps repository that uses Kustomize
- **Flux Variable Support**: Highlights and validates Flux variable substitutions like `${cluster_env:=dev}`
- **Variable Autocompletion**: Suggests variables when typing `${` based on workspace usage
- **Intelligent Diagnostics**: Identifies common configuration issues in Kubernetes and Flux manifests
- **Customizable Checks**: Toggle individual diagnostic checks through settings

![Kustomize Navigator Demo](images/demo.png)

## Extension Settings

### General Settings

- `kustomizeNavigator.highlightFluxVariables`: Enable/disable highlighting Flux variables (default: `true`)
- `kustomizeNavigator.fluxVariableColor`: Color to use for highlighting Flux variables (default: `#3498db`)
- `kustomizeNavigator.standardFluxVariables`: List of standard Flux variables to suggest in autocompletion

### Diagnostic Checks

- `kustomizeNavigator.diagnostics.enabled`: Master toggle for all diagnostic checks (default: `true`)
- `kustomizeNavigator.diagnostics.checks.resourceNaming`: Check resource names against Kubernetes naming conventions (default: `true`)
- `kustomizeNavigator.diagnostics.checks.namespaceRequired`: Check if namespaced resources have a namespace specified (default: `true`)
- `kustomizeNavigator.diagnostics.checks.recursiveDependencies`: Check for recursive dependencies in Flux kustomizations (default: `true`)
- `kustomizeNavigator.diagnostics.checks.imageTags`: Check for hardcoded image tags or missing tags (default: `true`)
- `kustomizeNavigator.diagnostics.checks.securityIssues`: Check for common security issues like privileged containers (default: `true`)
- `kustomizeNavigator.diagnostics.checks.fluxVersions`: Check for deprecated Flux API versions (default: `true`)
- `kustomizeNavigator.diagnostics.checks.gitopsComponents`: Check if essential GitOps components are present (default: `true`)
- `kustomizeNavigator.diagnostics.checks.performanceIssues`: Check for configurations that might cause performance issues (default: `true`)
- `kustomizeNavigator.diagnostics.checks.variableSubstitution`: Check for Flux variable substitution issues (default: `true`)
- `kustomizeNavigator.diagnostics.checks.indentation`: Check for consistent YAML indentation (default: `true`)

## Known Issues

- Remote Git references (like `github.com/...`) are not yet supported for navigation
- Missing files warning indicators are not showing in the tooltip

## Diagnostic Checks

The extension analyzes your YAML files for common issues and best practices:

### Kubernetes Best Practices
- Resource naming conventions
- Namespace specifications for namespaced resources 
- Container image tag usage
- YAML indentation consistency

### Security Checks
- Detection of privileged containers
- Host network usage warnings
- Security context configuration issues

### Flux-specific Checks
- API version deprecation warnings
- Recursive dependency detection
- Variable substitution syntax validation
- Essential GitOps component verification
- Performance optimization suggestions

## Release Notes

### 0.1.0

Initial release
- Ctrl+click navigation between Kustomize files
- Warning indicators for missing files
- Support for identifying Kustomize content regardless of filename

### 0.2.0

Improvements
- Enhanced Kustomize detection: Now identifies Kustomize files by content, not just filename
- Resource Preview: Hover over Kustomize references to see a list of resources defined in the target file
- Clickable Resource List: Each resource in the preview is clickable for direct navigation

Bug Fixes
- Fixed link detection for unquoted YAML references
- Corrected path resolution for directory-based kustomization files
- Fixed handling of various Kustomize file formats

### 0.2.1

Bug Fixes
- VS Code engine version constraint: Changed from "^1.99.0" to ">=1.0.0"

### 0.3.0

Improvements
- Added support for decoration of post-build substitution variables in Flux

### 0.4.0

Improvements
- Added various diagnostic and security checks
- Added configuration options for customizing extension behavior

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This extension is licensed under the [MIT License](LICENSE).
