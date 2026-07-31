# D0 Human Review Decision Record - 2026-07-31

## Record status

- Reviewer display name: `kevin`
- Review date: `2026-07-31`
- Recorded at: `2026-07-31T12:16:57+08:00`
- Recording basis: explicit written decisions supplied by `kevin` in the project review conversation
- Repository recording authorization: granted
- Scope: role assignments, mapping decisions, three candidate artifact reviews, and approval to select an official Saudi Principal Buyer source for `RAW-EXAMPLE-003`

This file is an authorized transcription of written review decisions. It is not a
qualified electronic signature and does not convert unresolved sample or stage
decisions into approvals.

## Role assignments

`kevin` confirmed that they represent all nine D0 roles. Every role has `peter`
as alternate and `bob` as escalation person.

| Role | Role holder | Alternate | Escalation |
| --- | --- | --- | --- |
| 项目批准人 | kevin | peter | bob |
| 数据负责人 | kevin | peter | bob |
| 产品负责人 | kevin | peter | bob |
| 数据质量负责人 | kevin | peter | bob |
| 数据工程负责人 | kevin | peter | bob |
| 国家研究负责人 | kevin | peter | bob |
| 语言审校负责人 | kevin | peter | bob |
| 合规负责人 | kevin | peter | bob |
| 后端/数据架构负责人 | kevin | peter | bob |

Evidence ID: `EVD-D0-ROLE-ASSIGNMENTS-20260731`

## Mapping decisions

All six mapping decisions below were approved.

| Mapping ID | Decision | Final target | Approved requirement |
| --- | --- | --- | --- |
| `MAP-ISO3` | `replace_target` | `country.iso_code` | Replace the obsolete `country.iso3` target. |
| `MAP-COUNTRY-NAME` | `model_entity` | `localized_text` | Model localized country names instead of adding `country.name_zh`. |
| `MAP-POLICY-DATE` | `add_field` | `policy_version.published_at` | Keep publication date separate from effective date. |
| `MAP-PROJECT-CAP` | `add_field` | `project_version.capacity_value` | Also retain original value, unit, AC/DC side, and source precision. |
| `MAP-AMOUNT` | `add_field` | `tender.budget_original_value` | Also retain currency, range, exchange-rate source, and exchange-rate base date. |
| `MAP-ENTITY` | `model_entity` | `legal_entity_name` | Model legal names as versioned legal-entity names. |

Evidence ID: `EVD-D0-MAPPING-DECISIONS-20260731`

## Candidate artifact reviews

The reviewer approved all three candidate artifacts with the comment `同意`.
Because `kevin` represents all nine roles, the approval covers every required
review role listed for each artifact.

| Artifact | Decision | Comment | Evidence ID |
| --- | --- | --- | --- |
| `conventions.json` | `approved` | 同意 | `EVD-D0-CONVENTIONS-APPROVAL-20260731` |
| `file_rules.json` | `approved` | 同意 | `EVD-D0-FILE-RULES-APPROVAL-20260731` |
| `terminology_review_queue.json` | `approved` | 同意 | `EVD-D0-TERMINOLOGY-APPROVAL-20260731` |

## RAW-EXAMPLE-003 official source selection

The reviewer authorized selection of a Saudi official source URL. The selected
source matches `SRC-SAU-PB` and the project-announcement sample purpose:

- Publication page: <https://www.pb.com.sa/media-center/news/qualified-developers-for-round-7-solar-pv-and-wind-ipp-projects-2/>
- Official PDF: <https://www.pb.com.sa/media/xjhdaccp/251124-pb-%D9%82%D8%A7%D8%A6%D9%85%D8%A9-%D8%A7%D9%84%D8%B4%D8%B1%D9%83%D8%A7%D8%AA-%D9%84%D9%84%D9%85%D8%B1%D8%AD%D9%84%D8%A9-%D8%A7%D9%84%D8%B3%D8%A7%D8%A8%D8%B9%D8%A9-en-_pdf.pdf>
- Capture record: `D0-CAPTURE-SAU-PB-ROUND7-QUALIFIED-DEVELOPERS-2025`
- PDF SHA-256: `fa2ef7886adce70c393c64d7f6b8021ee1bfac9c8b1381f4893c861b0c72b7d5`

The source-selection approval does not determine the license, redistribution,
AI-indexing, or professional-review outcome.

## Decisions still pending

The following choices were not supplied and remain pending:

- `RAW-EXAMPLE-001`: license decision, redistribution, AI indexing, and professional review;
- `RAW-EXAMPLE-002`: license decision, redistribution, AI indexing, and professional review;
- `RAW-EXAMPLE-003`: license decision, redistribution, AI indexing, and professional review;
- `D0-AC-001` through `D0-AC-010`: acceptance-item decisions;
- final D0 stage approval.

No pending choice is inferred from this record.
