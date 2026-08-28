"""Bind the independently authored Zambia article to its collected fact anchors.

This script packages evidence only. It never writes, pads or translates prose,
approves content, or changes a published package.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any

from navigator_api.market_schemas import CountryMarketOverview

PARAGRAPH_BINDINGS = [
    (
        ["ZMB-F01", "ZMB-F02"],
        "从水电水文约束和矿业实际负荷推导可靠供电的商业价值，不将装机等同可交付电量。",
    ),
    (
        ["ZMB-F02", "ZMB-F05"],
        "区分矿业与工商业负荷的供电诉求，提出光储配置及风电场址研究建议，不承诺统一收益。",
    ),
    (
        ["ZMB-F04", "ZMB-F05", "ZMB-F06"],
        "区分自用价值、余电结算和网络费用，保留净计量容量及许可、储能防孤岛边界。",
    ),
    (
        ["ZMB-F03"],
        "开放接入作为可选业务路径而非无条件售电保证，建议联动购电客户、接入及结算筛选项目。",
    ),
    (
        ["ZMB-F07", "ZMB-F09"],
        "优惠资格与设立、土地和环境办理分开，不虚构外资最低设立资本、普遍合资要求或法定办理期限。",
    ),
    (
        ["ZMB-F08", "ZMB-F05", "ZMB-F06"],
        "设备分类和条件优惠影响到岸成本；以系统交付而不是单品报价提出建议，草案不表述为强制标准。",
    ),
    (
        ["ZMB-F10", "ZMB-F02", "ZMB-F03", "ZMB-F07"],
        "区分境内付款、外币计价、跨境交易和利润汇出，以客户信用、接入和币种匹配限定进入建议。",
    ),
]


def prepare(repo: Path, policy_path: Path, overview_path: Path, output: Path) -> None:
    policy_path = policy_path.resolve()
    overview_path = overview_path.resolve()
    output = output.resolve()
    policy_bytes = policy_path.read_bytes()
    policy = json.loads(policy_bytes)
    overview = CountryMarketOverview.model_validate_json(overview_path.read_bytes())
    if (
        policy.get("iso3") != "ZMB"
        or overview.country_code != "ZMB"
        or overview.as_of.isoformat() != policy.get("information_as_of")
        or len(overview.locales["zh-CN"].paragraphs) != len(PARAGRAPH_BINDINGS)
    ):
        raise ValueError("The authored article structure and collected Zambia facts must match")
    evidence: list[dict[str, Any]] = []
    facts = []
    source_keys: dict[tuple[str, str], str] = {}
    for fact in policy["facts"]:
        source_ids = []
        for source in fact["evidence"]:
            key = (source["url"], source["locator"])
            evidence_id = source_keys.get(key)
            if evidence_id is None:
                evidence_id = f"ZMB-E{len(evidence) + 1:02d}"
                source_keys[key] = evidence_id
                item = {
                    "id": evidence_id,
                    "title": source["title"],
                    "url": source["url"],
                    "locator": source["locator"],
                    "checked_on": fact["verified_at"],
                    "verification_scope": fact["applicability"],
                }
                local = source.get("local_path")
                if local:
                    path = repo / local
                    if path.is_symlink() or not path.resolve().is_relative_to(
                        repo / "raw material"
                    ):
                        raise ValueError("Evidence must stay in the original raw archive")
                    if hashlib.sha256(path.read_bytes()).hexdigest() != source["sha256"]:
                        raise ValueError("Policy evidence changed after the research handoff")
                    item["local_path"] = local
                    item["local_sha256"] = source["sha256"]
                elif source.get("sha256"):
                    raise ValueError(
                        "An official URL without original bytes cannot have a local hash"
                    )
                evidence.append(item)
            source_ids.append(evidence_id)
        facts.append(
            {
                "id": fact["fact_id"],
                "statement": fact["fact_zh"],
                "commercial_implication": fact["commercial_relevance"],
                "source_ids": source_ids,
            }
        )
    result = {
        "schema_version": "navigator.market-overview-research.v1",
        "country_code": overview.country_code,
        "content_version": overview.content_version,
        "as_of": overview.as_of.isoformat(),
        "research_input": policy_path.relative_to(repo).as_posix(),
        "research_input_sha256": hashlib.sha256(policy_bytes).hexdigest(),
        "evidence": evidence,
        "facts": facts,
        "paragraph_map": [
            {"paragraph": index, "fact_ids": ids, "analysis_note": note}
            for index, (ids, note) in enumerate(PARAGRAPH_BINDINGS, 1)
        ],
        "uncertainties": [
            f"{gap['id']}：{gap['issue']} 处理：{gap['handling']}"
            for gap in policy["known_conflicts_and_gaps"]
        ]
        + [
            "基础图表沿用IRENA年度数据口径：2025总装机4159.57MW。ERB《2025行业报告》总装机4107.86MW为不同报表口径；不互相覆盖，不将差额解读为新增或退役容量。概述仅用两者共同支持的水电主导判断。",
            "基础数据人口采用WDI 2025值、陆地面积采用WDI 2023值；"
            "业务区域Southern Africa与联合国M49统计区域Eastern Africa口径不同。"
            "保留具体字段期间，不统一改成信息截至年份。",
            "用电需求遵循本期不展示的约定继续留空；行业报告中的2025实际用电只用于解释矿业负荷，不回填或替换现有能源指标。",
        ],
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("x", encoding="utf-8", newline="\n") as handle:
        handle.write(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    print(
        json.dumps(
            {
                "facts": len(facts),
                "evidence_entries": len(evidence),
                "paragraphs": len(PARAGRAPH_BINDINGS),
                "output": str(output),
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", type=Path, default=Path(__file__).resolve().parents[2])
    parser.add_argument("--policy-research", type=Path, required=True)
    parser.add_argument("--overview", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    prepare(args.repo.resolve(), args.policy_research, args.overview, args.output)
