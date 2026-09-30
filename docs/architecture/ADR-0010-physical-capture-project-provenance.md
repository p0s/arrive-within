# ADR-0010: Keep physical capture project provenance beside the build receipt

**Status:** Accepted
**Date:** 2026-09-26

## Context

Physical marketing captures need proof of the generated Xcode project used to build the installed app. The shared verification runner validates a strict build-receipt schema and permits exactly the app `Info.plist` plus source-commit key under `source_provenance`. Adding the generated-project digest there caused receipt validation to stop before device acquisition.

## Decision

Keep the runner's build receipt unchanged. The physical build adapter writes a separate project-binding JSON sidecar in the same private run directory. It binds the signed source commit, capture-source revision and manifest hash, exact build-receipt hash, XcodeGen version, project-spec hash, and generated-project-tree hash. The adapter emits the sidecar path and hash in its step output, which the runner retains. The app-owned ingester accepts regular files only below the host temporary directory or the shared runner's dedicated private temporary directory, rejects symlinks, and checks the sidecar against the receipt, signed source, manifest, and current generated project before it copies any screenshot. The public physical-evidence manifest and each physical capture record retain the sidecar hash and project hashes.

## Consequences

The capture evidence keeps both the shared runner's strict receipt compatibility and a verifiable generated-project binding. Raw build receipts and fixture reports remain in the private run directory; only validated hashes and project metadata enter the repository. No runtime app behavior changes.
