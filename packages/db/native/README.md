# Basic Candidate Native Filesystem Helper

This package-private N-API addon is the Linux-only filesystem boundary for Basic candidate staging.

## Requirements

- Linux with `/proc/self/fd`, `openat`, `mkdirat`, `fstatat`, and `renameat2` with `RENAME_NOREPLACE` and `RENAME_EXCHANGE`.
- A C11 compiler available as `cc`.
- Node headers under the active Node installation prefix.
- A private local service/build account. The staging hierarchy must not be writable by an adversarial same-UID principal.

Build with:

```bash
pnpm --filter @navigator/db run build:basic-candidate-native
```

The build opens source, include, cache, output, and private temporary directories without following final-component symlinks. Compiler inputs and output use explicitly inherited held descriptors. Cleanup unlinks only the known temporary output and removes only its private temporary directory. The ignored addon output is installed as a mode-`0500` regular file.

## Operations

- `createExclusiveDirectory`: creates an unpredictable mode-`0700` child exclusively and returns its held descriptor plus `dev`/`ino`.
- `ensureDirectory`: synchronously creates or opens a mode-`0700` hierarchy child and returns its held identity and `created` status.
- `closeDirectory`: closes a descriptor returned by a create or ensure operation.
- `renameNoReplace`: verifies the old child against expected `dev`/`ino`, performs `renameat2(RENAME_NOREPLACE)`, and verifies the new child against the same identity in one synchronous native call. It returns `OK` when both rename and the native post-check succeed, or `COMMITTED_UNVERIFIED` when rename succeeded but the post-check did not; only pre-commit failures return an error status.
- `renameExchange`: verifies source and target children against their expected `dev`/`ino`, performs `renameat2(RENAME_EXCHANGE)` through their held parent descriptors, then verifies that the two identities changed sides. It returns `OK` when both post-checks succeed, or `COMMITTED_UNVERIFIED` when the exchange succeeded but either post-check did not; only pre-commit failures return an error status. Both parents must resolve on the same filesystem because Linux does not permit cross-filesystem exchange.

The TypeScript loader opens the mode-`0500` addon with `O_NOFOLLOW`, loads the held object through `/proc/self/fd` with `process.dlopen`, verifies stable identity, and closes the descriptor.

## Threat Boundary

The local service/build account is trusted. Hostile same-UID namespace mutation and `ptrace` are out of scope. The synchronous native checks close in-process hooks and cooperating-writer races within that boundary; they do not claim protection against a hostile same-UID process.

There is no JavaScript, copy, ordinary rename, cross-device, child-process, or non-native runtime fallback. Filesystems that do not support `RENAME_NOREPLACE` or `RENAME_EXCHANGE`, including observed WSL DrvFS cases returning `EINVAL`, fail closed and may retain a private mode-`0700` orphan for inspection.
