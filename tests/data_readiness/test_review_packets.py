from __future__ import annotations

from datetime import date
from pathlib import Path

import pytest
from navigator_data_readiness.review_packets import (
    latest_review_packet,
    review_packet_identity,
    review_packet_paths,
    validate_new_review_packet_path,
)


def _write(path: Path) -> None:
    path.write_text("{}\n", encoding="utf-8")


def test_review_packet_identity_requires_canonical_same_day_sequence() -> None:
    assert review_packet_identity(Path("d0_review_packet.2026-08-03.json")) == (
        date(2026, 8, 3),
        1,
    )
    assert review_packet_identity(Path("d0_review_packet.2026-08-03.02.json")) == (
        date(2026, 8, 3),
        2,
    )
    assert review_packet_identity(Path("d0_review_packet.2026-08-03.01.json")) is None
    assert review_packet_identity(Path("d0_review_packet.2026-08-03.2.json")) is None
    assert review_packet_identity(Path("d0_review_packet.2026-02-30.json")) is None
    assert review_packet_identity(Path("d0_review_packet.template.json")) is None


def test_same_day_review_packets_are_ordered_after_the_base_packet(tmp_path: Path) -> None:
    base = tmp_path / "d0_review_packet.2026-08-03.json"
    second = tmp_path / "d0_review_packet.2026-08-03.02.json"
    third = tmp_path / "d0_review_packet.2026-08-03.03.json"
    _write(third)
    _write(base)
    _write(second)

    assert review_packet_paths(tmp_path) == [base, second, third]
    assert latest_review_packet(tmp_path) == third


def test_new_review_packet_path_requires_the_next_batch_without_overwrite(
    tmp_path: Path,
) -> None:
    base = tmp_path / "d0_review_packet.2026-08-03.json"
    _write(base)
    second = tmp_path / "d0_review_packet.2026-08-03.02.json"

    assert validate_new_review_packet_path(
        second,
        tmp_path,
        minimum_date=date(2026, 8, 3),
        label="D0 review output",
    ) == date(2026, 8, 3)

    with pytest.raises(ValueError, match="same-day sequence 02"):
        validate_new_review_packet_path(
            tmp_path / "d0_review_packet.2026-08-03.03.json",
            tmp_path,
            minimum_date=date(2026, 8, 3),
            label="D0 review output",
        )

    _write(second)
    with pytest.raises(FileExistsError, match="Refusing to overwrite"):
        validate_new_review_packet_path(
            second,
            tmp_path,
            minimum_date=date(2026, 8, 3),
            label="D0 review output",
        )

    assert validate_new_review_packet_path(
        tmp_path / "d0_review_packet.2026-08-04.json",
        tmp_path,
        minimum_date=date(2026, 8, 3),
        label="D0 review output",
    ) == date(2026, 8, 4)

    with pytest.raises(ValueError, match="without a sequence suffix"):
        validate_new_review_packet_path(
            tmp_path / "d0_review_packet.2026-08-04.02.json",
            tmp_path,
            minimum_date=date(2026, 8, 3),
            label="D0 review output",
        )
