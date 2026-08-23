#!/usr/bin/env python3
"""Atomically update an existing private-preview environment without exposing secrets."""

from __future__ import annotations

import argparse
import os
import re
import secrets as secrets_module
import stat
import sys
import tempfile
from pathlib import Path

UPDATES = (
    "NAVIGATOR_API_IMAGE",
    "NAVIGATOR_WEB_IMAGE",
    "NAVIGATOR_SOURCE_SNAPSHOT_SHA256",
    "NAVIGATOR_DEMO_PASSPHRASE",
    "NAVIGATOR_DEMO_SESSION_SECRET",
)
SECRET_KEYS = {"NAVIGATOR_DEMO_PASSPHRASE", "NAVIGATOR_DEMO_SESSION_SECRET"}
IMAGE_PATTERN = re.compile(r"^[a-z0-9][a-z0-9._/-]*:[A-Za-z0-9][A-Za-z0-9._-]*$")
HEX_PATTERN = re.compile(r"^[0-9a-f]+$")
APPROVED_EIGHT_CHARACTER_PATTERN = re.compile(r"^[A-Za-z0-9]{8}$")


def parse_env(path: Path) -> tuple[list[str], dict[str, str]]:
    lines = path.read_text(encoding="utf-8").splitlines()
    values: dict[str, str] = {}
    for line in lines:
        if not line or line.lstrip().startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        if key in values:
            raise ValueError(f"duplicate environment key: {key}")
        values[key] = value
    return lines, values


def validate_inputs(
    values: dict[str, str],
    *,
    allow_approved_eight_character_passphrase: bool = False,
) -> None:
    missing = [key for key in UPDATES if key not in values]
    if missing:
        raise ValueError(f"missing required keys: {', '.join(missing)}")
    if not IMAGE_PATTERN.fullmatch(values["NAVIGATOR_API_IMAGE"]):
        raise ValueError("invalid API image reference")
    if not IMAGE_PATTERN.fullmatch(values["NAVIGATOR_WEB_IMAGE"]):
        raise ValueError("invalid Web image reference")
    snapshot = values["NAVIGATOR_SOURCE_SNAPSHOT_SHA256"]
    if len(snapshot) != 64 or not HEX_PATTERN.fullmatch(snapshot):
        raise ValueError("source snapshot must be a lowercase SHA-256")
    passphrase = values["NAVIGATOR_DEMO_PASSPHRASE"]
    strong_passphrase = len(passphrase) >= 32 and bool(HEX_PATTERN.fullmatch(passphrase))
    approved_temporary_passphrase = allow_approved_eight_character_passphrase and bool(
        APPROVED_EIGHT_CHARACTER_PATTERN.fullmatch(passphrase)
    )
    if not strong_passphrase and not approved_temporary_passphrase:
        raise ValueError("demo passphrase must be at least 32 lowercase hex characters")
    session_secret = values["NAVIGATOR_DEMO_SESSION_SECRET"]
    if len(session_secret) < 64 or not HEX_PATTERN.fullmatch(session_secret):
        raise ValueError("session secret must be at least 64 lowercase hex characters")


def update_environment(
    env_path: Path,
    secret_updates: dict[str, str],
    *,
    api_image: str,
    web_image: str,
    snapshot: str,
    allow_approved_eight_character_passphrase: bool = False,
) -> None:
    if env_path.is_symlink():
        raise ValueError("environment input must not be a symbolic link")
    lines, current = parse_env(env_path)
    if set(secret_updates) != SECRET_KEYS:
        raise ValueError("secret fragment must contain exactly the two rotation keys")
    updates = {
        "NAVIGATOR_API_IMAGE": api_image,
        "NAVIGATOR_WEB_IMAGE": web_image,
        "NAVIGATOR_SOURCE_SNAPSHOT_SHA256": snapshot,
        **secret_updates,
    }
    validate_inputs(
        updates,
        allow_approved_eight_character_passphrase=(allow_approved_eight_character_passphrase),
    )
    missing_in_target = [key for key in UPDATES if key not in current]
    if missing_in_target:
        raise ValueError(f"target environment lacks keys: {', '.join(missing_in_target)}")

    rendered = []
    for line in lines:
        key = line.split("=", 1)[0] if "=" in line else ""
        rendered.append(f"{key}={updates[key]}" if key in updates else line)
    payload = "\n".join(rendered) + "\n"

    env_path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(prefix=f".{env_path.name}.", dir=env_path.parent)
    temporary = Path(temporary_name)
    try:
        os.fchmod(descriptor, stat.S_IRUSR | stat.S_IWUSR)
        with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, env_path)
        os.chmod(env_path, stat.S_IRUSR | stat.S_IWUSR)
    finally:
        temporary.unlink(missing_ok=True)


def load_secret_fragment(path: Path) -> dict[str, str]:
    if path.is_symlink():
        raise ValueError("secret fragment must not be a symbolic link")
    _, secret_updates = parse_env(path)
    return secret_updates


def read_approved_passphrase() -> str:
    passphrase = sys.stdin.readline()
    if not passphrase:
        raise ValueError("approved passphrase was not provided on standard input")
    return passphrase.rstrip("\r\n")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--env", required=True, type=Path)
    secret_source = parser.add_mutually_exclusive_group(required=True)
    secret_source.add_argument("--secrets", type=Path)
    secret_source.add_argument("--approved-passphrase-stdin", action="store_true")
    parser.add_argument("--allow-approved-8-char-passphrase", action="store_true")
    parser.add_argument("--api-image", required=True)
    parser.add_argument("--web-image", required=True)
    parser.add_argument("--snapshot", required=True)
    args = parser.parse_args()
    if args.approved_passphrase_stdin:
        if not args.allow_approved_8_char_passphrase:
            parser.error("--approved-passphrase-stdin requires --allow-approved-8-char-passphrase")
        secret_updates = {
            "NAVIGATOR_DEMO_PASSPHRASE": read_approved_passphrase(),
            "NAVIGATOR_DEMO_SESSION_SECRET": secrets_module.token_hex(32),
        }
    else:
        secret_updates = load_secret_fragment(args.secrets)
    update_environment(
        args.env,
        secret_updates,
        api_image=args.api_image,
        web_image=args.web_image,
        snapshot=args.snapshot,
        allow_approved_eight_character_passphrase=(args.allow_approved_8_char_passphrase),
    )
    print("private-preview environment updated atomically; mode=0600")


if __name__ == "__main__":
    main()
