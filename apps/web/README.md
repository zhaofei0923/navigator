# Navigator internal demo web

This Next.js application is the private synthetic-data demo authorized by
`PBD-ACCEL-DEMO-001`. It never calls the FastAPI service directly from the
browser: `/api/demo/*` is a same-origin server proxy that adds `X-Demo-Key`.

Required server-only settings are documented in `.env.example`. The shared
passphrase creates an HTTP-only, same-site demo cookie; it is not an account or
an enterprise authorization system.

Run `npm ci`, `npm run dev`, `npm run typecheck`, `npm run lint`,
`npm run test`, and `npm run build` from this directory.
