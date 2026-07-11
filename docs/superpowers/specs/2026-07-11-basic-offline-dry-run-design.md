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

Five small collection modules will be added:

1. `basic-offline-dry-run-contracts.ts`: scenario unions, port/result types, fixed artifact names and negative boundary verdict types.
2. `basic-offline-source-preflight.ts`: model-free validation of runner source/fact snapshots plus explicit checks/risks.
3. `basic-offline-audit-assembler.ts`: explicit check/risk inputs to a conservative P1-6A review report and frozen bundle.
4. `basic-offline-audit-artifacts.ts`: strict P1-6A validation to the fixed, frozen four-file map.
5. `basic-offline-dry-run.ts`: normal-vs-blocked control flow and boundary verdict only.

Preflight validates source/fact structure, identities, required paths, references and source trust blockers without constructing or reading a model draft. It does not infer successful source checks. The assembler is the only component that derives report fields；it does not decide conflict winners or create a human decision. The artifact module accepts valid blocked bundles because reviewability is distinct from readiness. The orchestrator has no `fs`, `path`, `child_process`, transport or Web imports.

## Data Flow

```text
normal input
  -> injected P1-6B runner -> sourceRegister + extractedFacts
  -> model-free preflight(sourceRegister, extractedFacts, explicit checks/risks)
     -> any missing/conflict/untrusted/source risk: stop before bridge/model
  -> injected P1-6C bridge + injected model -> marketOverviewDraft
  -> assembler + explicit sourceChecks/injectionRisks -> P1-6A bundle
  -> P1-6A validator -> four frozen artifacts + negative boundary verdict

missing/conflict/untrusted material
  -> exact own-key guard; runner/bridge/model keys are rejected
  -> model-free preflight -> expected blocker
  -> assembler + P1-6A validator -> four frozen artifacts + blocked verdict
  -> runner / draft-bridge stages: skipped
```

The only allowed test filesystem use is serializing returned artifact values into a temporary directory for the existing `loadBasicCollectionAuditBundle()` round trip. Neither production function writes that directory.

## Failure Handling

Unknown, malformed or exceptional input is blocked before a runner or bridge call. After the normal runner returns, preflight must stop any failed source check、injection risk、discovery-only/unverified/restricted/unknown source、untrusted/conflict/missing fact or other blocker before bridge/model. It must also inspect the unique `marketOverview.credibility` candidate fact and treat `normalizedValue === "UNVERIFIED"` as `UNTRUSTED_INPUT` even when source metadata is safe, source checks pass and no injection risk exists. Existing duplicate-path, duplicate-ID, conflicting normalized evidence and conflict-evidence validation semantics remain unchanged. This is not circular: draft grounding remains a later bridge/final-validation concern, while source safety is decided from source/fact snapshots and explicit checks/risks. Normal dependency failures produce no artifacts and cannot select a fallback draft. Blocked scenarios must be P1-6A structurally valid and carry exactly their scenario blocker；extra runner/bridge/model own keys are invalid input. All failures use stable redacted diagnostics.

The implementation clones untrusted dependency values, validates them, then returns recursively frozen snapshots. Documented `Readonly` types are only a shallow static surface；runtime deep freeze and nested mutation tests provide the deep immutability guarantee. This prevents a later mutation of an injected model/runner result from changing a package, and prevents callers from mutating a result into a publishable shape.

## Boundary Verification

The returned boundary verdict is fixed negative-only attestation, not artifact content or a consumable AI eligibility payload. DB tests prove artifact/import/coverage/AI boundaries and statically forbid Web/canonical/coverage/AI imports from P1-6D production modules. Web tests independently prove the country service and route consume the canonical seed registry, import no P1-6D API and expose no P1-6D fields. DB tests never import Web code, and neither package invents a sentinel injection seam. The AI assertion is exactly zero KnowledgeChunks, zero `aiUsable = true`, and `aiEligibleKnowledgeIds: []`; it makes no claim to run a RAG retrieval.

## Test Strategy

Use Vitest with injected ports only. Normal tests prove runner → preflight → bridge ordering and prove every preflight blocker leaves bridge/model uncalled. Blocked union tests use compile-time `@ts-expect-error` assertions, runtime exact-own-key rejection and skipped stages；they do not use disconnected spies. Artifact tests cover invalid bundles, recursive immutability and exact names. DB and Web boundary regressions run in their own packages with static architecture scans. No test performs a real fetch, invokes Hermes, builds a llama transport or starts a child process.

## Out of Scope

- Changes to P1-6A schema, Prisma, migrations, canonical seeds, collection manifests or coverage rules.
- Real source collection, raw capture, staging writes, Hermes discovery, llama transport, model invocation infrastructure or publishing.
- AI prompt/retrieval changes, KnowledgeChunk creation, permissions, billing or external dependencies.
