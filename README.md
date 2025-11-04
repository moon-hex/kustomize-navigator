# Kustomize Navigator

A Visual Studio Code extension that enhances your Kubernetes GitOps workflow by providing intelligent navigation between Kustomize YAML files.

## Features

- **Smart Navigation**: Ctrl+click to navigate between Kustomize files
- **Back References**: View which files reference the current file
- **Flux Support**: Works with both standard Kustomize and Flux CD
- **Variable Highlighting**: Highlights and validates Flux variable substitutions
- **Intelligent Diagnostics**: Identifies common configuration issues
- **References Explorer**: View all references in a dedicated panel
- **Comprehensive Patch Support**: Full linking and highlighting for all patch formats (including deprecated ones for backward compatibility)

![Kustomize Navigator Demo](https://github.com/moon-hex/kustomize_navigator_resources/blob/main/demo.png?raw=true)

## Quick Start

1. Open a Kubernetes GitOps repository
2. Use Ctrl+Click on any kustomization reference to navigate
3. View back references in the "Kustomize Back References" panel
4. Hover over Flux variables for details and suggestions

## Extension Settings

Key settings (see VS Code settings for all options):

- `kustomizeNavigator.highlightFluxVariables`: Enable/disable Flux variable highlighting
- `kustomizeNavigator.diagnostics.enabled`: Toggle all diagnostic checks
- `kustomizeNavigator.standardFluxVariables`: List of standard Flux variables for autocompletion

## Patch Format Support

The extension supports all patch formats used in Kustomize and Flux:

### Recommended (Current)
- **`patches`**: Unified patch field supporting multiple formats:
  - String format: `patches: [patch.yaml]`
  - Object with path: `patches: [{path: patch.yaml, target: {...}}]`
  - Inline patch: `patches: [{patch: |-..., target: {...}}]`

### Deprecated (Still Supported)
- **`patchesStrategicMerge`**: Deprecated in Kustomize v5.0.0 (February 2023)
  - Supported format: `patchesStrategicMerge: [patch.yaml]`
  - Use `patches` field instead
- **`patchesJson6902`**: Deprecated in Kustomize v5.0.0 (February 2023)
  - Supported format: `patchesJson6902: [{path: patch.yaml, target: {...}}]`
  - Use `patches` field instead

**Note**: All patch formats support clickable navigation links and hover information. The extension maintains backward compatibility with deprecated formats while recommending migration to the `patches` field.

## Diagnostic Checks

The extension provides comprehensive validation for your Kubernetes and Flux configurations:

### Kubernetes Checks
- Resource naming conventions
- Namespace requirements
- Image tag usage
- YAML formatting

### Security Checks
- Privileged containers
- Host network usage
- Security context settings

### Flux-specific Checks
- API version deprecation
- Recursive dependencies
- Variable substitution
- GitOps components
- Performance optimization

Each check can be individually enabled/disabled in settings.

## Recent Changes

### 0.8.4
- Fixed array element validation and improved regex pattern matching
- Enhanced deprecation warning detection for multi-document YAML files
- Improved type safety with strict equality checks

### 0.8.3
- Added deprecation warnings for `patchesStrategicMerge` and `patchesJson6902`
- Added quick fix code action to transform deprecated fields to `patches` format
- New configuration option to control deprecation warnings

### 0.8.2
- Enhanced patch format support: all combinations now support linking and highlighting
- Improved reference detection for patch objects in YAML
- Documentation updated with patch format recommendations and deprecation notices

### 0.8.1
- Improved handling of references for all YAML files
- Enhanced display of Flux and K8s references
- Better error handling and user feedback

### 0.8.0
- Create kustomization files by clicking links
- Improved directory target handling
- Better diagnostics for missing files

### 0.7.2
- Enhanced References View with document counts
- Fixed back reference tracking
- Improved path resolution

### 0.7.1
- Simplified References View
- Updated UI and documentation

## Known Issues

- Remote Git references not supported
- May activate on YAML files without kustomization files

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This extension is licensed under the [MIT License](LICENSE).