# Basic60 private-trial review

`BASIC60-PRIVATE-R1` covers only the 60-country identity profiles, 2020-2024 macro
records, and the collected energy records. It is isolated from `synthetic_demo` and does
not complete formal D1-D4, P0, production, or public release.

`PBD-BASIC60-PRIVATE-001-A2` replaces the former private-trial D1-D4 human workflow with
one frozen Excel workbook and one decision by project approver `kevin`. The amendment
approved the process only; the later evidence
`data/basic60/evidence/basic60_excel_review_approval.2026-08-26.json` records `kevin`'s
separate approval of the actual workbook and canonical payload. The validated current
private-trial status is `private_trial_ready`; formal D1-D4, P0, and production remain
`pending`.

## One-review workflow

1. Run `navigator-data prepare-basic60-private` to rebuild the raw manifest, candidate
   seed, source binding, counts, and replayable parse/standardize/entity artifacts.
2. Generate the complete review workbook at
   `outputs/basic60/BASIC60-PRIVATE-R1_60国基础数据集中审核.xlsx`. It must show all
   Basic60 data and source information and contain the required `机器核对` metadata.
3. Bind the workbook into a new, non-overwriting review packet:

   ```bash
   navigator-data prepare-basic60-review \
     --input-bundle data/basic60/review/basic60_private_acceptance.json \
     --workbook outputs/basic60/BASIC60-PRIVATE-R1_60国基础数据集中审核.xlsx \
     --output data/basic60/review/basic60_private_excel_review.pending.json
   ```

4. Before approval, validation must return `not_ready` with the sole human blocker
   `B60_EXCEL_REVIEW_APPROVAL_PENDING`.
5. After reviewing the actual workbook, `kevin` may create one approval evidence file
   under `data/basic60/evidence`. The decision must bind both the workbook SHA-256 and
   `canonical_payload_sha256`, use a timezone-aware approval time, and authorize only
   `private_trial_ready`.
6. Add that evidence file and hash to `single_excel_review.approval`, then run:

   ```bash
   navigator-data validate-basic60-private \
     --bundle data/basic60/review/basic60_private_excel_review.pending.json \
     --output runtime/basic60/basic60_private_validation.json
   ```

Workbook or payload drift invalidates the approval. An updated value, source, or workbook
therefore requires regeneration and a new review of the new exact hashes. An edited status
cell inside the workbook is not approval by itself.

## What this removes

The private-trial path no longer requires separate D1, D2, D3, and D4 meetings; three
separate batch sign-offs; a fixed 180-observation sample; two independent reviewers; or
five sequential role signatures. Those formal-gate contracts remain unchanged and
`pending`; they are simply not prerequisites for `basic60_private`.

## Retained machine controls

The simplified human gate does not remove deterministic counts and hashes, source-binding
completeness, D3 replayability, private-environment isolation, source revocation, or the
disabled V1 AI runtime. The expected frozen counts remain 60 country profiles, 300 macro
rows, 60 energy rows, 2,279 available observations, and 61 explicit pending observations.
Of those pending observations, all 60 electricity-demand values are not required for R1 and
are non-blocking. They remain explicitly pending and are never converted to zero; the frozen
total of 61 pending observations is unchanged.

Raw inputs stay read-only. Real source objects remain outside Git in the protected,
content-addressed L0 volume. Routine manual updates rebuild the candidate, workbook,
canonical payload, and approval binding; a failed run never advances an active release.

## Source visibility and approved use

Source details are visible in the review workbook and retained in backend audit data, but
ordinary country list, detail, and comparison UI/API responses do not expose them. Source
rows carry no separate machine permission state.

After the exact workbook approval, every normalized Basic60 field may be used for private
display, internal learning and AI, local models, and controlled external-model processing.
V1 still deploys no AI, RAG, vector, full-text, embedding, reranker, or model-service
component. Public release, formal production, and model training are not authorized by this
private-trial approval.

The only private-trial outcomes are `private_trial_ready`, `not_ready`, and `revoked`.
Formal D1-D4 and P0 always remain `pending` in this path.

## Current approved evidence

- Workbook SHA-256:
  `163a48df8772f5d8a5fc2638240d9f117fec5d0fbb439246319b4fd881e44dd8`
- Canonical data/source payload SHA-256:
  `087f355987d160f828aa70f92eda82b26b2b68bb4f9a673761c18b85ca18b657`
- Approval evidence SHA-256:
  `29a4c5a2dcc1bbdd9c16e4fd5581473b38f663238f3f24882b3894b01e963188`
- Approved review bundle SHA-256:
  `663851956a197452e07aef7cf9227ba3b04ed06aecc5c883061ed406daa1cacc`
- Validation report SHA-256 (`private_trial_ready`, `checks=[]`):
  `2e440751c7cfa005833ebc5fd616432eb13df267022541ae5e9839ecabb1f291`
- Ready seed SHA-256:
  `5d6295455c377ac2af35986b4e56f940300da04beb3b9630547f18c8d8b557d2`
- Release authorization SHA-256:
  `1df6f06a277a3eb81186549652ced06823c6195d25b63095c19122fb7b3023e3`
- Runtime attestation SHA-256:
  `5e005798d178323c18bf929761c6f449bdc1a623750fbc4aa9a225539515ed2a`
