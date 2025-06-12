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
- **API Version Distinction**: Visually distinguish between standard Kustomize and Flux-extended APIs
- **References Explorer**: View all forward and backward references in a dedicated panel

![Kustomize Navigator Demo](https://github.com/moon-hex/kustomize_navigator_resources/blob/main/demo.png?raw=true)

## References Explorer

The References Explorer panel provides a comprehensive view of all relationships between your Kustomize files:

- **Kustomization References**: Shows other kustomization files that the current file references
- **Resource References**: Shows regular YAML resources that the current file references
- **Referenced By**: Shows which kustomization files reference the current file

This helps you understand the hierarchy and dependencies in your GitOps repository. Each reference is displayed with its parent folder for context, and clicking any reference opens the file directly.

## Variable Highlighting

The extension provides enhanced visibility for Flux variable substitutions:

- **Variable Names**: Highlighted with a configurable color
- **Default Values**: Highlighted with a different color and style
- **Hover Information**: Detailed information about variables and their default values
- **Auto-completion**: Suggests variables based on usage throughout your workspace

## API Version Labeling

Kustomize Navigator visually distinguishes between different types of Kustomize API versions:

- Standard Kustomize files show a `[Kustomize]` label
- Flux-extended files show a `[Flux]` label
- Each label uses a different color for quick identification

## Extension Settings

### General Settings

- `kustomizeNavigator.highlightFluxVariables`: Enable/disable highlighting Flux variables (default: `true`)
- `kustomizeNavigator.fluxVariableColor`: Color to use for highlighting Flux variables (default: `#3498db`)
- `kustomizeNavigator.fluxDefaultValueColor`: Color to use for highlighting default values in Flux variables (default: `#e67e22`)
- `kustomizeNavigator.kustomizeApiColor`: Color to use for Kustomize API version labels (default: `#27ae60`)
- `kustomizeNavigator.fluxApiColor`: Color to use for Flux API version labels (default: `#e74c3c`)
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
- sometimes the extension is activating on yaml even if the working folder does not containe kustomization.y(a)ml

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

# Release Notes

## 0.7.0

**Breaking Changes**
- **Removed Dependency Visualization**: The graphical visualization feature has been removed to focus on core navigation functionality
- **Simplified UI**: Removed visualization-related menu items and commands for a cleaner interface

## 0.6.3

**Bug Fixes**
- **Multi-Document YAML Support**: Fixed issue where files containing multiple Flux Kustomization CRs separated by --- would only process the first document
- **Enhanced YAML Parsing**: Extension now correctly handles and creates clickable links for all Flux Kustomization documents within a single file
- **Code Refactoring**: Improved maintainability by extracting YAML parsing utilities into a separate module for better code organization

## 0.6.2

**Improvements**
- **Enhanced Flux Path Navigation**: Clicking on `path` references in Flux Kustomization CRs now properly opens the target `kustomization.yaml` file instead of the directory
- **Smart Directory Resolution**: When Flux paths point to directories, automatically detects and opens the kustomization file within
- **Improved Tooltips**: Better visual feedback showing exactly which file will be opened when clicking Flux path references

## 0.6.1

**Improvements**
- **Fixed Git Root Path Resolution**: Corrected path resolution for Flux Kustomization CRs to use Git repository root instead of file-relative paths, ensuring proper navigation in GitOps repositories

## 0.6.0

**New Features**
- **Flux Kustomization CR Support**: Full detection and processing of Flux Kustomization Custom Resources (`kustomize.toolkit.fluxcd.io`)
- **Enhanced YAML File Scanning**: Intelligently scans all YAML files to automatically discover Flux Kustomization CRs
- **Bidirectional Flux References**: Complete reference tracking showing which Flux CRs reference your resources and vice versa
- **GitOps-Aware File Watching**: Monitors all YAML files for changes to Flux Kustomization definitions
- **Unified References View**: Single panel displaying both standard kustomization files and Flux CRs with proper categorization

**Improvements**
- **Mixed Repository Support**: Seamless navigation in repositories using both standard Kustomize and Flux CD
- **Enhanced Documentation**: Added Flux-specific usage examples and best practices

## Pre-0.6.0 Feature Summary

**Core Navigation Features**
- **References Explorer Panel**: Comprehensive view of forward and backward references between kustomization files
- **Categorized References**: Smart grouping by type (kustomization vs. resource files) with parent folder context
- **Interactive Dependency Graph**: Visual representation of kustomization dependencies with clickable navigation
- **Ctrl+Click Navigation**: Direct file-to-file navigation between kustomization references
- **Resource Preview on Hover**: See complete resource lists when hovering over kustomization references
- **Clickable Resource Lists**: Direct navigation to individual resources from hover previews

**Content-Aware Detection**
- **Smart Kustomization Detection**: Identifies kustomization files by content analysis, not just filename patterns
- **Flexible File Support**: Works with any YAML file containing valid kustomization structure
- **Missing File Warnings**: Visual indicators and diagnostics for broken references

**Flux CD Integration**
- **Variable Substitution Support**: Syntax highlighting and completion for Flux post-build variables (`${var}`, `${var:=default}`)
- **API Version Decorations**: Visual distinction between standard Kustomize and Flux CD API versions
- **Theme-Aware Highlighting**: Adaptive contrast for variable highlighting in light and dark themes
- **Flux Diagnostics**: Comprehensive validation for Flux-specific configurations and best practices

**Developer Experience**
- **Configurable Behavior**: Extensive settings for customizing extension appearance and functionality
- **Performance Optimized**: Only activates when kustomization files are detected in workspace
- **Broad Compatibility**: Supports VS Code 1.0.0+ with engine constraint optimizations
- **Comprehensive Validation**: Built-in checks for security issues, performance problems, and configuration errors

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This extension is licensed under the [MIT License](LICENSE).