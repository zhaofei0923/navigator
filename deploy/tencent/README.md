# Tencent Cloud access-controlled private preview

Current approved site: the Zambia increment now serves 60 overseas countries
through the existing anonymous entry. Use the
[2026-08-28 release record and current operations](ZAMBIA_RELEASE_20260828.md).
The synthetic-preview instructions below are retained for the separate historical
profile; they are not the current site's startup or access policy.

This deployment profile is limited to the `PBD-ACCEL-DEMO-001` synthetic-data
private-preview scope. It is not a production or public-release profile.

## Fixed topology

- Host: `navigator.easudata.com`
- Edge: the server's existing Nginx and wildcard Let's Encrypt certificate
- Web: `127.0.0.1:3100`
- API and PostgreSQL: Docker internal network only; no host ports. The Web
  container also joins a dedicated edge bridge so its loopback-only published
  port can be reached by host Nginx.
- PostgreSQL data uses the external named volume
  `navigator-private-preview_navigator_private_preview_pgdata`. Create it once
  with the `navigator.data-scope=synthetic_demo` label before the first Compose
  start. Compose updates and `down -v` must not delete it.
- Runtime budget: 960 MiB and 1.75 CPU across the three containers
- Access: a high-entropy application demo passphrase protected by an Nginx
  login rate limit; Nginx does not add a separate username/password prompt

Build and test the Linux AMD64 images away from the server. Compute the immutable
source snapshot over the tracked and untracked, non-ignored files under
`apps/web` and `services/api`; tag both images with that identifier and record it in
`NAVIGATOR_SOURCE_SNAPSHOT_SHA256`, transfer the images with `docker save`, and
load them on the server with `docker load`. Do not build or prune Docker data on
the shared CVM.

Create `/opt/navigator/.env.remote` from `env.private-preview.example`, replace every
secret and image placeholder, and set mode `0600`.

`generate-private-preview-env.sh` generates independent random database, API,
and session secrets and atomically writes the remote environment file.
Run the environment generator as root. The shared application passphrase must
contain at least 128 bits of entropy, be distributed only to approved internal
demo participants, and never be stored in the repository or a world-readable
file.

For an existing preview, rotate only the demo passphrase and session secret and
update the immutable image references with `apply-private-preview-env.py`. The
helper preserves the database password and API key, validates the secret
fragment, and replaces the environment file atomically with mode `0600`.

The helper keeps the high-entropy policy as its default. An operator-approved,
short-lived exception for an exact eight-character ASCII-alphanumeric
passphrase requires both `--approved-passphrase-stdin` and
`--allow-approved-8-char-passphrase`; this path also generates a new random
session secret. Record the exception, retain login rate limiting, add network
access control for any longer-lived preview, and restore a high-entropy
passphrase after the demo.

Before a reload, run `sudo nginx -t`. The new site must use the existing wildcard
certificate under `/etc/letsencrypt/live/easudata.com` and must not modify any
existing site configuration. Only the Web loopback port is exposed by Compose.

Minimum verification:

1. `docker volume inspect navigator-private-preview_navigator_private_preview_pgdata`
2. `docker compose --env-file .env.remote -f compose.private-preview.yaml config`
3. `docker compose --env-file .env.remote -f compose.private-preview.yaml up -d`
4. `curl -fsS http://127.0.0.1:3100/api/health`
5. An HTTPS request reaches the application login page without an Nginx
   username/password prompt.
6. The application remains inaccessible until the correct demo passphrase is
   submitted.
7. `POST /api/demo/demo/reset` and its trailing-slash or encoded-path variants
   return `403`; repeated login failures are rate-limited.
8. `3000`, `3100`, `8000`, `8100`, and `5432` are not reachable from the public
   Internet.
9. After a controlled Compose restart, all services become healthy and the
   synthetic seed remains available.

## Approved Basic60 Demo: separate staged deployment

`compose.approved-basic60.yaml` is an independent, image-only profile for the
already approved real Basic60 data and published country overviews. It does not
extend or replace `compose.private-preview.yaml`, and it does not change Nginx.
Keep the synthetic configuration, images, environment and external volume intact.
The new profile keeps formal D1-D4/P0 status `pending`; staging on Tencent Cloud is
not itself authorization for anonymous public access or a production release.

This profile explicitly selects `approved_basic60_demo` and the Basic60 API
entrypoint. Its application has **no shared-passphrase login**: `/login` redirects
home and `/api/session` is unavailable. The retained private-profile session
environment fields do not activate authentication. Do not put it behind the old
unrestricted Nginx location without resolving the intended external access first.
Any actual external route/access-control change must agree with the current
explicit user authorization. This file neither adds a new login nor grants that
authorization. Until then, validate through loopback or an operator SSH tunnel.

### Isolation and runtime contract

- Compose project: `navigator-basic60-private`, with its own `basic60_internal`
  and `basic60_edge` networks, independent of the synthetic project.
- Web: `127.0.0.1:3101` by default, leaving the old `3100` service untouched for
  validation and recovery. API and PostgreSQL have no host ports; only Web joins
  the non-internal edge network.
- PostgreSQL: database/user `navigator_basic60`, using the dedicated external
  volume `navigator-basic60-private_navigator_basic60_pgdata`. Never point this
  service at the old `navigator-private-preview_navigator_private_preview_pgdata`.
- Images must already be loaded locally on the CVM. All services have
  `pull_policy: never`, with no `build` section. Build/test Linux AMD64 images
  away from the shared server, record their image IDs/archive SHA-256 and source
  snapshot, and use immutable source-specific image references. Do not build or
  prune Docker data on the CVM.
- The resource limits remain 960 MiB and 1.75 CPU total: DB 320 MiB/0.50 CPU,
  API 256 MiB/0.50 CPU, Web 384 MiB/0.75 CPU. Web retains a 256 MiB Node heap
  limit. Check available shared-host capacity before running both projects.
- API and Web have read-only root filesystems, bounded writable `/tmp`, dropped
  capabilities, no-new-privileges and bounded local logs. DB writes only through
  its dedicated data volume for persistence; PostgreSQL retains the existing
  writable-root deployment pattern rather than a new filesystem restriction.

Create a **separate** protected environment from `env.approved-basic60.example`,
for example `/opt/navigator/basic60/.env.remote` with mode `0600`. Generate
independent Basic60 database/API/session secrets; do not copy the old synthetic
environment or reuse its passwords. The machine attestation trust key must verify
the exact supplied attestation. Rotating it requires a newly generated valid
attestation and hash, not a change to the human approval. Never log or print keys.

Before startup, transfer and hash-check these approved artifacts outside Git:

1. `basic60_seed.private_trial_ready.json` and `basic60_runtime_attestation.json`
   in the protected Basic60 runtime directory.
2. The exact PBD decision, release authorization and final validation report.
   Preserve their original hashes and approvals; do not regenerate them by hand.
3. The **complete** published `market-content` store, including `current.json`,
   manifests, releases, objects, confirmed batches, confirmations, review copies
   and any revocation tombstones. Copying only country JSON or the active pointer
   is insufficient. Preserve historical objects and file hashes.

All five API bind mounts are read-only and reject nonexistent host paths. Only
API mounts the content store; Web has no data/research mount. API UID 10001 needs
traversal/read permission on the mounted directories/files. Keep the host paths
protected, with no symlinks or public/static exposure. The original workbooks,
raw material, unpublished manuscripts and research directories need not be copied
to this runtime. Full publication-store backups may contain review copies and
therefore remain private even though the API returns only the approved prose.

### Stage and validate before any edge switch

Inspect the dedicated volume first. If it does not exist, create it once with
`docker volume create --label navigator.data-scope=basic60_private
navigator-basic60-private_navigator_basic60_pgdata`. An existing volume must have
the correct scope; do not relabel/reuse a synthetic volume. After verifying the
loaded images, protected files, permissions and independent environment:

```bash
docker compose --env-file /opt/navigator/basic60/.env.remote \
  -f deploy/tencent/compose.approved-basic60.yaml config --quiet
docker compose --env-file /opt/navigator/basic60/.env.remote \
  -f deploy/tencent/compose.approved-basic60.yaml up -d --no-build --pull never
curl -fsS http://127.0.0.1:3101/api/health
```

Do not print the expanded Compose configuration: it contains secrets. Startup
uses the existing Basic60 migrations and idempotent validated seed importer; it
does not migrate the synthetic database or manufacture a content confirmation.
Verify healthy containers, `basic60_private` health, 59 outbound countries, both
languages of all approved overviews, original charts, China/invalid-code rejection,
retired comparison/report APIs, and absence of host API/DB ports. A green health
probe alone does not prove the content volume was transferred correctly.

Only after those checks and matching user authorization may the operator back up
the current site configuration and switch the intended edge route. This staged
profile does not perform the switch. Validate `nginx -t` before any future reload.
Retain the previous image/configuration and its volume for service rollback; do
not run `down -v`, `--volumes` or a Docker prune. Stop only the explicitly selected
project when necessary. Content rollback uses previously published, non-revoked
overview versions; the initial 59-country publication has no earlier published
overview, and old sample manuscripts/retired reports are not rollback targets.

### Confirmed Zambia update on the existing site

The 2026-08-28 user confirmation covers the added Zambia basic data, source
collection and bilingual overview in one Excel. It expands the existing 59
overseas markets to 60; China remains excluded. The new seed has release ID
`BASIC61-PRIVATE-R1` and schema `basic61.seed.v1`, under the unchanged
`basic60_private` profile. The old `BASIC60-PRIVATE-R1` seed and its fixed-count
contract remain intact and usable for rollback. See
[the confirmed extension bindings](../basic60/README.md#confirmed-zambia-extension-2026-08-28)
and [the versioned preparation commands](../../services/data-readiness/COUNTRY_EXTENSIONS.md).

The current site's anonymous entry was separately and explicitly approved by
the user (“允许不登录可访问”). Preserve that authorization and the existing
anonymous Web entry and Nginx routing; do not recreate a shared passphrase or an
additional login. This update does not advance formal D1-D4/P0
or claim a new production approval.

For this increment, reuse the existing Basic60 Compose project, database,
loopback port 3101 and protected credentials. Build compatible Web/API images
from an exact source snapshot, stage the new immutable ready artifacts and
the complete 60-country content store in a new release directory, and verify
their hashes before changing the running services. Do not copy raw-source
downloads, unpublished drafts or secrets into image/build archives. The private
content-volume backup retains its required historical review/confirmation files.

Take a PostgreSQL dump before the controlled Web/API replacement. Do not launch
an alternate API against this database while the old one is serving: both would
share the one active-release pointer. Keep the previous environment, images and
content directory so restarting the old version can reactivate its authorized
seed without deleting the new or old database records. No Nginx route change,
database migration, volume replacement or Docker prune is required.

The added-version checks must confirm 61 archived country rows, 305 macro annual
rows, 61 energy rows, 2317 available observations and 62 explicit pending values;
the read-only API returns 60 overseas countries. Verify Zambia's selection,
detail charts and both overview languages, all 59 previous overview versions,
China/invalid-code rejection, key protection, and read-only API-only data mounts.
The old staged-release 59-country count above describes the original release,
not this increment's acceptance count.
