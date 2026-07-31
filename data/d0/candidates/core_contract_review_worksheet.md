# D0 AC-001/002人工审核工作表

> 本文件仅把机器建议排版供人工阅读，不是整改副本、签署记录或批准证据。
> 请在对话或独立评审记录中回复决定，不要直接编辑本生成文件。

- 建议文件SHA-256：`4b23dfa65fdfc65b96adae587111aeea2bc20726ec08c2683029d5c7bf567629`
- 主键建议：29项
- 单位不适用候选：69项
- 数值语义待审：3项
- 复合字段待审：20项

## A. AC-001主键建议

机器统一建议新增不可变UUID代理主键。自然键候选只作对照，仍须确认其唯一约束。

| # | 实体 | 当前字段编号 | 建议新字段 | 自然键候选 |
|---:|---|---|---|---|
| 1 | country | DATA-COUNTRY-001, DATA-COUNTRY-002, DATA-COUNTRY-003, DATA-COUNTRY-004, DATA-COUNTRY-005, DATA-COUNTRY-006, DATA-COUNTRY-007, DATA-D4-001 | DATA-D0-PK-001 / id / uuid | DATA-COUNTRY-001 (iso_code) |
| 2 | country_metric_value | - | DATA-D0-PK-002 / id / uuid | - |
| 3 | enterprise_member | - | DATA-D0-PK-003 / id / uuid | - |
| 4 | enterprise_profile_version | DATA-PROFILE-001, DATA-PROFILE-002, DATA-PROFILE-003 | DATA-D0-PK-004 / id / uuid | - |
| 5 | field_provenance | DATA-D4-014, DATA-D4-015 | DATA-D0-PK-005 / id / uuid | - |
| 6 | legal_entity | - | DATA-D0-PK-006 / id / uuid | - |
| 7 | metric_definition | - | DATA-D0-PK-007 / id / uuid | - |
| 8 | partner | DATA-PARTNER-001, DATA-PARTNER-002 | DATA-D0-PK-008 / id / uuid | - |
| 9 | partner_recommendation | DATA-PARTNER-003 | DATA-D0-PK-009 / id / uuid | - |
| 10 | policy | DATA-POLICY-001, DATA-POLICY-002, DATA-POLICY-003 | DATA-D0-PK-010 / id / uuid | - |
| 11 | policy_version | - | DATA-D0-PK-011 / id / uuid | - |
| 12 | project | DATA-PROJECT-001, DATA-PROJECT-002, DATA-PROJECT-003, DATA-PROJECT-004, DATA-PROJECT-005, DATA-PROJECT-006, DATA-PROJECT-007 | DATA-D0-PK-012 / id / uuid | - |
| 13 | project_opportunity_assessment | DATA-D4-016, DATA-D4-017, DATA-D4-018 | DATA-D0-PK-013 / id / uuid | DATA-D4-018 (rule_version/scoring_result_id) |
| 14 | project_version | - | DATA-D0-PK-014 / id / uuid | - |
| 15 | quality_issue | DATA-D4-028, DATA-D4-029 | DATA-D0-PK-015 / id / uuid | - |
| 16 | raw_record | DATA-D4-013 | DATA-D0-PK-016 / id / uuid | - |
| 17 | region | - | DATA-D0-PK-017 / id / uuid | - |
| 18 | report | DATA-REPORT-002, DATA-REPORT-003 | DATA-D0-PK-018 / id / uuid | - |
| 19 | retrieval_run | - | DATA-D0-PK-019 / id / uuid | - |
| 20 | review_task | DATA-REVIEW-001 | DATA-D0-PK-020 / id / uuid | - |
| 21 | risk | DATA-RISK-001, DATA-RISK-002, DATA-RISK-003 | DATA-D0-PK-021 / id / uuid | - |
| 22 | risk_assessment | - | DATA-D0-PK-022 / id / uuid | - |
| 23 | scoring_adjustment | DATA-D4-027 | DATA-D0-PK-023 / id / uuid | - |
| 24 | scoring_model_version | DATA-D4-019 | DATA-D0-PK-024 / id / uuid | DATA-D4-019 (model_code/version/status) |
| 25 | scoring_result | DATA-D4-024, DATA-D4-025, DATA-D4-026 | DATA-D0-PK-025 / id / uuid | - |
| 26 | scoring_rule | DATA-D4-020, DATA-D4-021 | DATA-D0-PK-026 / id / uuid | DATA-D4-020 (model_version_id/indicator_code/weight) |
| 27 | source_family | - | DATA-D0-PK-027 / id / uuid | - |
| 28 | source_snapshot | DATA-D4-011, DATA-D4-012 | DATA-D0-PK-028 / id / uuid | - |
| 29 | tender | DATA-TENDER-003, DATA-TENDER-004 | DATA-D0-PK-029 / id / uuid | - |

## B. AC-002单位不适用候选

以下字段的顶层类型不表达可度量数值；JSON或文本内部数值仍须由子结构合同定义单位。

| # | 字段编号 | 实体.字段 | 类型 | 置信度 |
|---:|---|---|---|---|
| 1 | DATA-AI-001 | ai_conversation.enterprise_id | uuid | high |
| 2 | DATA-AI-002 | ai_message.citation_ids | json | medium |
| 3 | DATA-AI-003 | ai_message.answer_status | enum | high |
| 4 | DATA-AUDIT-001 | audit_log.before_after | json | medium |
| 5 | DATA-CHANNEL-001 | attribution.first_touch | json | medium |
| 6 | DATA-CHANNEL-002 | attribution.last_touch | json | medium |
| 7 | DATA-COUNTRY-001 | country.iso_code | varchar(3) | high |
| 8 | DATA-COUNTRY-002 | country.coverage_level | enum | high |
| 9 | DATA-COUNTRY-003 | country.opportunity_level | enum | high |
| 10 | DATA-COUNTRY-004 | country.risk_level | enum | high |
| 11 | DATA-COUNTRY-005 | country.last_reviewed_at | datetime | high |
| 12 | DATA-COUNTRY-006 | country.policy_friendliness_level | enum | high |
| 13 | DATA-COUNTRY-007 | country.risk_assessment_status | enum | high |
| 14 | DATA-COUNTRY-METRIC-001 | country_metric.metric_code | varchar | high |
| 15 | DATA-COUNTRY-METRIC-002 | country_metric.value_status | enum | high |
| 16 | DATA-D4-001 | country.coverage_status | enum | high |
| 17 | DATA-D4-002 | data_record_version.id | uuid | high |
| 18 | DATA-D4-004 | data_record_version.publication_status | enum | high |
| 19 | DATA-D4-005 | data_record_version.quality_status | enum | high |
| 20 | DATA-D4-006 | data_record_version.freshness_status | enum | high |
| 21 | DATA-D4-007 | data_record_version.next_review_at | datetime | high |
| 22 | DATA-D4-009 | source_registry.usage_basis | text | medium |
| 23 | DATA-D4-010 | source_registry.source_family_id | uuid | high |
| 24 | DATA-D4-016 | project_opportunity_assessment.context_type | enum | high |
| 25 | DATA-D4-029 | quality_issue.waiver_expires_at | datetime | high |
| 26 | DATA-ENTERPRISE-001 | enterprise.id | uuid | high |
| 27 | DATA-ENTERPRISE-002 | enterprise.verification_status | enum | high |
| 28 | DATA-LEAD-001 | lead.source_type | enum | high |
| 29 | DATA-LEAD-002 | lead.grade | enum | high |
| 30 | DATA-LEAD-003 | lead.owner_user_id | uuid | high |
| 31 | DATA-PARTNER-001 | partner.review_status | enum | high |
| 32 | DATA-PARTNER-002 | partner.contact_info | json | medium |
| 33 | DATA-PARTNER-003 | partner_recommendation.grade | enum | high |
| 34 | DATA-POLICY-001 | policy.effective_status | enum | high |
| 35 | DATA-POLICY-002 | policy.effective_date | date | high |
| 36 | DATA-POLICY-003 | policy.supersedes_policy_id | uuid | high |
| 37 | DATA-PROFILE-001 | enterprise_profile_version.technology_tags | json | medium |
| 38 | DATA-PROFILE-002 | enterprise_profile_version.target_country_codes | json | medium |
| 39 | DATA-PROFILE-003 | enterprise_profile_version.overseas_stage | enum | high |
| 40 | DATA-PROJECT-001 | project.verification_status | enum | high |
| 41 | DATA-PROJECT-002 | project.stage | enum | high |
| 42 | DATA-PROJECT-004 | project.sensitivity_level | enum | high |
| 43 | DATA-PROJECT-005 | project.business_status | enum | high |
| 44 | DATA-PROJECT-006 | project.opportunity_window | enum | high |
| 45 | DATA-PROJECT-007 | project.opportunity_grade | enum | high |
| 46 | DATA-REPORT-001 | report_task.status | enum | high |
| 47 | DATA-REPORT-002 | report.input_snapshot | json | medium |
| 48 | DATA-REPORT-003 | report.business_status | enum | high |
| 49 | DATA-REQUEST-001 | service_request.status | enum | high |
| 50 | DATA-REVIEW-001 | review_task.status | enum | high |
| 51 | DATA-RISK-001 | risk.risk_level | enum | high |
| 52 | DATA-RISK-002 | risk.impact_scope | json | medium |
| 53 | DATA-RISK-003 | risk.assessment_status | enum | high |
| 54 | DATA-SOURCE-001 | source.source_url | text | medium |
| 55 | DATA-SOURCE-002 | source.authority_level | enum | high |
| 56 | DATA-SOURCE-003 | source.captured_at | datetime | high |
| 57 | DATA-TENDER-001 | tender_document.extraction_status | enum | high |
| 58 | DATA-TENDER-002 | tender_document.source_locator | json | medium |
| 59 | DATA-TENDER-003 | tender.official_status | enum | high |
| 60 | DATA-TENDER-004 | tender.opportunity_window | enum | high |
| 61 | DATA-UI-001 | user_preference.preference_key | varchar | high |
| 62 | DATA-UI-002 | user_preference.preference_value | json | medium |
| 63 | DATA-UI-003 | saved_view.query_state | json | medium |
| 64 | DATA-UI-004 | form_draft.payload_encrypted | json | medium |
| 65 | DATA-UI-005 | product_event.page_id | varchar | high |
| 66 | DATA-UI-006 | product_event.consent_version | varchar | high |
| 67 | DATA-USER-001 | app_user.id | uuid | high |
| 68 | DATA-USER-002 | app_user.status | enum | high |
| 69 | DATA-USER-003 | app_user.mobile_email | varchar | high |

## C. AC-002数值语义待审

请为每项明确单位代码、量纲和单位登记来源；不得仅凭存储类型推断。

| # | 字段编号 | 实体.字段 | 类型 | 待决定内容 |
|---:|---|---|---|---|
| 1 | DATA-ENTITLEMENT-001 | entitlement.quota_remaining | integer | unit_code / unit_dimension / unit_registry_reference |
| 2 | DATA-LEAD-004 | lead.behavior_score | decimal(5,2) | unit_code / unit_dimension / unit_registry_reference |
| 3 | DATA-PROJECT-003 | project.opportunity_score | decimal(5,2) | unit_code / unit_dimension / unit_registry_reference |

## D. AC-002复合字段待审

以下合同行包含多个子字段。请决定拆分为原子字段，或逐项说明保留复合合同的理由。

| # | 字段编号 | 实体.复合字段 | 复合类型 |
|---:|---|---|---|
| 1 | DATA-D4-003 | data_record_version.entity_type/entity_id/version_no | varchar/uuid/integer |
| 2 | DATA-D4-008 | source_registry.id/authority_level/status | uuid/enum/enum |
| 3 | DATA-D4-011 | source_snapshot.source_id/content_hash/object_uri | uuid/char(64)/text |
| 4 | DATA-D4-012 | source_snapshot.published_at/captured_at | datetime/datetime |
| 5 | DATA-D4-013 | raw_record.snapshot_id/raw_payload/parse_status | uuid/json/enum |
| 6 | DATA-D4-014 | field_provenance.data_record_version_id/raw_record_id/field_path | uuid/uuid/varchar |
| 7 | DATA-D4-015 | field_provenance.source_locator/transformation_rule_id | json/varchar |
| 8 | DATA-D4-017 | project_opportunity_assessment.enterprise_id/profile_snapshot_id/task_context_id | uuid/uuid/uuid |
| 9 | DATA-D4-018 | project_opportunity_assessment.rule_version/scoring_result_id | varchar/uuid |
| 10 | DATA-D4-019 | scoring_model_version.model_code/version/status | varchar/varchar/enum |
| 11 | DATA-D4-020 | scoring_rule.model_version_id/indicator_code/weight | uuid/varchar/decimal |
| 12 | DATA-D4-021 | scoring_rule.direction/missing_rule/threshold_gate | enum/json/json |
| 13 | DATA-D4-022 | scoring_run.id/model_version_id/idempotency_key | uuid/uuid/char(64) |
| 14 | DATA-D4-023 | scoring_run.input_snapshot/data_cutoff_at | json/datetime |
| 15 | DATA-D4-024 | scoring_result.status/raw_score/adjusted_score | enum/decimal/decimal |
| 16 | DATA-D4-025 | scoring_result.coverage_ratio/confidence/grade_code | decimal/decimal/varchar |
| 17 | DATA-D4-026 | scoring_result.recommendation_status/gate_hits/explanation | enum/json/json |
| 18 | DATA-D4-027 | scoring_adjustment.result_id/adjustment/valid_to/approved_by | uuid/json/datetime/uuid |
| 19 | DATA-D4-028 | quality_issue.rule_code/severity/status | varchar/enum/enum |
| 20 | DATA-D4-030 | localized_text.locale/translation_status/source_text_hash | varchar/enum/char(64) |

## 建议回复格式

```text
AC-001主键：同意全部29项 / 例外：<实体及决定>
AC-002非度量字段：同意69项全部标记不适用 / 例外：<字段及决定>
DATA-ENTITLEMENT-001：unit_code=<...>；unit_dimension=<...>；registry=<...>
DATA-LEAD-004：unit_code=<...>；unit_dimension=<...>；registry=<...>
DATA-PROJECT-003：unit_code=<...>；unit_dimension=<...>；registry=<...>
AC-002复合字段：全部拆分 / 保留例外：<字段编号及理由>
```

人工决定形成后，须填写独立的core_contract_resolution整改副本，并补齐实名、
时间、变更单和证据；本工作表本身不得提交给正式校验器。
