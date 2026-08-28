from __future__ import annotations

import re
from decimal import Decimal
from pathlib import Path
from typing import Any

import pytest
import yaml

ROOT = Path(__file__).parents[2]
COMPOSE_PATH = ROOT / "deploy/tencent/compose.approved-basic60.yaml"
ENV_PATH = ROOT / "deploy/tencent/env.approved-basic60.example"
BASE_PATH = ROOT / "deploy/basic60/compose.private-trial.yaml"


def _compose(path: Path = COMPOSE_PATH) -> dict[str, Any]:
    payload = yaml.safe_load(path.read_text(encoding="utf-8"))
    assert isinstance(payload, dict)
    return payload


def _example_values() -> dict[str, str]:
    return {
        name: value
        for line in ENV_PATH.read_text(encoding="utf-8").splitlines()
        if line and not line.startswith("#")
        for name, value in [line.split("=", 1)]
    }


def test_staged_profile_has_only_the_isolated_basic60_services() -> None:
    compose = _compose()
    assert compose["name"] == "navigator-basic60-private"
    assert set(compose["services"]) == {"db", "api", "web"}
    assert compose["services"]["web"]["environment"]["NAVIGATOR_RUNTIME_PROFILE"] == (
        "approved_basic60_demo"
    )
    assert compose["services"]["api"]["entrypoint"] == [
        "/usr/local/bin/navigator-api-basic60-entrypoint"
    ]


@pytest.mark.parametrize("service_name", ["db", "api", "web"])
def test_services_use_loaded_images_without_builds_or_privileged_access(service_name: str) -> None:
    service = _compose()["services"][service_name]
    assert service["pull_policy"] == "never"
    assert "build" not in service
    assert service["image"].startswith("${NAVIGATOR_")
    assert "?" in service["image"]
    assert service.get("privileged", False) is False
    assert "network_mode" not in service
    assert "no-new-privileges:true" in service["security_opt"]
    assert service["init"] is True
    assert service["restart"] == "unless-stopped"
    assert service["labels"]["navigator.data-scope"] == "basic60_private"
    assert service["labels"]["navigator.formal-gate-status"] == "pending"
    assert service["logging"] == {
        "driver": "local",
        "options": {"max-size": "10m", "max-file": "3"},
    }


def test_only_web_exposes_a_loopback_staging_port() -> None:
    compose = _compose()
    services = compose["services"]
    assert "ports" not in services["db"]
    assert "ports" not in services["api"]
    assert services["web"]["ports"] == ["127.0.0.1:${NAVIGATOR_BASIC60_WEB_PORT:-3101}:3000"]
    assert services["db"]["networks"] == ["basic60_internal"]
    assert services["api"]["networks"] == ["basic60_internal"]
    assert services["web"]["networks"] == ["basic60_edge", "basic60_internal"]
    assert compose["networks"]["basic60_internal"]["internal"] is True
    assert compose["networks"]["basic60_edge"]["internal"] is False
    assert all(not network.get("external") for network in compose["networks"].values())


def test_database_never_reuses_the_synthetic_volume_or_credentials() -> None:
    compose = _compose()
    assert compose["volumes"] == {
        "navigator_basic60_pgdata": {
            "external": True,
            "name": "navigator-basic60-private_navigator_basic60_pgdata",
        }
    }
    database = compose["services"]["db"]
    assert database["volumes"] == ["navigator_basic60_pgdata:/var/lib/postgresql"]
    assert database["environment"]["POSTGRES_DB"] == "navigator_basic60"
    assert database["environment"]["POSTGRES_USER"] == "navigator_basic60"
    assert "${NAVIGATOR_BASIC60_DB_PASSWORD:?" in database["environment"]["POSTGRES_PASSWORD"]
    text = COMPOSE_PATH.read_text(encoding="utf-8")
    assert "NAVIGATOR_DEMO_" not in text
    assert "${NAVIGATOR_DB_PASSWORD" not in text
    assert "navigator_private_preview_pgdata" not in text


def test_api_preserves_all_fail_closed_basic60_environment_contracts() -> None:
    actual = _compose()["services"]["api"]["environment"]
    baseline = _compose(BASE_PATH)["services"]["api"]["environment"]
    assert set(actual) == set(baseline)
    for key, value in baseline.items():
        if key != "BASIC60_CORS_ORIGINS":
            assert actual[key] == value, key
    assert actual["BASIC60_CORS_ORIGINS"].startswith("${NAVIGATOR_BASIC60_ORIGIN:?")


def test_protected_inputs_are_api_only_read_only_and_fail_on_missing_host_paths() -> None:
    compose = _compose()
    api_mounts = compose["services"]["api"]["volumes"]
    expected = {mount["target"] for mount in _compose(BASE_PATH)["services"]["api"]["volumes"]}
    assert {mount["target"] for mount in api_mounts} == expected
    assert len(api_mounts) == len(expected) == 5
    for mount in api_mounts:
        assert mount["type"] == "bind"
        assert mount["source"].startswith("${NAVIGATOR_")
        assert ":?" in mount["source"]
        assert mount["read_only"] is True
        assert mount["bind"]["create_host_path"] is False
    assert "volumes" not in compose["services"]["web"]


@pytest.mark.parametrize("service_name", ["api", "web"])
def test_application_services_have_read_only_roots_and_bounded_scratch(service_name: str) -> None:
    service = _compose()["services"][service_name]
    assert service["read_only"] is True
    assert service["cap_drop"] == ["ALL"]
    assert service["tmpfs"] == ["/tmp:size=32m,mode=1777"]
    assert (
        "NAVIGATOR_SOURCE_SNAPSHOT_SHA256:?"
        in service["labels"]["navigator.source-snapshot-sha256"]
    )


def test_resource_limits_match_the_existing_shared_host_budget() -> None:
    services = _compose()["services"]
    assert {name: service["mem_limit"] for name, service in services.items()} == {
        "db": "320m",
        "api": "256m",
        "web": "384m",
    }
    assert sum(int(service["mem_limit"][:-1]) for service in services.values()) == 960
    assert sum(Decimal(str(service["cpus"])) for service in services.values()) == Decimal("1.75")
    assert services["web"]["environment"]["NODE_OPTIONS"] == "--max-old-space-size=256"
    assert services["web"]["environment"]["BASIC60_COOKIE_SECURE"] == "true"


def test_environment_example_covers_all_compose_inputs_without_real_secrets() -> None:
    values = _example_values()
    referenced = set(re.findall(r"\$\{([A-Z][A-Z0-9_]*)", COMPOSE_PATH.read_text(encoding="utf-8")))
    assert set(values) == referenced
    assert values["NAVIGATOR_BASIC60_WEB_PORT"] == "3101"
    assert values["NAVIGATOR_BASIC60_ORIGIN"] == "https://navigator.easudata.com"
    for name in (
        "NAVIGATOR_BASIC60_DB_PASSWORD",
        "NAVIGATOR_BASIC60_API_KEY",
        "NAVIGATOR_BASIC60_SHARED_PASSPHRASE",
        "NAVIGATOR_BASIC60_SESSION_SECRET",
        "NAVIGATOR_BASIC60_RUNTIME_ATTESTATION_KEY",
    ):
        assert values[name].startswith("replace-")
    for name, value in values.items():
        if name.endswith(("_DIR", "_FILE")):
            assert value.startswith("/opt/navigator/basic60/")
        if name.endswith("_SHA256"):
            assert value.startswith("replace-with-")
