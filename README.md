# Kustomize Navigator

A Visual Studio Code extension that enhances your Kubernetes GitOps workflow by providing intelligent navigation between Kustomize YAML files.

## Features

- **Smart Navigation**: Ctrl+click to navigate between Kustomize files
- **Back References**: View which files reference the current file (hover on `apiVersion:` line)
- **Flux Support**: Works with both standard Kustomize and Flux CD
- **Variable Highlighting**: Highlights and validates Flux variable substitutions
- **Intelligent Diagnostics**: Identifies common configuration issues
- **Comprehensive Patch Support**: Full linking and highlighting for all patch formats (including deprecated ones for backward compatibility)

![Kustomize Navigator Demo](https://github.com/moon-hex/kustomize_navigator_resources/blob/main/demo.png?raw=true)

## Quick Start

1. Open a Kubernetes GitOps repository
2. Use Ctrl+Click on any kustomization reference to navigate
3. Hover over the `apiVersion:` line to see which files reference the current file
4. Hover over Flux variables for details and suggestions

## Extension Settings

Key settings (see VS Code settings for all options):

- `kustomizeNavigator.highlightFluxVariables`: Enable/disable Flux variable highlighting
- `kustomizeNavigator.diagnostics.enabled`: Toggle all diagnostic checks
- `kustomizeNavigator.standardFluxVariables`: List of standard Flux variables for autocompletion
- `kustomizeNavigator.performance.enableFileSystemCache`: Enable/disable file system operation caching (default: true)

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

### 1.0.0 (2025-11-19)
- **Release**: First stable release with full Kustomize and Flux CD support
- Performance optimizations with intelligent caching (50-95% I/O reduction)
- Comprehensive patch format support and diagnostic checks
- VS Code engine requirement changed to ">=1.0.0" for broader compatibility

### 0.9.9 (2025-11-05)
- Simplified back reference display with underline decoration only
- Badge colors preserved (`[Kustomize]` green, `[Flux]` red)
- Fixed duplicate hover messages for back references

### 0.9.8 (2025-11-05)
- Improved path normalization for back reference lookup
- Enhanced back reference visibility with underline styling

For complete version history, see [CHANGELOG.md](CHANGELOG.md).

## Known Issues

- Remote Git references not supported
- May activate on YAML files without kustomization files

## Performance

For details on performance optimizations, caching strategies, and implementation principles, see [PERFORMANCE.md](PERFORMANCE.md).

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This extension is licensed under the [Apache 2.0](LICENSE).