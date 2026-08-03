from __future__ import annotations

import re
from datetime import date
from pathlib import Path

_REVIEW_PACKET_NAME = re.compile(r"^d0_review_packet\.(\d{4}-\d{2}-\d{2})(?:\.(\d{2}))?\.json$")


def review_packet_identity(path: Path) -> tuple[date, int] | None:
    """Return the chronological date and same-day sequence for a review packet."""

    match = _REVIEW_PACKET_NAME.fullmatch(path.name)
    if match is None:
        return None
    try:
        packet_date = date.fromisoformat(match.group(1))
    except ValueError:
        return None
    sequence_text = match.group(2)
    sequence = 1 if sequence_text is None else int(sequence_text)
    if sequence_text is not None and sequence < 2:
        return None
    return packet_date, sequence


def review_packet_paths(directory: Path) -> list[Path]:
    """List canonical review packets in chronological and same-day sequence order."""

    packets = [
        path
        for path in directory.glob("d0_review_packet.*.json")
        if review_packet_identity(path) is not None
    ]
    return sorted(packets, key=lambda path: review_packet_identity(path) or (date.min, 0))


def latest_review_packet(directory: Path) -> Path | None:
    packets = review_packet_paths(directory)
    return packets[-1] if packets else None


def validate_new_review_packet_path(
    output: Path,
    directory: Path,
    *,
    minimum_date: date,
    label: str,
) -> date:
    """Validate a non-overwriting next review packet path, including same-day sequencing."""

    identity = review_packet_identity(output)
    if identity is None:
        raise ValueError(
            f"{label} must be named d0_review_packet.<ISO-date>[.<NN>].json; "
            "same-day sequences start at 02"
        )
    output_date, sequence = identity
    if output_date < minimum_date:
        raise ValueError(f"{label} cannot predate the reviewed bundle")
    if output.exists():
        raise FileExistsError(f"Refusing to overwrite {output}")

    latest = latest_review_packet(directory)
    if latest is None:
        if sequence != 1:
            raise ValueError(f"{label} must start a new date without a sequence suffix")
        return output_date

    latest_identity = review_packet_identity(latest)
    if latest_identity is None:  # pragma: no cover - guarded by latest_review_packet
        raise ValueError("Latest D0 review packet has an invalid filename")
    latest_date, latest_sequence = latest_identity
    if output_date < latest_date:
        raise ValueError(f"{label} cannot predate the latest review packet")
    if output_date == latest_date:
        if sequence != latest_sequence + 1:
            raise ValueError(f"{label} must use same-day sequence {latest_sequence + 1:02d}")
    elif sequence != 1:
        raise ValueError(f"{label} must start a new date without a sequence suffix")
    return output_date
