# P1-6D Basic Offline Dry Run Design

**Status:** Approved task decision.

## Goal

Provide a deterministic, offline-only orchestration boundary for P1-6A/B/C that proves a normal Basic collection path can assemble a reviewable audit package while missing, conflict and untrusted material fail closed before model invocation. It must not become a collection, publishing, import, coverage, or AI feature.

## Context

P1-6A already validates a `BasicCollectionAuditBundle` and permits structurally valid blocked bundles. P1-6B's `runBasicDeterministicSourceAdapters()` creates raw capture as part of its own runtime boundary. P1-6C's `bridgeBasicMarketOverviewDraft()` accepts source/fact snapshots plus an injected `BasicDraftModelPort`. Therefore P1-6D must sit above both as an injected adapter boundary: it can consume their results but must not own their runtime side effects.

Current `@navigator/ai-advisor` exposes only `workspaceName`; this design deliberately does not describe it as a RAG implementation.

## Options Considered

### 1. Directly call P1-6B/C production functions

This would make an apparently short end-to-end path, but the P1-6B runner requires a repo root, transport, adapters and raw-cache capture. It would make the P1-6D API filesystem-capable and impossible to prove pure in memory.

### 2. Add a new fixture-specific pipeline

This would be easy to test, but it would duplicate P1-6B facts and P1-6C draft semantics rather than exercising their actual result shapes. It would drift from the contracts it is intended to verify.

### 3. Inject P1-6B runner and P1-6C bridge ports (chosen)

The normal path receives an injected runner returning the existing `BasicSourceAdapterRunResult` and an injected bridge compatible with `bridgeBasicMarketOverviewDraft()`. Blocked paths receive P1-6A-shaped in-memory material and have no model-capable field. This keeps P1-6D pure while testing the real boundary types and gives fail-closed control flow a type-level shape.

## Architecture

Four small collection modules will be added:

1. `basic-offline-dry-run-contracts.ts`: scenario unions, port/result types, fixed artifact names and negative boundary verdict types.
2. `basic-offline-audit-assembler.ts`: explicit check/risk inputs to a conservative P1-6A review report and frozen bundle.
3. `basic-offline-audit-artifacts.ts`: strict P1-6A validation to the fixed, frozen four-file map.
4. `basic-offline-dry-run.ts`: normal-vs-blocked control flow and boundary verdict only.

The assembler is the only component that derives report fields. It does not infer successful source checks, decide conflict winners, or create a human decision. The artifact module accepts valid blocked bundles because reviewability is distinct from readiness. The orchestrator has no `fs`, `path`, `child_process`, transport or Web imports.

## Data Flow

```text
normal input
  -> injected P1-6B runner -> sourceRegister + extractedFacts
  -> injected P1-6C bridge + injected model -> marketOverviewDraft
  -> assembler + explicit sourceChecks/injectionRisks -> P1-6A bundle
  -> P1-6A validator -> four frozen artifacts + negative boundary verdict

missing/conflict/untrusted material
  -> assembler + P1-6A validator -> four frozen artifacts + blocked verdict
  -> runner / bridge / model: unreachable and skipped
```

The only allowed test filesystem use is serializing returned artifact values into a temporary directory for the existing `loadBasicCollectionAuditBundle()` round trip. Neither production function writes that directory.

## Failure Handling

Unknown, malformed or exceptional input is blocked before a runner or bridge call. Normal dependency failures produce no artifacts and cannot select a fallback draft. Blocked scenarios must be P1-6A structurally valid and carry exactly their scenario blocker; otherwise they are invalid input, not a successful blocked dry run. All failures use stable redacted diagnostics.

The implementation clones untrusted dependency values, validates them, then returns deep-frozen snapshots. This prevents a later mutation of an injected model/runner result from changing a package, and prevents callers from mutating a result into a publishable shape.

## Boundary Verification

The returned negative boundary verdict shows only what P1-6D emitted or attempted. Separate tests provide the stronger repository proof: sentinels cannot enter `buildBasicCountryImportPlan()`, representative `buildCountryDetailResponse()`/route output, coverage validation, or current AI eligibility material. The AI assertion is exactly zero KnowledgeChunks, zero `aiUsable = true`, and `aiEligibleKnowledgeIds: []`; it makes no claim to run a RAG retrieval.

## Test Strategy

Use Vitest with injected ports only. The normal test proves ordered runner then bridge invocation and a ready bundle. Three isolated tests prove each blocked scenario produces four loader-compatible artifacts while runner/bridge/model spies remain uncalled. Artifact tests cover invalid bundles, deep immutability and exact names. Cross-boundary tests use distinct raw/discovery/provider/path/manifest sentinels. No test performs a real fetch, invokes Hermes, builds a llama transport or starts a child process.

## Out of Scope

- Changes to P1-6A schema, Prisma, migrations, canonical seeds, collection manifests or coverage rules.
- Real source collection, raw capture, staging writes, Hermes discovery, llama transport, model invocation infrastructure or publishing.
- AI prompt/retrieval changes, KnowledgeChunk creation, permissions, billing or external dependencies.
