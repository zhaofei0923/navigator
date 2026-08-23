from __future__ import annotations

import importlib.util
from pathlib import Path
from types import ModuleType

import pytest

SCRIPT_PATH = Path(__file__).parents[2] / "deploy" / "tencent" / "apply-private-preview-env.py"


def _load_script() -> ModuleType:
    spec = importlib.util.spec_from_file_location("apply_private_preview_env", SCRIPT_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"unable to load deployment helper: {SCRIPT_PATH}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


deployment_env = _load_script()


def _valid_updates(
    *,
    passphrase: str = "a" * 32,
    session_secret: str = "b" * 64,
) -> dict[str, str]:
    return {
        "NAVIGATOR_API_IMAGE": "navigator-demo-api:0123456789abcdef",
        "NAVIGATOR_WEB_IMAGE": "navigator-demo-web:0123456789abcdef",
        "NAVIGATOR_SOURCE_SNAPSHOT_SHA256": "c" * 64,
        "NAVIGATOR_DEMO_PASSPHRASE": passphrase,
        "NAVIGATOR_DEMO_SESSION_SECRET": session_secret,
    }


def _write_environment(path: Path) -> None:
    path.write_text(
        "\n".join(
            [
                "# private preview",
                "NAVIGATOR_HOSTNAME=navigator.example.test",
                "NAVIGATOR_WEB_PORT=3100",
                "NAVIGATOR_DB_PASSWORD=keep-db-password",
                "NAVIGATOR_DEMO_ACCESS_KEY=keep-api-access-key",
                "NAVIGATOR_API_IMAGE=navigator-demo-api:old",
                "NAVIGATOR_WEB_IMAGE=navigator-demo-web:old",
                f"NAVIGATOR_SOURCE_SNAPSHOT_SHA256={'0' * 64}",
                "NAVIGATOR_DEMO_PASSPHRASE=" + "1" * 32,
                "NAVIGATOR_DEMO_SESSION_SECRET=" + "2" * 64,
            ]
        )
        + "\n",
        encoding="utf-8",
    )


def test_default_validation_rejects_eight_character_passphrase() -> None:
    with pytest.raises(ValueError, match="at least 32 lowercase hex characters"):
        deployment_env.validate_inputs(_valid_updates(passphrase="Ab12Cd34"))


def test_explicit_exception_accepts_exact_eight_character_alphanumeric_passphrase() -> None:
    deployment_env.validate_inputs(
        _valid_updates(passphrase="Ab12Cd34"),
        allow_approved_eight_character_passphrase=True,
    )


@pytest.mark.parametrize("passphrase", ["Ab1Cd23", "Ab12Cd345", "Ab12-Cd3"])
def test_explicit_exception_rejects_wrong_length_or_special_characters(passphrase: str) -> None:
    with pytest.raises(ValueError, match="at least 32 lowercase hex characters"):
        deployment_env.validate_inputs(
            _valid_updates(passphrase=passphrase),
            allow_approved_eight_character_passphrase=True,
        )


def test_validation_rejects_session_secret_shorter_than_64_characters() -> None:
    with pytest.raises(ValueError, match="session secret must be at least 64"):
        deployment_env.validate_inputs(_valid_updates(session_secret="b" * 63))


def test_update_preserves_non_rotation_environment_values(tmp_path: Path) -> None:
    env_path = tmp_path / ".env"
    _write_environment(env_path)
    updates = _valid_updates()

    deployment_env.update_environment(
        env_path,
        {
            "NAVIGATOR_DEMO_PASSPHRASE": updates["NAVIGATOR_DEMO_PASSPHRASE"],
            "NAVIGATOR_DEMO_SESSION_SECRET": updates["NAVIGATOR_DEMO_SESSION_SECRET"],
        },
        api_image=updates["NAVIGATOR_API_IMAGE"],
        web_image=updates["NAVIGATOR_WEB_IMAGE"],
        snapshot=updates["NAVIGATOR_SOURCE_SNAPSHOT_SHA256"],
    )

    lines, values = deployment_env.parse_env(env_path)
    assert lines[0] == "# private preview"
    assert values["NAVIGATOR_HOSTNAME"] == "navigator.example.test"
    assert values["NAVIGATOR_WEB_PORT"] == "3100"
    assert values["NAVIGATOR_DB_PASSWORD"] == "keep-db-password"
    assert values["NAVIGATOR_DEMO_ACCESS_KEY"] == "keep-api-access-key"
    assert values["NAVIGATOR_API_IMAGE"] == updates["NAVIGATOR_API_IMAGE"]
    assert values["NAVIGATOR_WEB_IMAGE"] == updates["NAVIGATOR_WEB_IMAGE"]


def test_update_rejects_symbolic_link_environment(tmp_path: Path) -> None:
    target = tmp_path / "target.env"
    env_link = tmp_path / ".env"
    _write_environment(target)
    env_link.symlink_to(target)
    updates = _valid_updates()

    with pytest.raises(ValueError, match="environment input must not be a symbolic link"):
        deployment_env.update_environment(
            env_link,
            {
                "NAVIGATOR_DEMO_PASSPHRASE": updates["NAVIGATOR_DEMO_PASSPHRASE"],
                "NAVIGATOR_DEMO_SESSION_SECRET": updates["NAVIGATOR_DEMO_SESSION_SECRET"],
            },
            api_image=updates["NAVIGATOR_API_IMAGE"],
            web_image=updates["NAVIGATOR_WEB_IMAGE"],
            snapshot=updates["NAVIGATOR_SOURCE_SNAPSHOT_SHA256"],
        )


def test_load_rejects_symbolic_link_secret_fragment(tmp_path: Path) -> None:
    target = tmp_path / "secrets.env"
    secret_link = tmp_path / "secrets-link.env"
    target.write_text(
        "NAVIGATOR_DEMO_PASSPHRASE="
        + "a" * 32
        + "\nNAVIGATOR_DEMO_SESSION_SECRET="
        + "b" * 64
        + "\n",
        encoding="utf-8",
    )
    secret_link.symlink_to(target)

    with pytest.raises(ValueError, match="secret fragment must not be a symbolic link"):
        deployment_env.load_secret_fragment(secret_link)
