# Performance Optimizations

This document describes the performance optimizations implemented in Kustomize Navigator, with a focus on file system operation caching.

## File System Caching

### Overview

The extension implements intelligent file system operation caching to reduce I/O overhead. File existence checks (`fs.existsSync`) and file stats (`fs.statSync`) are cached to avoid repeated filesystem queries.

### Caching Principles

#### 1. Trust Cache by Default

- **No validation on access**: Cache entries are trusted without validation via `fs.statSync()`
- **File watcher invalidation**: Cache entries are invalidated when files change, detected by VS Code file system watchers
- **Result**: ~90-95% reduction in I/O operations for cached entries

#### 2. Cache Invalidation Strategy

Cache entries are invalidated in the following scenarios:

- **File change detected**: When file watcher fires `onDidChange`, `onDidCreate`, or `onDidDelete` events
- **Explicit invalidation**: Via `invalidateFileCache()` method when files are updated
- **Mass change detection**: When >50 files change within 1 second (e.g., git branch switch), entire cache is cleared
- **Safety fallback**: If file operation fails unexpectedly, cache entry is validated and updated

#### 3. Mass Change Detection

To handle scenarios like git branch switches where hundreds of files change simultaneously:

- **Threshold**: 50 files changed within 1 second window
- **Action**: Clear entire cache and trigger full rebuild instead of incremental updates
- **Rationale**: More efficient than invalidating hundreds of individual cache entries

#### 4. Safety Validation Fallback

For edge cases where file watcher might miss changes:

- **Trigger**: When file operations fail unexpectedly (e.g., file doesn't exist but cache says it does)
- **Action**: Validate and update cache entry for that specific file
- **Scope**: Only validates the specific file that failed, not entire cache

### Cache Structure

```typescript
// File existence cache
fileExistsCache: Map<string, { exists: boolean; mtime: number }>

// File stat cache
fileStatCache: Map<string, { mtime: number; isDirectory: boolean; isFile: boolean }>
```

### Cache Entry States

- **Exists**: `{ exists: true, mtime: <timestamp> }` - File exists with modification time
- **Non-existent**: `{ exists: false, mtime: 0 }` - File doesn't exist (mtime 0 = no validation needed)

### Configuration

Caching can be disabled via VS Code settings:

```json
{
  "kustomizeNavigator.performance.enableFileSystemCache": false
}
```

**When to disable:**
- Debugging cache-related issues
- Testing without caching
- Compatibility with certain file systems

**Default**: `true` (caching enabled)

### Performance Impact

#### Before Optimization
- Every cache access required `fs.statSync()` validation
- Hundreds of I/O operations during normal usage
- Cache provided minimal benefit

#### After Optimization
- Cache access requires no I/O (trust cache)
- Only I/O on cache miss or explicit invalidation
- ~90-95% reduction in file system operations

### Trade-offs

#### Benefits
- Significant I/O reduction
- Faster response times
- Better scalability for large workspaces

#### Considerations
- Relies on file watcher for invalidation (VS Code handles this well)
- Safety fallback handles edge cases
- Mass change detection ensures correctness during branch switches

### Implementation Details

#### Cache Access Flow

1. **Check cache**: Look up entry in `fileExistsCache` or `fileStatCache`
2. **Return if cached**: Return cached value immediately (no validation)
3. **Cache miss**: Fetch from filesystem and cache result
4. **Invalidation**: File watcher invalidates entries when files change

#### Mass Change Detection Flow

1. **Track events**: Add file path to `recentChangeEvents` array
2. **Check threshold**: If >50 events in 1 second window
3. **Clear cache**: Call `clearCaches()` to clear all cache entries
4. **Full rebuild**: Trigger `buildReferenceMap()` instead of incremental updates
5. **Reset tracking**: Clear `recentChangeEvents` array

### Best Practices

1. **Trust the cache**: Don't validate on every access
2. **Invalidate on change**: Use file watcher events for invalidation
3. **Handle mass changes**: Detect and clear cache for bulk operations
4. **Safety net**: Validate individual entries when operations fail
5. **Monitor performance**: Track cache hit rates if needed

### Future Improvements

Potential enhancements:
- Cache size limits (LRU eviction)
- TTL-based validation for rarely-accessed files
- Cache hit/miss metrics
- Configurable mass change threshold

