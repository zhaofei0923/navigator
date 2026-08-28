"""Collect the bounded ZMB official-policy candidate package; never approve/publish.

Run with Python 3.13 (Windows' normal certificate store is supported). Only the
ZMB 01/02 directories are writable. Downloads preserve original bytes and are
resumable only through their verified receipt. No authentication, TLS downgrade,
access-control retries, or changes to global/country profile indexes are made.
"""

# Chinese source titles and evidence notes intentionally retain Chinese punctuation.
# ruff: noqa: RUF001

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import ssl
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
COUNTRY = ROOT / "raw material/countries/ZMB"
SOURCES = COUNTRY / "01_official_sources"
POLICIES = COUNTRY / "02_policy_documents"
REVIEW = "machine_collected_pending_human_review"
CHECKED = "2026-08-28"
USAGE = "公开资料候选；具体使用许可由人工决定；本批未签署、批准或发布。"
ERB = "https://www.erb.org.zm/"
ZRA = "https://www.zra.org.zm/"
ZEMA = "https://www.zema.org.zm/"
MOE = "https://www.moe.gov.zm/"
ZDA = "https://zda.org.zm/"
BOZ = "https://www.boz.zm/"
ANNUAL = ERB + "wp-content/uploads/ERB-2024-Annual-Report.pdf"
SECTOR = ERB + "wp-content/uploads/files/esr2024.pdf"
ZESCO = "https://netmetering.zesco.co.zm/"
TOPICS = [
    ("tax_customs_vat_incentives", "关税、增值税及新能源相关税费政策"),
    ("grid_code", "电网规范（Grid Code）"),
    ("grid_interconnection_access", "并网、接入、网络使用与投运流程"),
    ("renewable_tariff_subsidy", "新能源电价、补贴及市场支持机制"),
    ("project_approval_permitting", "项目核准、许可与审批"),
    ("environmental_regulation", "环境影响评价、污染防治、生态与退役合规"),
    ("battery_energy_storage_regulation", "电池及储能适用规则"),
]


def policy(
    number,
    title,
    zh,
    body,
    doc,
    url,
    topics,
    note,
    *,
    download=None,
    date="",
    effective="",
    status="official_document_currentness_partially_checked",
    fmt="PDF",
    skip="",
    source_type="national_official",
    scope="",
):
    return {
        "policy_id": f"ZMB-POL-{number:02d}",
        "iso3": "ZMB",
        "country_name_zh": "赞比亚",
        "priority": str(number),
        "policy_group": "core_policy" if number <= 7 else "expanded_regulatory",
        "policy_category": topics[0],
        "topic_tags": ";".join(topics),
        "title_original": title,
        "title_en": title,
        "title_zh": zh,
        "issuing_body": body,
        "document_number": doc,
        "original_language": "English",
        "publication_date": date,
        "effective_date": effective,
        "status": status,
        "official_url": url,
        "download_url": download if download is not None else url,
        "local_filename": "",
        "file_format": "",
        "sha256": "",
        "download_status": "",
        "applicability_scope": scope
        or "赞比亚；须结合项目类型、规模、连接方式与主管机关现行要求。",
        "key_provisions": note,
        "rate_or_incentive": "",
        "source_type": source_type,
        "usage_restriction": USAGE,
        "collected_at": CHECKED,
        "notes": "核验范围为所列官方文件及当前主管机关说明；不宣称已穷尽全部修订历史。",
        "review_status": REVIEW,
        "_format": fmt,
        "_skip": skip,
    }


POLICY_DATA = [
    policy(
        1,
        "The Electricity Act, 2019",
        "《电力法》2019",
        "Parliament of Zambia",
        "Act No. 11 of 2019",
        ERB + "wp-content/uploads/files/The-Electricity-Act-No.-11-of-2019.pdf",
        ["project_approval_permitting", "grid_interconnection_access", "renewable_tariff_subsidy"],
        "确立发输配售电、供电可靠性、多年电价及电网接入框架；2024开放接入和净计量法规仍明确援引该法。原文第1条另定生效命令，未以签署日代替生效日。",
        date="2019-12-27",
    ),
    policy(
        2,
        "The Energy Regulation Act, 2019",
        "《能源监管法》2019",
        "Parliament of Zambia",
        "Act No. 12 of 2019",
        "https://www.parliament.gov.zm/node/8268",
        ["project_approval_permitting", "battery_energy_storage_regulation"],
        "能源活动定义包括能源生产、储存、交易、供应及相关设备；许可适用须结合后续豁免规定，不能认为储能天然不受监管。",
        download="https://www.parliament.gov.zm/sites/default/files/documents/acts/The%20Energy%20Regulation%20Act%20No.%2012%20of%202019.pdf",
        date="2019-12-27",
    ),
    policy(
        3,
        "The Electricity (Open Access) Regulations, 2024",
        "《电力开放接入条例》2024",
        "Ministry of Energy",
        "SI No. 40 of 2024",
        ERB + "wp-content/uploads/SI-40-of-2024-Electricity-Open-Access-Regulations.pdf",
        ["grid_interconnection_access", "renewable_tariff_subsidy", "project_approval_permitting"],
        "为符合条件的参与方规定输配电网络开放接入、申请、协议与系统运营规则；开放接入不等于无条件获得容量或免除网络费用。",
        date="2024-07-19",
    ),
    policy(
        4,
        "The Electricity (Net Metering) Regulations, 2024",
        "《电力净计量条例》2024",
        "Ministry of Energy",
        "SI No. 38 of 2024",
        ERB + "wp-content/uploads/SI-38-of-2024-Net-Metering.pdf",
        [
            "renewable_tariff_subsidy",
            "grid_interconnection_access",
            "battery_energy_storage_regulation",
        ],
        "第3至6条规定非可调度可再生能源、分档容量（最高5MW）和接入及供电协议；可调度电源等被排除。储能不能直接套用光伏净计量资格。",
        date="2024-07-05",
    ),
    policy(
        5,
        "The Energy Regulation (General) (Amendment) Regulations, 2024",
        "《能源监管一般条例修正》2024（原文待补）",
        "Ministry of Energy",
        "SI No. 52 of 2024",
        ANNUAL,
        ["project_approval_permitting", "battery_energy_storage_regulation"],
        "ERB 2024年报第v页及第5页确认对符合条件的至5MW并网/离网活动及太阳能设备进口放宽许可。"
        "未取得修正法规原文，不能将年报概括扩张为所有至5MW项目一律豁免。",
        download="",
        status="official_reference_original_pending",
        skip="仅取得主管机关年报转述；法规原文及具体豁免条件待补。",
    ),
    policy(
        6,
        "Renewable Energy System Technical Specifications for Net Metering, Version 2",
        "ZESCO净计量可再生能源系统技术规范（第2版）",
        "ZESCO Limited",
        "Version 2",
        ZESCO,
        ["grid_code", "grid_interconnection_access", "battery_energy_storage_regulation"],
        "现行公开门户提供第2版；第1.3、1.6、1.9、2.3节规定电网跟随、防孤岛、失电停止馈电、远程控制和合规证明。未标注发布日，不填推测日期。",
        download=ZESCO + "assets/img/documents/Renewable_Technical_Specifications.pdf",
    ),
    policy(
        7,
        "Approved Reference Tariffs for Net Metering Programme "
        "and the Respective Connection Fees for 2026",
        "2026年净计量参考电价及接入费公告",
        "Energy Regulation Board",
        "2026 Net Metering Tariffs",
        ERB + "approved-reference-tariffs-for-net-metering-programme-"
        "and-the-respective-connection-fees/",
        ["renewable_tariff_subsidy"],
        "公告保留US¢6/kWh参考电价，ZESCO 2026年配电系统使用费不超过US¢3/kWh；"
        "不等于保证购电量、项目IRR或所有成本已包含。",
        download=ERB + "wp-content/uploads/PressStatements/"
        "Press-Statement-Approved-Net-Metering-Tariffs-for-2026.pdf",
        date="2025-12-31",
    ),
    policy(
        8,
        "The Environmental Management (Environmental Impact Assessment) Regulations, 2026",
        "《环境管理（环境影响评价）条例》2026",
        "Minister responsible for environmental management",
        "SI No. 3 of 2026",
        ZEMA + "docs/statutory-instrument-no-3-of-2026-the-environmental-management-"
        "environmental-impact-assessment-regulations-2026/",
        ["environmental_regulation", "project_approval_permitting"],
        "ZEMA官网已列2026年新EIA条例。新项目不应继续把1997年条例当作唯一现行依据；具体筛选门槛、过渡安排与生效条文须取得获准原文核验。",
        download="",
        status="official_notice_current_original_pending",
        skip=(
            "官网明示仅供查看、不得下载/复制/再现；须向Government Printers取得正式本。"
            "未下载受限制原文。"
        ),
    ),
    policy(
        9,
        "The Environmental Management (Licensing) Regulations, 2013",
        "《环境管理（许可）条例》2013",
        "Minister responsible for environmental management",
        "SI No. 112 of 2013",
        ZEMA + "docs/licensing-regulations-statutory-instrument-no-112-of-2013/",
        ["environmental_regulation", "battery_energy_storage_regulation"],
        "环境排放、废物和危险废物许可的基础资料入口；电池运输、储存及报废处置须按具体废物分类核验。另见ZEMA对2013规则的修订征询，不将征询视为已修法。",
        download="",
        status="official_reference_original_pending",
        skip="实际HTTP 403，已停止该来源下载，不绕过访问控制；保留官方文件页。",
    ),
    policy(
        10,
        "Investment, Trade and Business Development Act, 2022",
        "《投资、贸易与商业发展法》2022",
        "Parliament of Zambia",
        "Act No. 18 of 2022",
        "https://www.zda.org.zm/wp-content/uploads/2024/02/The-Trade-and-Business-Development-Act-No.-18-of-2022.pdf",
        ["project_approval_permitting", "tax_customs_vat_incentives"],
        "第4、9、10条涉及投资、财产保护与资金汇出；第30至35条的税惠资格和认证不等于设立公司"
        "或进入市场的一般最低资本。须结合ZDA 2026说明、税法及部门许可。",
        date="2022-11-16",
    ),
    policy(
        11,
        "Practice Note No. 1 of 2026",
        "赞比亚税务局2026年第1号实务说明",
        "Zambia Revenue Authority",
        "Practice Note No. 1 of 2026",
        ZRA + "download/practice-note-no-1-of-2026/",
        ["tax_customs_vat_incentives"],
        "2026税法执行说明入口，税率及优惠须按产品、税种、原产地、资格和具体生效条文逐项核对；官网上传/更新日期不等同税法生效日。",
        download=ZRA + "download/practice-note-no-1-of-2026/?wpdmdl=9053",
        status="official_tax_guidance_pending_clause_review",
    ),
    policy(
        12,
        "Customs Tariff Book (official current download, August 2026 path)",
        "海关税则（2026年8月官方下载路径版本）",
        "Zambia Revenue Authority",
        "Customs Tariff Book",
        ZRA + "tax-information/tax-information-details/",
        ["tax_customs_vat_incentives", "battery_energy_storage_regulation"],
        "以完整HS子目核对光伏组件、逆变器、蓄电池和风电设备；中国原产设备不能因经SADC/COMESA转运自动取得原产地优惠。税则下载路径月份不推定法规实施日。",
        download=ZRA + "wp-content/uploads/2026/08/Customs-Tariff-Book.pdf",
        status="official_tax_schedule_pending_clause_review",
    ),
    policy(
        13,
        "The Bank of Zambia Currency Directives, 2025",
        "《赞比亚央行货币指令》2025",
        "Bank of Zambia",
        "Currency Directives 2025",
        BOZ + "Bank_of_Zambia_Currency_Directives_2025.pdf",
        ["project_approval_permitting"],
        "央行公告确认自2025-12-26实施；境内付款原则用克瓦查，附列豁免，跨境交易不在该指令适用范围。不能由此推出完全禁止美元计价或禁止利润汇出。",
        effective="2025-12-26",
    ),
    policy(
        14,
        "Request for Public Comments on Draft Zambian Standard "
        "to Govern Inverter Systems for Embedded Generation",
        "嵌入式发电逆变器标准DZS1191-2征求意见公告",
        "Energy Regulation Board / Zambia Bureau of Standards",
        "DZS 1191-2 (draft)",
        ERB + "standard-to-govern-inverter-systems-for-embedded-generation/",
        ["grid_code", "grid_interconnection_access", "battery_energy_storage_regulation"],
        "2026-08-12公告征求意见至2026-09-11；涉及低压网络及微网、低于1000kVA逆变器。此记录保存公告HTML而非已生效标准；公告所链草稿ZIP实际404。",
        date="2026-08-12",
        status="draft_consultation_not_in_force",
        fmt="HTML",
    ),
    policy(
        15,
        "Environmental Management (Extended Producer Responsibility) Regulations, 2018",
        "《环境管理（生产者延伸责任）条例》2018（原文待补）",
        "Minister responsible for environmental management",
        "SI No. 65 of 2018",
        ZEMA + "wp-content/uploads/2022/12/Annual-Report-2018.pdf",
        ["environmental_regulation", "battery_energy_storage_regulation"],
        "ZEMA 2018年报第18页确认生产者责任框架，涉及列明产品/包装的制造、进口及商业分销。"
        "电池是否属于附表具体子类、注册与回收责任须核对法规原文及修订。",
        download="",
        status="official_reference_original_pending",
        skip="主管机关年报仅用作法规存在性线索；ZEMA下载已出现访问停止信号，未取得EPR原文。",
    ),
]

SOURCE_DATA = [
    ("energy_ministry", "Ministry of Energy", "能源部", MOE, "规划、农村电气化及项目官方进展。"),
    (
        "energy_regulator",
        "Energy Regulation Board",
        "能源监管局",
        ERB,
        "法规、许可、电价与能源统计；技术草稿须与生效规范区别。",
    ),
    (
        "national_utility",
        "ZESCO Limited",
        "赞比亚国家电力公司",
        "https://www.zesco.co.zm/",
        "净计量公开门户及技术规范可读；未注册/登录/提交申请。",
    ),
    (
        "environmental_authority",
        "Zambia Environmental Management Agency",
        "赞比亚环境管理局",
        ZEMA,
        "2026 EIA公告限制下载；HTTP403后停止下载，保留URL和限制。",
    ),
    (
        "investment_promotion",
        "Zambia Development Agency",
        "赞比亚发展署",
        ZDA,
        "投资法律及2026优惠资格说明；优惠条件不等于一般准入门槛。",
    ),
    (
        "tax_customs",
        "Zambia Revenue Authority",
        "赞比亚税务局",
        ZRA,
        "2026实务说明和现行税则；使用正常系统TLS信任，不关闭证书验证。",
    ),
    (
        "legislation",
        "National Assembly of Zambia",
        "赞比亚国民议会",
        "https://www.parliament.gov.zm/",
        "法律原文；不把议案当已生效法律。",
    ),
    (
        "central_bank",
        "Bank of Zambia",
        "赞比亚央行",
        BOZ,
        "货币指令与2026解释；旧PDF链接可能已改为网站壳，严禁伪存为PDF。",
    ),
    (
        "standards_body",
        "Zambia Bureau of Standards",
        "赞比亚标准局",
        "https://www.zabs.org.zm/",
        "标准公布与征求意见；付费标准不绕过获取。",
    ),
]

SUPPORTING = [
    ("ZMB-SUP-01", "Energy Sector Report 2024", SECTOR, "PDF"),
    ("ZMB-SUP-02", "ERB Annual Report 2024", ANNUAL, "PDF"),
    (
        "ZMB-SUP-03",
        "Rural Electrification Master Plan 2025-2030",
        MOE + "wp-content/uploads/2026/04/RURAL-ELECTRIFICATION-MASTER-PLAN-2025-2030.pdf",
        "PDF",
    ),
    (
        "ZMB-SUP-04",
        "Leopards Hill solar and BESS construction launch (21 April 2026)",
        MOE + "?p=5758",
        "HTML",
    ),
    (
        "ZMB-SUP-05",
        "Investment Incentives are for Both Local and Foreign Investors (26 March 2026)",
        ZDA + "investment-incentives-are-for-both-local-and-foreign-investors/",
        "HTML",
    ),
    (
        "ZMB-SUP-06",
        "Zambanker March 2026 (currency directives explanation)",
        BOZ + "sites/default/files/2026-06/Zambanker_March_2026.pdf",
        "PDF",
    ),
    (
        "ZMB-SUP-07",
        "ZESCO net metering step-by-step guide",
        ZESCO + "assets/img/documents/Step_by_Step_Written_Practical_Information_Guide.pdf",
        "PDF",
    ),
    (
        "ZMB-SUP-08",
        "ERB 2019 sector report (historical Grid Code and Distribution Code references)",
        ERB + "wp-content/uploads/files/esr2019.pdf",
        "PDF",
    ),
    (
        "ZMB-SUP-09",
        "Energy Sector Report 2025 (published 28 May 2026; filename esr2026.pdf)",
        ERB + "wp-content/uploads/esr/esr2026.pdf",
        "PDF",
    ),
    (
        "ZMB-SUP-10",
        "ERB Annual Report 2025",
        ERB + "wp-content/uploads/files/reports/ERB-2025-ANNUAL-REPORT.pdf",
        "PDF",
    ),
]


def stamp():
    return datetime.now(UTC).isoformat()


def write_generated(path, data):
    """Write only this collector's candidate metadata; preserve all originals."""
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.is_symlink():
        raise ValueError("Refusing symlink metadata")
    path.write_bytes(data)


def csv_bytes(header, rows):
    stream = io.StringIO(newline="")
    writer = csv.DictWriter(stream, fieldnames=header, extrasaction="raise")
    writer.writeheader()
    writer.writerows(rows)
    return stream.getvalue().encode("utf-8-sig")


def existing_header(subdir, filename):
    reference = ROOT / "raw material/countries/NAM" / subdir / filename
    with reference.open(encoding="utf-8-sig", newline="") as handle:
        return next(csv.reader(handle))


def acquire(item):
    identifier, title, url, fmt, directory, skip = item
    receipt = directory / "receipts" / f"{identifier}.json"
    if receipt.exists():
        previous = json.loads(receipt.read_text(encoding="utf-8"))
        if previous["requested_url"] != url:
            raise ValueError(f"URL changed for {identifier}; create a new candidate instead")
        if previous.get("sha256"):
            file = directory / previous["relative_path"]
            if hashlib.sha256(file.read_bytes()).hexdigest() != previous["sha256"]:
                raise ValueError(f"Immutable original changed: {identifier}")
        return previous
    record = {
        "id": identifier,
        "title": title,
        "requested_url": url,
        "retrieved_at": stamp(),
        "review_status": REVIEW,
        "sha256": "",
        "relative_path": "",
        "http_status": None,
        "content_type": "",
        "final_url": "",
        "bytes": 0,
        "download_status": "official_url_only",
        "note": skip,
        "file_format": fmt,
    }
    if url and not skip:
        try:
            request = urllib.request.Request(
                url, headers={"User-Agent": "NavigatorCandidateResearch/1.0"}
            )
            with urllib.request.urlopen(
                request, timeout=45, context=ssl.create_default_context()
            ) as response:
                record.update(
                    http_status=response.status,
                    content_type=response.headers.get("Content-Type", ""),
                    final_url=response.url,
                )
                data = response.read(40 * 1024 * 1024 + 1)
                if len(data) > 40 * 1024 * 1024:
                    raise ValueError("Document exceeds bounded 40 MiB download limit")
            if fmt == "PDF" and not data.startswith(b"%PDF-"):
                raise ValueError("Official PDF URL returned non-PDF content; original not retained")
            if fmt == "HTML" and not any(
                token in data[:1024].lower() for token in (b"<!doctype html", b"<html")
            ):
                raise ValueError("Expected HTML original not found")
            if fmt == "HTML" and any(
                token in data[:4000].lower()
                for token in (b"cf-chl-", b"just a moment", b"verify you are human")
            ):
                raise ValueError("Access-control challenge encountered; stop, no bypass")
            if not data:
                raise ValueError("Empty original")
            target = directory / "files" / f"{identifier}.{fmt.lower()}"
            target.parent.mkdir(parents=True, exist_ok=True)
            with target.open("xb") as handle:
                handle.write(data)
            record.update(
                sha256=hashlib.sha256(data).hexdigest(),
                bytes=len(data),
                relative_path=target.relative_to(directory).as_posix(),
                download_status="downloaded_pending_validation",
                note="实际公开原文；未变更字节；下载不等于效力或许可批准。",
            )
        except urllib.error.HTTPError as exc:
            record.update(
                http_status=exc.code,
                download_status="download_failed_url_retained",
                note=f"HTTP {exc.code}; no access-control bypass or retry",
            )
        except (OSError, ValueError, urllib.error.URLError) as exc:
            record.update(download_status="download_failed_url_retained", note=str(exc))
    write_generated(receipt, json.dumps(record, ensure_ascii=False, indent=2).encode("utf-8"))
    print(f"{identifier}: {record['download_status']}", flush=True)
    return record


def collect():
    for allowed in (SOURCES, POLICIES):
        if allowed.is_symlink() or COUNTRY.is_symlink():
            raise ValueError("Refusing symlink country path")
        allowed.mkdir(parents=True, exist_ok=True)
    tasks = [
        (p["policy_id"], p["title_original"], p["download_url"], p["_format"], POLICIES, p["_skip"])
        for p in POLICY_DATA
    ]
    tasks += [
        (identifier, title, url, fmt, SOURCES, "") for identifier, title, url, fmt in SUPPORTING
    ]
    # Three workers; each bounded URL is tried at most once and its receipt is reused.
    with ThreadPoolExecutor(max_workers=3) as executor:
        receipts = list(executor.map(acquire, tasks))
    by_id = {r["id"]: r for r in receipts}
    policy_rows = []
    header = existing_header("02_policy_documents", "policy_register.csv")
    for p in POLICY_DATA:
        receipt = by_id[p["policy_id"]]
        row = {key: p[key] for key in header}
        row.update(
            download_status=receipt["download_status"],
            sha256=receipt["sha256"],
            local_filename=Path(receipt["relative_path"]).name if receipt["relative_path"] else "",
            file_format=p["_format"] if receipt["sha256"] else "",
            notes=p["notes"] + " " + receipt["note"],
        )
        if p["policy_id"] == "ZMB-POL-08":
            row["usage_restriction"] = (
                "ZEMA明确：仅供查看；不得下载、复制或再现；向Government Printers取得正式本。"
                "未获取受限制原文。"
            )
        policy_rows.append(row)
    write_generated(POLICIES / "policy_register.csv", csv_bytes(header, policy_rows))
    source_rows = []
    for index, (category, name, zh, url, note) in enumerate(SOURCE_DATA, 1):
        source_rows.append(
            {
                "source_id": f"ZMB-SRC-{index:02d}",
                "iso3": "ZMB",
                "country_name_zh": "赞比亚",
                "source_category": category,
                "institution_name_original": name,
                "institution_name_en": name,
                "institution_name_zh": zh,
                "official_url": url,
                "source_type": "national_official",
                "access_note": note,
                "usage_restriction": USAGE
                if category != "environmental_authority"
                else "新EIA页面限制原文下载/复制；实际403已停止。其他使用许可由人工处理。",
                "collected_at": CHECKED,
                "review_status": REVIEW,
            }
        )
    write_generated(
        SOURCES / "official_sources.csv",
        csv_bytes(existing_header("01_official_sources", "official_sources.csv"), source_rows),
    )
    coverage_rows = []
    caveats = {
        "tax_customs_vat_incentives": (
            "须逐HS/原产地/日期核对关税与VAT，不概括所有新能源设备一律免税。"
        ),
        "grid_code": (
            "取得ZESCO第2版技术规范；全国输电Grid Code SI79/2013及配电规范完整最新版未取得。"
            "DZS1191-2仍是草稿。"
        ),
        "grid_interconnection_access": (
            "有开放接入及净计量原文；实际接入容量、协议、网络收费和项目批准仍适用。"
        ),
        "renewable_tariff_subsidy": (
            "净计量参考价、用网费和零售电价分别处理；不推定固定收益或全额购电。"
        ),
        "project_approval_permitting": (
            "SI52/2024原文豁免边界和新EIA转轨未完全核验；ZDA资格不代替能源或土地许可。"
        ),
        "environmental_regulation": (
            "2026 EIA明示禁止下载；2013许可页403；EPR原文未取得。"
            "仅URL/官方引证，不宣称专题已核验完整。"
        ),
        "battery_energy_storage_regulation": (
            "仅有一般能源活动、净计量排除条件、并网安全及环境规则线索；"
            "未找到足以证明独立储能统一收益机制/全面免税的现行原文。"
        ),
    }
    for code, zh in TOPICS:
        rows = [p for p in policy_rows if code in p["topic_tags"].split(";")]
        coverage_rows.append(
            {
                "iso3": "ZMB",
                "country_name_zh": "赞比亚",
                "topic_code": code,
                "topic_name_zh": zh,
                "coverage_status": "covered_added"
                if any(p["sha256"] for p in rows)
                else "official_url_only",
                "policy_ids": ";".join(p["policy_id"] for p in rows),
                "official_urls": ";".join(dict.fromkeys(p["official_url"] for p in rows)),
                "coverage_summary_zh": caveats[code],
                "notes": (
                    "covered_added仅表示已有对应候选文件，不表示现行效力、完整性或许可已审核。"
                ),
                "collected_at": CHECKED,
                "review_status": REVIEW,
            }
        )
    write_generated(
        POLICIES / "policy_topic_coverage.csv",
        csv_bytes(
            existing_header("02_policy_documents", "policy_topic_coverage.csv"), coverage_rows
        ),
    )
    summary = {
        "country": "ZMB",
        "checked_as_of": CHECKED,
        "scope": "candidate_only",
        "sources": len(source_rows),
        "policy_records": len(policy_rows),
        "topics": len(coverage_rows),
        "policy_downloaded": sum(bool(p["sha256"]) for p in policy_rows),
        "supporting_downloaded": sum(
            bool(r["sha256"]) for r in receipts if r["id"].startswith("ZMB-SUP")
        ),
        "formal_gate_status": "pending",
        "review_status": REVIEW,
        "original_sha256_duplicates": len([r["sha256"] for r in receipts if r["sha256"]])
        - len({r["sha256"] for r in receipts if r["sha256"]}),
    }
    write_generated(
        POLICIES / "collection_summary.json",
        json.dumps(summary, ensure_ascii=False, indent=2).encode("utf-8"),
    )
    print(json.dumps(summary, ensure_ascii=False))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--collect",
        action="store_true",
        help="Download the fixed public candidate list and rebuild only ZMB 01/02 indexes",
    )
    args = parser.parse_args()
    if not args.collect:
        parser.error("Explicit --collect is required; no files were changed")
    collect()
