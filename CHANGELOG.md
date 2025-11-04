# Change Log

All notable changes to the "Kustomize Navigator" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [Unreleased]

## [0.8.4] - 2025-11-04

### Fixed
- Fixed array element validation in linkProvider to handle null/undefined values
- Improved regex patterns in yamlUtils to support all YAML reference formats
- Enhanced deprecation warning detection to correctly match occurrences in multi-document YAML files
- Added context-aware field matching to prevent false positives in deprecation warnings

### Changed
- Replaced loose equality checks with strict equality for better type safety

## [0.8.3] - 2025-11-04

### Added
- Deprecation warnings for `patchesStrategicMerge` and `patchesJson6902` fields
- Code action to automatically transform deprecated patch fields to `patches` format
- Configuration option `kustomizeNavigator.diagnostics.checks.deprecatedPatches` to enable/disable warnings

### Changed
- Improved patch format detection and transformation following `kustomize edit fix` behavior

## [0.8.2] - 2025-11-04

### Added
- Comprehensive support for all patch formats (string, object with path, inline patches)
- Enhanced reference detection for patch objects in YAML

### Changed
- Improved linking and highlighting for `patches` field (recommended format)
- Maintained backward compatibility with deprecated `patchesStrategicMerge` and `patchesJson6902`

## [0.8.1] - 2025-11-03

### Changed
- Improved handling of references for all YAML files
- Enhanced display of Flux and K8s references
- Better error handling and user feedback

## [0.8.0] - 2025-06-13

### Added
- New feature to create kustomization files by clicking links
  - When clicking a link that points to a directory, it will create a `kustomization.yaml` file inside
  - Works for both standard kustomizations and Flux kustomizations
  - Shows "Create kustomization" tooltip when hovering over links to non-existent files

### Changed
- Improved handling of directory targets in kustomization references
  - Links now properly handle paths that point to directories
  - Better diagnostics for missing files and directories
  - Clearer warning messages when kustomization files are missing

### Fixed
- Fixed handling of directory references in both standard and Flux kustomizations
- Improved error messages for missing kustomization files

## [0.7.2] - 2025-04-12

### Added
- Initial release