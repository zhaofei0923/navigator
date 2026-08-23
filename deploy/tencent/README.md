# Tencent Cloud access-controlled private preview

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
