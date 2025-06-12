# Change Log

All notable changes to the "Kustomize Navigator" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [Unreleased]

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