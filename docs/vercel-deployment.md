# Vercel deployment

The app runs on Node.js 22 with Next.js. Production uses a remote **libSQL** database (Turso), not a file in a Function filesystem. Set up the Turso libSQL product, rather than a different database engine requiring another SDK.

## Project and database

1. Import `ffernandesupland/knoledge-studio` into your Vercel team. If Git connection fails, grant the Vercel GitHub App access to this repository in GitHub installation settings, then connect it in Project Settings → Git.
2. Add the Turso Cloud integration, accept its terms, and create a Starter database in `iad1`. Connect it to production. Keep preview/development databases separate to avoid changing production execution history while testing.
3. Confirm `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` exist in production. Never use a `file:` URL in Vercel.
4. Add the server-only settings from `.env.example`: `RA_BASE_URL`, `RA_COMPANY_CODE`, `RA_APP_INTERFACE`, `RA_USERNAME`, `RA_PASSWORD`, `RA_TIMEOUT_MS`, `OPENAI_API_KEY`, `KS_AUTH_USERNAME`, `KS_AUTH_PASSWORD`, `AUTH_SECRET`, `AUTH_TRUST_HOST`, `KS_AUTH_RA_USER`. Use a stable secret of at least 32 characters.
5. Deploy the reviewed deployment branch, or merge it into main for Git-triggered production deployment. Environment updates require redeployment.

`AUTH_URL` and `KS_PUBLIC_ORIGIN` may be omitted for Vercel-generated URLs. Set them to the same fixed HTTPS origin when using a custom domain. Corporate CA files are local development tooling and are not uploaded.

## Persistence

The async libSQL repository retains the existing SQLite schema, exact prompts, source records, decision snapshots, write journal and execution trees. Schema creation is idempotent on first database access. Multi-statement transactions use a write transaction; successful writes and immutable execution plans survive instance restarts.

Local data is not uploaded by deployment. To transfer prior pilot executions, use a deliberate data migration before creating new runs in production; preserve run IDs and `KS_AUTH_RA_USER` so ownership and idempotency records remain intact. Keep the local file as a backup. Do not copy a live SQLite file without its WAL or a database backup operation.

## Platform limits and verification

File uploads are capped at **4 MB**, checked in the browser and server, leaving room under Vercel’s 4.5 MB request limit. URL ingestion retains its 2 MB limit. Analysis and submission routes allow 300 seconds; a large run can still exceed this. Successful submission writes remain journaled; interrupted in-flight writes require reconciliation before retrying. A durable background workflow is needed for workloads that exceed the function duration.

Run `npm run check`, `npm run lint` and `npm run build` before deploying. After deployment verify unauthenticated redirects/API rejection, successful login, authenticated history/metadata reads and logout over HTTP. A live AI run and RightAnswers write are separate acceptance checks because they incur AI usage and change the KB.

Official references: [Function limits](https://vercel.com/docs/functions/limitations), [Turso client](https://docs.turso.tech/sdk/ts/reference), [Vercel GitHub integration](https://vercel.com/docs/git/vercel-for-github).
