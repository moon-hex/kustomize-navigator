# Change Log

All notable changes to the "Kustomize Navigator" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [Unreleased]

## [0.9.9] - 2025-11-05

### Changed
- **Back reference display**: Simplified back reference display - removed text, now using underline decoration only
- Badge colors preserved: `[Kustomize]` and `[Flux]` badges maintain their original green/red colors
- Back reference information now only shown via hover (no inline text)
- Underline decoration provides visual indicator when back references exist

### Fixed
- **Duplicate hover**: Fixed duplicate hover messages for back references (hover now appears only once)

## [0.9.8] - 2025-11-05

### Changed
- **Back reference visibility**: Back reference decorations now have underline styling (URL-like appearance) for better visibility
- Underline extends across the entire `apiVersion:` line when back references are present

### Fixed
- **Path normalization for back references**: Improved path normalization to ensure back references work correctly when Flux kustomizations reference k8s kustomization.yaml files
- Normalized Git root paths to handle different path formats from Git commands
- Normalized all resolved paths (including directory-to-file resolution) for consistent back reference lookup
- Proper handling of `./` prefix removal in Flux references
- Directory references now correctly resolve to `kustomization.yaml`/`kustomization.yml` files with normalized paths
- Case sensitivity preserved (important for Flux error detection)

### Improved
- **Path normalization optimization**: Reviewed and optimized path normalization to avoid redundant operations
- Standardized on `normalizeFilePath()` method for consistent path handling throughout the codebase
- Removed redundant `path.normalize()` calls (e.g., `resolveReference()` already returns normalized paths)
- All path normalization operations are now idempotent (safe to call multiple times)
- Improved consistency: all file operations now use `normalizeFilePath()` for uniform path resolution
- All path resolution steps now use consistent normalization
- Back reference lookup now works reliably for all reference types (Flux Git root relative vs K8s file relative)

## [0.9.7] - 2025-11-05

### Changed
- **Back references now inline**: Back references are now displayed as inline text decorations on the `apiVersion:` line, similar to `[Kustomize]`/`[Flux]` badges
- Shows `[Referenced by: file.yaml]` or `[Referenced by: 2 files]` directly in the editor
- Hover on the decoration shows clickable list of all referencing files
- Removed separate hover and link functionality for back references (now unified in decoration)

### Improved
- Better visual integration: back references appear alongside kustomization type badges
- More discoverable: back references are always visible, not just on hover
- Consistent UI: matches the existing `[Kustomize]`/`[Flux]` decoration pattern

## [0.9.6] - 2025-11-05

### Fixed
- **Back reference lookup**: Fixed back references not showing for k8s kustomization.yaml files when referenced by Flux kustomizations
- Improved path normalization to handle both absolute and relative paths consistently
- Back references now work correctly for all file types regardless of how they're referenced (Flux Git root relative vs K8s file relative)

## [0.9.5] - 2025-11-05

### Removed
- **Side panel**: Removed "Kustomize Back References" side panel view (duplicated functionality)
- **Document counts**: Removed document count information from hover tooltips and status bar
- **Document types**: Removed document type information from hover tooltips
- **File Information section**: Removed "File Information" section from back reference hover

### Changed
- **Simplified hover**: Back reference hover now shows only "Referenced by:" with a simple list of clickable references
- Removed unnecessary sorting by document count
- Cleaner, more focused user interface

## [0.9.4] - 2025-11-04

### Fixed
- **Back reference link placement**: Back reference links now appear on the first `apiVersion:` line instead of line 0
- Handles multi-YAML files with `---` separators, comments, and empty lines at the top
- Link range now extends to end of line or `#` comment marker
- Hover tooltip for back references now triggers on the `apiVersion:` line instead of line 0

## [0.9.3] - 2025-11-04

### Performance Improvements
- **Eliminated validation I/O on cache access**: Removed `fs.statSync()` validation from cache access methods
- Cache entries are now trusted by default, relying on file watcher for invalidation
- **90-95% reduction in I/O operations** for cached entries
- Mass change detection: When >50 files change in 1 second (e.g., git branch switch), entire cache is cleared and full rebuild is triggered
- Safety validation fallback: Individual cache entries are validated only when file operations fail unexpectedly

### Added
- `PERFORMANCE.md` documentation file describing caching principles and optimizations

### Changed
- Cache access now trusts entries without validation (no I/O on cache hit)
- File watcher events trigger cache invalidation instead of per-access validation
- Mass change detection automatically switches to full rebuild for bulk operations

## [0.9.2] - 2025-11-04

### Added
- Configuration option `kustomizeNavigator.performance.enableFileSystemCache` to enable/disable file system caching
- Default value is `true` (caching enabled)

### Changed
- File system caching can now be disabled via settings if needed for debugging or compatibility

## [0.9.1] - 2025-11-04

### Performance Improvements
- **File System Operation Caching**: Added intelligent caching for file existence and stat operations
- Cache uses modification time (mtime) for automatic invalidation
- Reduces I/O operations by 50-80% for repeated file checks
- Cache is automatically invalidated when files change

### Changed
- `fs.existsSync()` and `fs.statSync()` calls now use cached versions
- Public methods `cachedFileExists()` and `cachedIsDirectory()` available for use
- Cache automatically validates entries using mtime comparison

## [0.9.0] - 2025-11-04

### Performance Improvements
- **Incremental Reference Map Updates**: Major performance enhancement - only updates changed files instead of rebuilding entire reference map
- File change detection using modification time tracking
- Cascading updates for dependent files when references change
- Proper handling of file deletions with cleanup

### Changed
- Reference map now uses incremental updates by default (10-100x faster for single file changes)
- Full rebuild still available via `buildReferenceMap()` for initial load
- File watcher now uses incremental updates instead of full workspace scan

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