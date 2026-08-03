# D0 AC-001/002人工审核工作表

> 本文件仅把机器建议排版供人工阅读，不是整改副本、签署记录或批准证据。
> 请在对话或独立评审记录中回复决定，不要直接编辑本生成文件。

- 建议文件SHA-256：`16d3927c00cbe97d24a98b68960259456d9a118074299525fb4a2d6cc35f3b69`
- 主键建议：0项
- 单位不适用候选：149项
- 数值语义待审：9项
- 复合字段待审：0项

## A. AC-001主键建议

机器统一建议新增不可变UUID代理主键。自然键候选只作对照，仍须确认其唯一约束。

| # | 实体 | 当前字段编号 | 建议新字段 | 自然键候选 |
|---:|---|---|---|---|

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
| 16 | DATA-D0-PK-001 | country.id | uuid | high |
| 17 | DATA-D0-PK-002 | country_metric_value.id | uuid | high |
| 18 | DATA-D0-PK-003 | enterprise_member.id | uuid | high |
| 19 | DATA-D0-PK-004 | enterprise_profile_version.id | uuid | high |
| 20 | DATA-D0-PK-005 | field_provenance.id | uuid | high |
| 21 | DATA-D0-PK-006 | legal_entity.id | uuid | high |
| 22 | DATA-D0-PK-007 | metric_definition.id | uuid | high |
| 23 | DATA-D0-PK-008 | partner.id | uuid | high |
| 24 | DATA-D0-PK-009 | partner_recommendation.id | uuid | high |
| 25 | DATA-D0-PK-010 | policy.id | uuid | high |
| 26 | DATA-D0-PK-011 | policy_version.id | uuid | high |
| 27 | DATA-D0-PK-012 | project.id | uuid | high |
| 28 | DATA-D0-PK-013 | project_opportunity_assessment.id | uuid | high |
| 29 | DATA-D0-PK-014 | project_version.id | uuid | high |
| 30 | DATA-D0-PK-015 | quality_issue.id | uuid | high |
| 31 | DATA-D0-PK-016 | raw_record.id | uuid | high |
| 32 | DATA-D0-PK-017 | region.id | uuid | high |
| 33 | DATA-D0-PK-018 | report.id | uuid | high |
| 34 | DATA-D0-PK-019 | retrieval_run.id | uuid | high |
| 35 | DATA-D0-PK-020 | review_task.id | uuid | high |
| 36 | DATA-D0-PK-021 | risk.id | uuid | high |
| 37 | DATA-D0-PK-022 | risk_assessment.id | uuid | high |
| 38 | DATA-D0-PK-023 | scoring_adjustment.id | uuid | high |
| 39 | DATA-D0-PK-024 | scoring_model_version.id | uuid | high |
| 40 | DATA-D0-PK-025 | scoring_result.id | uuid | high |
| 41 | DATA-D0-PK-026 | scoring_rule.id | uuid | high |
| 42 | DATA-D0-PK-027 | source_family.id | uuid | high |
| 43 | DATA-D0-PK-028 | source_snapshot.id | uuid | high |
| 44 | DATA-D0-PK-029 | tender.id | uuid | high |
| 45 | DATA-D4-001 | country.coverage_status | enum | high |
| 46 | DATA-D4-002 | data_record_version.id | uuid | high |
| 47 | DATA-D4-003-01 | data_record_version.entity_type | varchar | high |
| 48 | DATA-D4-003-02 | data_record_version.entity_id | uuid | high |
| 49 | DATA-D4-004 | data_record_version.publication_status | enum | high |
| 50 | DATA-D4-005 | data_record_version.quality_status | enum | high |
| 51 | DATA-D4-006 | data_record_version.freshness_status | enum | high |
| 52 | DATA-D4-007 | data_record_version.next_review_at | datetime | high |
| 53 | DATA-D4-008-01 | source_registry.id | uuid | high |
| 54 | DATA-D4-008-02 | source_registry.authority_level | enum | high |
| 55 | DATA-D4-008-03 | source_registry.status | enum | high |
| 56 | DATA-D4-009 | source_registry.usage_basis | text | medium |
| 57 | DATA-D4-010 | source_registry.source_family_id | uuid | high |
| 58 | DATA-D4-011-01 | source_snapshot.source_id | uuid | high |
| 59 | DATA-D4-011-02 | source_snapshot.content_hash | char(64) | high |
| 60 | DATA-D4-011-03 | source_snapshot.object_uri | text | medium |
| 61 | DATA-D4-012-01 | source_snapshot.published_at | datetime | high |
| 62 | DATA-D4-012-02 | source_snapshot.captured_at | datetime | high |
| 63 | DATA-D4-013-01 | raw_record.snapshot_id | uuid | high |
| 64 | DATA-D4-013-02 | raw_record.raw_payload | json | medium |
| 65 | DATA-D4-013-03 | raw_record.parse_status | enum | high |
| 66 | DATA-D4-014-01 | field_provenance.data_record_version_id | uuid | high |
| 67 | DATA-D4-014-02 | field_provenance.raw_record_id | uuid | high |
| 68 | DATA-D4-014-03 | field_provenance.field_path | varchar | high |
| 69 | DATA-D4-015-01 | field_provenance.source_locator | json | medium |
| 70 | DATA-D4-015-02 | field_provenance.transformation_rule_id | varchar | high |
| 71 | DATA-D4-016 | project_opportunity_assessment.context_type | enum | high |
| 72 | DATA-D4-017-01 | project_opportunity_assessment.enterprise_id | uuid | high |
| 73 | DATA-D4-017-02 | project_opportunity_assessment.profile_snapshot_id | uuid | high |
| 74 | DATA-D4-017-03 | project_opportunity_assessment.task_context_id | uuid | high |
| 75 | DATA-D4-018-01 | project_opportunity_assessment.rule_version | varchar | high |
| 76 | DATA-D4-018-02 | project_opportunity_assessment.scoring_result_id | uuid | high |
| 77 | DATA-D4-019-01 | scoring_model_version.model_code | varchar | high |
| 78 | DATA-D4-019-02 | scoring_model_version.version | varchar | high |
| 79 | DATA-D4-019-03 | scoring_model_version.status | enum | high |
| 80 | DATA-D4-020-01 | scoring_rule.model_version_id | uuid | high |
| 81 | DATA-D4-020-02 | scoring_rule.indicator_code | varchar | high |
| 82 | DATA-D4-021-01 | scoring_rule.direction | enum | high |
| 83 | DATA-D4-021-02 | scoring_rule.missing_rule | json | medium |
| 84 | DATA-D4-021-03 | scoring_rule.threshold_gate | json | medium |
| 85 | DATA-D4-022-01 | scoring_run.id | uuid | high |
| 86 | DATA-D4-022-02 | scoring_run.model_version_id | uuid | high |
| 87 | DATA-D4-022-03 | scoring_run.idempotency_key | char(64) | high |
| 88 | DATA-D4-023-01 | scoring_run.input_snapshot | json | medium |
| 89 | DATA-D4-023-02 | scoring_run.data_cutoff_at | datetime | high |
| 90 | DATA-D4-024-01 | scoring_result.status | enum | high |
| 91 | DATA-D4-025-03 | scoring_result.grade_code | varchar | high |
| 92 | DATA-D4-026-01 | scoring_result.recommendation_status | enum | high |
| 93 | DATA-D4-026-02 | scoring_result.gate_hits | json | medium |
| 94 | DATA-D4-026-03 | scoring_result.explanation | json | medium |
| 95 | DATA-D4-027-01 | scoring_adjustment.result_id | uuid | high |
| 96 | DATA-D4-027-02 | scoring_adjustment.adjustment | json | medium |
| 97 | DATA-D4-027-03 | scoring_adjustment.valid_to | datetime | high |
| 98 | DATA-D4-027-04 | scoring_adjustment.approved_by | uuid | high |
| 99 | DATA-D4-028-01 | quality_issue.rule_code | varchar | high |
| 100 | DATA-D4-028-02 | quality_issue.severity | enum | high |
| 101 | DATA-D4-028-03 | quality_issue.status | enum | high |
| 102 | DATA-D4-029 | quality_issue.waiver_expires_at | datetime | high |
| 103 | DATA-D4-030-01 | localized_text.locale | varchar | high |
| 104 | DATA-D4-030-02 | localized_text.translation_status | enum | high |
| 105 | DATA-D4-030-03 | localized_text.source_text_hash | char(64) | high |
| 106 | DATA-ENTERPRISE-001 | enterprise.id | uuid | high |
| 107 | DATA-ENTERPRISE-002 | enterprise.verification_status | enum | high |
| 108 | DATA-LEAD-001 | lead.source_type | enum | high |
| 109 | DATA-LEAD-002 | lead.grade | enum | high |
| 110 | DATA-LEAD-003 | lead.owner_user_id | uuid | high |
| 111 | DATA-PARTNER-001 | partner.review_status | enum | high |
| 112 | DATA-PARTNER-002 | partner.contact_info | json | medium |
| 113 | DATA-PARTNER-003 | partner_recommendation.grade | enum | high |
| 114 | DATA-POLICY-001 | policy.effective_status | enum | high |
| 115 | DATA-POLICY-002 | policy.effective_date | date | high |
| 116 | DATA-POLICY-003 | policy.supersedes_policy_id | uuid | high |
| 117 | DATA-PROFILE-001 | enterprise_profile_version.technology_tags | json | medium |
| 118 | DATA-PROFILE-002 | enterprise_profile_version.target_country_codes | json | medium |
| 119 | DATA-PROFILE-003 | enterprise_profile_version.overseas_stage | enum | high |
| 120 | DATA-PROJECT-001 | project.verification_status | enum | high |
| 121 | DATA-PROJECT-002 | project.stage | enum | high |
| 122 | DATA-PROJECT-004 | project.sensitivity_level | enum | high |
| 123 | DATA-PROJECT-005 | project.business_status | enum | high |
| 124 | DATA-PROJECT-006 | project.opportunity_window | enum | high |
| 125 | DATA-PROJECT-007 | project.opportunity_grade | enum | high |
| 126 | DATA-REPORT-001 | report_task.status | enum | high |
| 127 | DATA-REPORT-002 | report.input_snapshot | json | medium |
| 128 | DATA-REPORT-003 | report.business_status | enum | high |
| 129 | DATA-REQUEST-001 | service_request.status | enum | high |
| 130 | DATA-REVIEW-001 | review_task.status | enum | high |
| 131 | DATA-RISK-001 | risk.risk_level | enum | high |
| 132 | DATA-RISK-002 | risk.impact_scope | json | medium |
| 133 | DATA-RISK-003 | risk.assessment_status | enum | high |
| 134 | DATA-SOURCE-001 | source.source_url | text | medium |
| 135 | DATA-SOURCE-002 | source.authority_level | enum | high |
| 136 | DATA-SOURCE-003 | source.captured_at | datetime | high |
| 137 | DATA-TENDER-001 | tender_document.extraction_status | enum | high |
| 138 | DATA-TENDER-002 | tender_document.source_locator | json | medium |
| 139 | DATA-TENDER-003 | tender.official_status | enum | high |
| 140 | DATA-TENDER-004 | tender.opportunity_window | enum | high |
| 141 | DATA-UI-001 | user_preference.preference_key | varchar | high |
| 142 | DATA-UI-002 | user_preference.preference_value | json | medium |
| 143 | DATA-UI-003 | saved_view.query_state | json | medium |
| 144 | DATA-UI-004 | form_draft.payload_encrypted | json | medium |
| 145 | DATA-UI-005 | product_event.page_id | varchar | high |
| 146 | DATA-UI-006 | product_event.consent_version | varchar | high |
| 147 | DATA-USER-001 | app_user.id | uuid | high |
| 148 | DATA-USER-002 | app_user.status | enum | high |
| 149 | DATA-USER-003 | app_user.mobile_email | varchar | high |

## C. AC-002数值语义待审

请为每项明确单位代码、量纲和单位登记来源；不得仅凭存储类型推断。

| # | 字段编号 | 实体.字段 | 类型 | 待决定内容 |
|---:|---|---|---|---|
| 1 | DATA-D4-003-03 | data_record_version.version_no | integer | unit_code / unit_dimension / unit_registry_reference |
| 2 | DATA-D4-020-03 | scoring_rule.weight | decimal | unit_code / unit_dimension / unit_registry_reference |
| 3 | DATA-D4-024-02 | scoring_result.raw_score | decimal | unit_code / unit_dimension / unit_registry_reference |
| 4 | DATA-D4-024-03 | scoring_result.adjusted_score | decimal | unit_code / unit_dimension / unit_registry_reference |
| 5 | DATA-D4-025-01 | scoring_result.coverage_ratio | decimal | unit_code / unit_dimension / unit_registry_reference |
| 6 | DATA-D4-025-02 | scoring_result.confidence | decimal | unit_code / unit_dimension / unit_registry_reference |
| 7 | DATA-ENTITLEMENT-001 | entitlement.quota_remaining | integer | unit_code / unit_dimension / unit_registry_reference |
| 8 | DATA-LEAD-004 | lead.behavior_score | decimal(5,2) | unit_code / unit_dimension / unit_registry_reference |
| 9 | DATA-PROJECT-003 | project.opportunity_score | decimal(5,2) | unit_code / unit_dimension / unit_registry_reference |

## D. AC-002复合字段待审

以下合同行包含多个子字段。请决定拆分为原子字段，或逐项说明保留复合合同的理由。

| # | 字段编号 | 实体.复合字段 | 复合类型 |
|---:|---|---|---|

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
