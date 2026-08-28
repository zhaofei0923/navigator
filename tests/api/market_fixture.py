"""Entirely synthetic market-content fixtures, never an approval of real content.

Tests stub the workbook boundary with literal synthetic bytes and worksheet rows;
they do not author review XLSX files with a second spreadsheet library.
"""

from __future__ import annotations

import copy
import hashlib
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import pytest
from navigator_api.market_schemas import BUSINESSES, SECTION_IDS, TECHNOLOGIES
from navigator_api.market_storage import canonical_bytes, content_sha256, load_market_state
from navigator_data_readiness import market_content as lifecycle


def legacy_content(code: str = "IDN", revision: int = 1) -> dict[str, Any]:
    """Retired schema fixture, used only to exercise immutable archive compatibility."""
    locales: dict[str, Any] = {}
    for locale in ("zh-CN", "en"):
        text = (
            "合成测试文本(非真实市场分析)"
            if locale == "zh-CN"
            else "Synthetic test text, not market advice"
        )
        locales[locale] = {
            "analysis": {
                "summary": dict.fromkeys(
                    ("market_character", "opportunity", "barrier", "next_action"), text
                ),
                "sections": [
                    {"id": section, "title": text, "paragraphs": [text, f"{text}\n{code}"]}
                    for section in SECTION_IDS
                ],
                "entry_assessments": [
                    {
                        "business": business,
                        "technology": technology,
                        "level": "insufficient",
                        "rationale": text,
                        "path": text,
                        "verified_on": "2026-08-27",
                    }
                    for business in BUSINESSES
                    for technology in TECHNOLOGIES
                ],
                "risks": [
                    {
                        "id": "synthetic_risk",
                        "title": text,
                        "level": "insufficient",
                        "businesses": ["epc", "equipment_export"],
                        "technologies": ["storage"],
                        "rationale": text,
                        "mitigation": text,
                        "verified_on": "2026-08-27",
                    }
                ],
                "gaps": [text],
                "disclaimer": text,
            },
            "report": {
                "title": text,
                "introduction": text,
                "chapters": [
                    {
                        "id": "synthetic_chapter",
                        "title": text,
                        "paragraphs": [text, f"{text}\nrevision {revision}"],
                        "actions": [text],
                    }
                ],
                "disclaimer": text,
            },
        }
    return {
        "schema_version": "navigator.market-content.v1",
        "country_code": code,
        "content_version": f"MARKET-{code}-20260827-R{revision}",
        "as_of": "2026-08-27",
        "locales": locales,
    }


_SYNTHETIC_ZH_PARAGRAPHS = [
    (
        "这是一份专门用于自动化测试的虚构国家概况，文中没有真实市场结论，也不代表任何国家的政策或投资条件。"
        "测试页面需要把标题、连续正文和免责声明作为一个整体展示，而不是重新拼接成多张评级卡片。"
        "国家代码只用于验证路由与内容版本的绑定关系；改变测试代码不应改变正文的性质。"
        "阅读者可以通过这段文字了解样本的用途，并确认页面没有把测试材料解释为专业意见。"
        "本段同时包含中文标点、数字2024以及换行前后的普通空格，用于验证字符计数、文本保留和中英文切换。"
        "数字只是技术样例，不是统计数据，也不能用于商业判断。"
    ),
    (
        "在这个虚构场景中，数据图表与概况正文是相互独立的页面内容。图表仍然读取原有国家数据接口，"
        "概况则从单独的只读内容目录读取；其中一项请求失败，不应把另一项内容一起隐藏。"
        "测试需要覆盖统计期不同、缺失值、真实零以及负数的展示语义，防止页面为了看起来完整而擅自补值。"
        "正文中的表达只是在说明这些工程约束，并没有根据样例数字推断需求增长、收益率或市场规模。"
        "当资料没有明确支持某个结论时，界面应保留中性说明，而不是自动补出一段看似确定的分析。"
        "这种分离也便于后续核对指标单位与文章版本，避免两个来源的更新时间被错误混为一谈。"
    ),
    (
        "样例资料的组织方式采用连续段落，供测试人员检查阅读顺序和段落间距。每一段都有独立文字，"
        "可以检验编辑后的内容是否正确保留，而不是重复占位符或依赖隐藏的模板拼接。"
        "中文正文的长度需要在约定范围内，空格、制表符和换行不计入字符数，标点与数字则按实际字符保留。"
        "标题和免责声明不应被用来填充正文长度，英文版本也不能因为段落数量不同而错配阅读位置。"
        "以上规则只约束内容结构与传输完整性，不判定某条政策是否合法，也不生成任何优先级或难易评分。"
        "真实文章仍需作者核对资料后撰写，本测试文字不能作为对应国家的实际概况发布使用。"
    ),
    (
        "为了验证人工更新路径，测试会生成一份隔离的候选副本，并为其建立固定的内容行清单。"
        "清单中的原文、国家代码、版本和语言用于确认编辑对象，用户可以修改允许编辑的标题、段落与免责声明。"
        "如果有人删除某一行、重复某一行或者把原值改成不同文字，导入过程应拒绝这份不完整的输入。"
        "保留换行和普通空格同样重要，因为审核人可能用它们表达段落内的自然语气或需要核对的句子。"
        "导入只产生新的候选文件，不会自动生成批准记录，也不会把内容放进当前可见的发布目录。"
        "这一边界需要由测试直接证明，不能仅凭界面出现成功提示就认定内容已经获得使用授权。"
    ),
    (
        "版本管理测试关注同一国家的文章能否独立更新。新的概况采用单独的版本前缀，历史分析和报告保持原样归档，"
        "不能因为旧文件存在就把旧正文作为新接口的备用结果返回。对于同一版本，内容哈希和审核文件的绑定不能被覆盖。"
        "一次批量更新只有在所有候选对象都完成机器校验后，才允许切换一个共同的活动指针。"
        "如果更新中途发生文件错误，原来的可见版本必须保持不变，已经写入的历史对象也不能被删除。"
        "这些描述仅用于构造可靠的工程场景，没有对任何真实国家的产业条件作比较，"
        "也没有替实际审核人确认文字的准确性或可用性，测试环境中的记录均为合成样例。"
    ),
    (
        "撤销与回滚是另外两类需要分别验证的操作。撤销以后，即使活动指针被恢复成较早的内容，"
        "撤销标记仍然应阻止接口返回相应正文，不能依赖过期缓存继续展示。回滚只能选择曾经正常发布过的概况版本，"
        "不能选择一次失败写入留下的孤立对象，也不能选择已经退役的双内容结构。"
        "国家代码不匹配、缺少原始确认绑定或对象哈希发生改变时，服务都应该返回统一的不可用状态。"
        "错误响应不应暴露证据文件、内部路径或审核人的其他信息。"
        "这一组情形用于验证读取边界与历史完整性，并不表示真实发布已经发生，更不构成对真实材料的人工批准。"
    ),
    (
        "最后，阅读体验的测试需要涵盖桌面、手机和键盘操作。在内容尚未加载时，页面应显示明确的等待状态；"
        "请求失败后可以重试，但不能使用合成文字替换真实结果。中英文切换应保留国家上下文，"
        "回到地图或进入其他工具也不应丢失用户原先选择的国家。无效代码和不属于出海目标的对象不能进入详情。"
        "所有这些要求都可以通过隔离的测试接口和合成文件进行验证，无需触碰生产数据库或真实发布目录。"
        "本段再次说明整篇文字的测试用途，防止它在截图、日志或演示中被误认为正式市场研究。"
        "实际文章应以独立作者稿件和用户确认的审核文件为准，任何测试通过都不能替代这一确认。"
    ),
]


def synthetic_content(code: str = "IDN", revision: int = 1) -> dict[str, Any]:
    """Authored, valid-length synthetic prose; never a real country assessment."""
    return {
        "schema_version": "navigator.market-overview.v1",
        "country_code": code,
        "content_version": f"OVERVIEW-{code}-20260827-R{revision}",
        "as_of": "2026-08-27",
        "locales": {
            "zh-CN": {
                "title": f"合成测试国家概况 {code} R{revision}",
                "paragraphs": list(_SYNTHETIC_ZH_PARAGRAPHS),
                "disclaimer": "仅供自动化测试，不是国家市场分析，不可用于商业决策。",
            },
            "en": {
                "title": f"Synthetic country overview {code} R{revision}",
                "paragraphs": [
                    "This authored fixture is synthetic test prose, "
                    "not a country assessment or market advice.",
                    "Charts and overview prose use independent read-only endpoints. "
                    "Missing data stays missing.",
                    "Paragraph ordering, Unicode counting and bilingual paragraph counts "
                    "are tested explicitly.",
                    "An editable review creates a separate candidate "
                    "and does not create a real human approval.",
                    "Immutable overview versions do not fall back "
                    "to retired analysis or report content.",
                    "Revocation remains effective after a pointer rewind; "
                    "only previously published overviews can return.",
                    "Desktop, mobile, keyboard, locale and unavailable states "
                    "are test scenarios, not real findings.",
                ],
                "disclaimer": "Synthetic testing only; not country analysis or commercial advice.",
            },
        },
    }


def write_legacy_published(root: Path, code: str = "IDN") -> str:
    """Build an isolated synthetic historical store without authorizing any real content."""
    content = legacy_content(code)
    version = content["content_version"]
    batch = {
        "schema_version": lifecycle.CANDIDATE_SCHEMA,
        "package_id": "SYNTHETIC-ARCHIVE",
        "countries": [content],
    }
    batch_hash = content_sha256(batch)
    workbook = b"SYNTHETIC ARCHIVED WORKBOOK ONLY"
    workbook_hash = hashlib.sha256(workbook).hexdigest()
    confirmation = {
        "schema_version": lifecycle.CONFIRMATION_SCHEMA,
        "package_id": "SYNTHETIC-ARCHIVE",
        "decision": "approved",
        "approved_by": "kevin",
        "approved_at": "2026-08-27T02:00:00+00:00",
        "candidate_sha256": batch_hash,
        "workbook_sha256": workbook_hash,
    }
    confirmation_hash = content_sha256(confirmation)
    object_hash = content_sha256(content)
    release = {
        "schema_version": "navigator.market-release.v1",
        "country_code": code,
        "content_version": version,
        "object_sha256": object_hash,
        "confirmation_sha256": confirmation_hash,
        "candidate_sha256": batch_hash,
        "workbook_sha256": workbook_hash,
        "package_id": "SYNTHETIC-ARCHIVE",
        "published_at": "2026-08-27T02:01:00+00:00",
    }
    for path, value in (
        (root / "objects" / f"{object_hash}.json", content),
        (root / "batches" / f"{batch_hash}.json", batch),
        (root / "confirmations" / f"{confirmation_hash}.json", confirmation),
        (root / "releases" / f"{version}.json", release),
    ):
        lifecycle._immutable_bytes(path, canonical_bytes(value))
    lifecycle._immutable_bytes(root / "reviews" / f"{workbook_hash}.xlsx", workbook)
    state, previous = load_market_state(root)
    state["active"][code] = version
    lifecycle._write_state(root, state, previous, {"action": "synthetic_archive_fixture"})
    return str(version)


def write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False), encoding="utf-8")


def candidate_files(
    path: Path, codes: tuple[str, ...] = ("IDN", "ZAF"), revision: int = 1
) -> tuple[Path, Path]:
    write_json(
        path / "package.json",
        {
            "schema_version": lifecycle.CANDIDATE_SCHEMA,
            "package_id": f"SYNTHETIC-MARKET-R{revision}",
        },
    )
    for code in codes:
        write_json(path / "countries" / f"{code}.json", synthetic_content(code, revision))
    profiles = path.parent / "synthetic-profiles.csv"
    profiles.write_text("iso3\nIDN\nZAF\nCHN\n", encoding="utf-8")
    return path, profiles


def review_metadata(candidate: lifecycle.MarketCandidate) -> dict[str, object]:
    return {
        "schema_version": lifecycle.REVIEW_SCHEMA,
        "package_id": candidate.package_id,
        "candidate_sha256": candidate.sha256,
        "country_count": len(candidate.countries),
        "created_at": "2026-08-27T09:00:00+08:00",
    }


@dataclass
class SyntheticReview:
    candidate_dir: Path
    workbook_path: Path
    confirmation_path: Path
    profiles_path: Path
    repo_root: Path
    source_dir: Path
    candidate: lifecycle.MarketCandidate
    rows: list[list[object]]
    metadata: dict[str, object]

    def publish(self, root: Path) -> dict[str, Any]:
        return lifecycle.publish_market_content(
            candidate_dir=self.candidate_dir,
            workbook_path=self.workbook_path,
            confirmation_path=self.confirmation_path,
            profiles_path=self.profiles_path,
            content_root=root,
            repo_root=self.repo_root,
        )


def reviewed_fixture(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    *,
    revision: int = 1,
    codes: tuple[str, ...] = ("IDN", "ZAF"),
    edits: dict[str, str] | None = None,
) -> SyntheticReview:
    source, profiles = candidate_files(tmp_path / f"candidate-r{revision}", codes, revision)
    candidate = lifecycle.load_market_candidate(source, profiles)
    metadata = review_metadata(candidate)
    rows: list[list[object]] = [list(row) for row in lifecycle.market_review_rows(candidate)]
    for row in rows:
        if edits and row[3] in edits:
            row[5] = edits[str(row[3])]
    workbook = tmp_path / f"synthetic-r{revision}.xlsx"
    workbook.write_bytes(f"SYNTHETIC WORKBOOK BOUNDARY TEST ONLY {candidate.sha256}".encode())
    workbook_hash = hashlib.sha256(workbook.read_bytes()).hexdigest()
    monkeypatch.setattr(lifecycle, "_workbook_bytes", lambda path: path.read_bytes())
    monkeypatch.setattr(
        lifecycle, "_read_workbook", lambda _: (copy.deepcopy(metadata), copy.deepcopy(rows))
    )
    imported = tmp_path / f"import-r{revision}"
    result = lifecycle.import_market_review(
        candidate_dir=source,
        workbook_path=workbook,
        output_dir=imported,
        profiles_path=profiles,
        repo_root=tmp_path / "repository",
    )
    confirmation = tmp_path / f"synthetic-confirmation-r{revision}.json"
    # Deliberately synthetic fixture, only within pytest tmp_path. This is not a real signature.
    write_json(
        confirmation,
        {
            "schema_version": lifecycle.CONFIRMATION_SCHEMA,
            "package_id": candidate.package_id,
            "decision": "approved",
            "approved_by": "kevin",
            "approved_at": "2026-08-27T10:00:00+08:00",
            "workbook_sha256": workbook_hash,
            "candidate_sha256": result["candidate_sha256"],
        },
    )
    return SyntheticReview(
        imported,
        workbook,
        confirmation,
        profiles,
        tmp_path / "repository",
        source,
        candidate,
        rows,
        metadata,
    )
