"""Country content GET endpoints inherit Basic60 visibility, without exposing evidence."""

from __future__ import annotations

import sys
from collections.abc import Iterator
from dataclasses import replace
from pathlib import Path
from typing import cast

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from navigator_api.basic60_importer import revoke_basic60_source
from navigator_api.basic60_main import create_app
from navigator_api.basic60_models import Basic60Release
from navigator_api.market_storage import read_json
from navigator_data_readiness.market_content import revoke_market_content

sys.path.append(str(Path(__file__).resolve().parents[2]))

from tests.api.market_fixture import SyntheticReview, reviewed_fixture, write_legacy_published
from tests.api.test_basic60_api import API_KEY, _seed_payload, _settings, _write_json

HEADERS = {"X-Private-Trial-Key": API_KEY}


@pytest.fixture
def market_client(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> Iterator[tuple[TestClient, Path, SyntheticReview]]:
    review = reviewed_fixture(tmp_path, monkeypatch)
    root = tmp_path / "published"
    review.publish(root)
    seed = tmp_path / "synthetic-basic60-seed.json"
    seed_sha = _write_json(seed, _seed_payload())
    settings = replace(_settings(tmp_path, seed, seed_sha), market_content_root=root)
    app = create_app(settings)
    with TestClient(app) as client:
        yield client, root, review


@pytest.mark.parametrize("locale", ["zh-CN", "en"])
def test_market_content_envelope_and_readonly_auth(
    market_client: tuple[TestClient, Path, SyntheticReview], locale: str
) -> None:
    client, _, fixture = market_client
    response = client.get(
        "/api/v1/countries/idn/market-overview", params={"locale": locale}, headers=HEADERS
    )
    assert response.status_code == 200
    body = response.json()
    assert set(body) == {"meta", "data"}
    assert body["meta"] == {
        "country_code": "IDN",
        "content_version": "OVERVIEW-IDN-20260827-R1",
        "as_of": "2026-08-27",
        "locale": locale,
    }
    assert body["data"] == fixture.candidate.payload()["countries"][0]["locales"][locale]
    assert set(body["data"]) == {"title", "paragraphs", "disclaimer"}
    for private_key in (
        "source_ref",
        "source_url",
        "evidence",
        "approved_by",
        "workbook_sha256",
        "candidate_sha256",
    ):
        assert f'"{private_key}"' not in response.text
    assert response.headers["Cache-Control"] == "no-store"
    assert client.post("/api/v1/countries/IDN/market-overview", headers=HEADERS).status_code == 405


@pytest.mark.parametrize("headers", [{}, {"X-Private-Trial-Key": "incorrect"}])
def test_market_endpoints_never_bypass_existing_key(
    market_client: tuple[TestClient, Path, SyntheticReview], headers: dict[str, str]
) -> None:
    client, _, _ = market_client
    for kind in ("market-overview", "market-analysis", "market-report"):
        response = client.get(f"/api/v1/countries/IDN/{kind}", headers=headers)
        assert response.status_code == 401


@pytest.mark.parametrize("code", ["CHN", "chn", "CN", "ZZZ", "IDNN", "12N", "中文", "IDN.js"])
def test_market_invalid_or_nonoutbound_country_not_found(
    market_client: tuple[TestClient, Path, SyntheticReview], code: str
) -> None:
    client, _, _ = market_client
    for kind in ("market-overview", "market-analysis", "market-report"):
        response = client.get(f"/api/v1/countries/{code}/{kind}", headers=HEADERS)
        assert response.status_code == 404
        assert response.json()["error"]["code"] == "COUNTRY_NOT_FOUND"


@pytest.mark.parametrize("state", ["not_configured", "empty", "draft", "revoked"])
def test_market_unpublished_and_revoked_content_unavailable(
    market_client: tuple[TestClient, Path, SyntheticReview], state: str, tmp_path: Path
) -> None:
    client, root, review = market_client
    app = cast(FastAPI, client.app)
    if state == "not_configured":
        app.state.settings = replace(app.state.settings, market_content_root=None)
    elif state == "empty":
        app.state.settings = replace(app.state.settings, market_content_root=tmp_path / "empty")
    elif state == "draft":
        app.state.settings = replace(app.state.settings, market_content_root=review.source_dir)
    else:
        revoke_market_content(
            content_root=root,
            country_code="IDN",
            actor="test-only",
            reason="synthetic withdrawal",
            repo_root=review.repo_root,
        )
    response = client.get("/api/v1/countries/IDN/market-overview", headers=HEADERS)
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "MARKET_CONTENT_UNAVAILABLE"


@pytest.mark.parametrize("file_kind", ["object", "batch", "confirmation", "state"])
def test_corrupt_content_is_not_served_or_exposed(
    market_client: tuple[TestClient, Path, SyntheticReview], file_kind: str
) -> None:
    client, root, _ = market_client
    release = read_json(root / "releases" / "OVERVIEW-IDN-20260827-R1.json")
    paths = {
        "object": root / "objects" / f"{release['object_sha256']}.json",
        "batch": root / "batches" / f"{release['candidate_sha256']}.json",
        "confirmation": root / "confirmations" / f"{release['confirmation_sha256']}.json",
        "state": root / "current.json",
    }
    path = paths[file_kind]
    path.chmod(0o644)
    path.write_text('{"secret_evidence":"do not echo this internal path"}', encoding="utf-8")
    response = client.get("/api/v1/countries/IDN/market-overview", headers=HEADERS)
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "MARKET_CONTENT_INVALID"
    assert "secret_evidence" not in response.text
    assert str(root) not in response.text


def test_content_inherits_identity_source_visibility(
    market_client: tuple[TestClient, Path, SyntheticReview],
) -> None:
    client, _, _ = market_client
    app = cast(FastAPI, client.app)
    with app.state.session_factory() as session:
        revoke_basic60_source(session, "BASIC60-PRIVATE-R1", "SRC-ID-PRIMARY")
    for kind in ("market-overview", "market-analysis", "market-report"):
        response = client.get(f"/api/v1/countries/IDN/{kind}", headers=HEADERS)
        assert response.status_code == 404
        assert response.json()["error"]["code"] == "COUNTRY_NOT_FOUND"


def test_content_inherits_active_base_release(
    market_client: tuple[TestClient, Path, SyntheticReview],
) -> None:
    client, _, _ = market_client
    app = cast(FastAPI, client.app)
    with app.state.session_factory() as session:
        release = session.get(Basic60Release, "BASIC60-PRIVATE-R1")
        assert release is not None
        release.is_active = False
        session.commit()
    for kind in ("market-overview", "market-analysis", "market-report"):
        response = client.get(f"/api/v1/countries/IDN/{kind}", headers=HEADERS)
        assert response.status_code == 503
        assert response.json()["error"]["code"] == "BASIC60_NO_ACTIVE_RELEASE"


def test_single_country_update_moves_bilingual_overviews_without_restart(
    market_client: tuple[TestClient, Path, SyntheticReview],
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client, root, _ = market_client
    newer = reviewed_fixture(tmp_path, monkeypatch, revision=2, codes=("IDN",))
    newer.publish(root)
    for locale in ("zh-CN", "en"):
        body = client.get(
            "/api/v1/countries/IDN/market-overview", params={"locale": locale}, headers=HEADERS
        ).json()
        assert body["meta"]["content_version"] == "OVERVIEW-IDN-20260827-R2"
        assert body["meta"]["locale"] == locale
        assert (
            client.get("/api/v1/countries/ZAF/market-overview", headers=HEADERS).json()["meta"][
                "content_version"
            ]
            == "OVERVIEW-ZAF-20260827-R1"
        )


def test_market_routes_do_not_reintroduce_comparison_or_model_endpoints(
    market_client: tuple[TestClient, Path, SyntheticReview],
) -> None:
    client, _, _ = market_client
    spec = client.get("/openapi.json").json()
    paths = spec["paths"]
    assert "/api/v1/countries/{country_code}/market-overview" in paths
    assert "/api/v1/countries/{country_code}/market-analysis" not in paths
    assert "/api/v1/countries/{country_code}/market-report" not in paths
    assert "MarketAnalysis" not in spec["components"]["schemas"]
    assert "MarketReport" not in spec["components"]["schemas"]
    assert not any(
        term in path
        for path in paths
        for term in ("compar", "polic", "search", "chat", "embedding")
    )
    response = client.get("/api/v1/countries/IDN/market-overview?locale=fr", headers=HEADERS)
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"


@pytest.mark.parametrize("kind", ["market-analysis", "market-report"])
def test_retired_endpoints_never_read_or_return_old_content(
    market_client: tuple[TestClient, Path, SyntheticReview],
    kind: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from navigator_api.routers import market_content as router

    client, _, _ = market_client

    def forbidden(*args: object) -> None:
        pytest.fail("retired endpoint tried to read content")

    monkeypatch.setattr(router, "read_active_market_content", forbidden)
    response = client.get(f"/api/v1/countries/IDN/{kind}?locale=fr", headers=HEADERS)
    assert response.status_code == 410
    assert response.json()["error"]["code"] == "MARKET_CONTENT_RETIRED"
    assert "data" not in response.json()
    assert response.headers["Cache-Control"] == "no-store"


def test_active_legacy_archive_cannot_be_used_as_an_overview_fallback(
    market_client: tuple[TestClient, Path, SyntheticReview], tmp_path: Path
) -> None:
    client, _, _ = market_client
    legacy_root = tmp_path / "legacy-archive"
    write_legacy_published(legacy_root)
    original = {path: path.read_bytes() for path in legacy_root.rglob("*") if path.is_file()}
    app = cast(FastAPI, client.app)
    app.state.settings = replace(app.state.settings, market_content_root=legacy_root)
    response = client.get("/api/v1/countries/IDN/market-overview", headers=HEADERS)
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "MARKET_CONTENT_UNAVAILABLE"
    assert original == {path: path.read_bytes() for path in original}


def test_revoke_after_success_does_not_serve_a_stale_overview(
    market_client: tuple[TestClient, Path, SyntheticReview],
) -> None:
    client, root, review = market_client
    assert client.get("/api/v1/countries/IDN/market-overview", headers=HEADERS).status_code == 200
    revoke_market_content(
        content_root=root,
        country_code="IDN",
        actor="test-only",
        reason="synthetic withdrawal after successful read",
        repo_root=review.repo_root,
    )
    response = client.get("/api/v1/countries/IDN/market-overview", headers=HEADERS)
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "MARKET_CONTENT_UNAVAILABLE"
    assert response.headers["Cache-Control"] == "no-store"


def test_default_overview_locale_is_chinese(
    market_client: tuple[TestClient, Path, SyntheticReview],
) -> None:
    client, _, review = market_client
    response = client.get("/api/v1/countries/IDN/market-overview", headers=HEADERS)
    assert response.status_code == 200
    assert response.json()["meta"]["locale"] == "zh-CN"
    assert response.json()["data"] == review.candidate.countries[0].locales["zh-CN"].model_dump()


@pytest.mark.parametrize("target", ["root", "object"])
def test_overview_refuses_symbolic_link_roots_and_objects(
    market_client: tuple[TestClient, Path, SyntheticReview], target: str, tmp_path: Path
) -> None:
    client, root, _ = market_client
    if target == "root":
        linked = tmp_path / "linked-store"
        linked.symlink_to(root, target_is_directory=True)
        app = cast(FastAPI, client.app)
        app.state.settings = replace(app.state.settings, market_content_root=linked)
    else:
        release = read_json(root / "releases" / "OVERVIEW-IDN-20260827-R1.json")
        object_path = root / "objects" / f"{release['object_sha256']}.json"
        outside = tmp_path / "outside-store-object.json"
        outside.write_bytes(object_path.read_bytes())
        object_path.unlink()
        object_path.symlink_to(outside)
    response = client.get("/api/v1/countries/IDN/market-overview", headers=HEADERS)
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "MARKET_CONTENT_INVALID"
    assert "data" not in response.json()
    assert str(tmp_path) not in response.text


def test_missing_active_object_does_not_fall_back_to_an_older_version(
    market_client: tuple[TestClient, Path, SyntheticReview],
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client, root, _ = market_client
    newer = reviewed_fixture(tmp_path, monkeypatch, revision=2, codes=("IDN",))
    newer.publish(root)
    release = read_json(root / "releases" / "OVERVIEW-IDN-20260827-R2.json")
    (root / "objects" / f"{release['object_sha256']}.json").unlink()
    response = client.get("/api/v1/countries/IDN/market-overview", headers=HEADERS)
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "MARKET_CONTENT_INVALID"
    assert "data" not in response.json()
