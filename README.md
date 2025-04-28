# Kustomize Navigator

A Visual Studio Code extension that enhances your Kubernetes GitOps workflow by providing intelligent navigation between Kustomize YAML files.

## Features

- **Smart Link Detection**: Automatically identifies Kustomize files by content, not just filename
- **Ctrl+Click Navigation**: Easily navigate between related Kustomize files with ctrl+click
- **Resource Verification**: Displays warnings for references to non-existent files
- **Back-Reference Support**: Shows which files reference the current file
- **GitOps Ready**: Works with any Kubernetes GitOps repository that uses Kustomize

## How It Works

Kustomize Navigator parses your YAML files to find relationships between them and then provides clickable links for easy navigation:

- In kustomization files, it creates links for all resources, bases, patches, etc.
- In referenced files, it shows which kustomization files reference them
- Missing files are highlighted with warnings

![Kustomize Navigator Demo](images/demo.gif)

## Supported References

The extension identifies and creates links for the following Kustomize fields:

- `resources`
- `bases`
- `components`
- `patches`
- `patchesStrategicMerge`
- `patchesJson6902`
- `configurations`
- `crds`
- `generators`
- `transformers`

## Installation

1. Open VS Code
2. Go to Extensions (Ctrl+Shift+X)
3. Search for "Kustomize Navigator"
4. Click Install

## Requirements

- Visual Studio Code 1.99.0 or higher
- A workspace containing Kustomize YAML files

## Usage

1. Open a folder containing Kustomize files
2. Open any kustomization.yaml file or any YAML file that uses Kustomize format
3. Hover over a reference to see the link tooltip
4. Ctrl+click (or Cmd+click on macOS) to navigate to the referenced file
5. Missing files will be highlighted with warning indicators

## Extension Settings

Currently, this extension does not have configurable settings.

## Known Issues

- Remote Git references (like `github.com/...`) are not yet supported for navigation
- The extension activates for all YAML files in workspaces containing Kustomize files

## Release Notes

### 0.1.0

- Initial release
- Ctrl+click navigation between Kustomize files
- Warning indicators for missing files
- Support for identifying Kustomize content regardless of filename

### 0.1.1

- **VS Code engine version constraint**: Changed from "^1.99.0" to ">=1.0.0"

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This extension is licensed under the [MIT License](LICENSE).
