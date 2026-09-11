# Knowledge Studio

Create, improve and merge RightAnswers knowledge articles through Content → Check → Metadata → Submit.

```sh
npm install
npm run dev
```

Development binds to `127.0.0.1:3000`. RA credentials (`RA_BASE_URL`, `RA_COMPANY_CODE`, `RA_USERNAME`, `RA_PASSWORD`) and `OPENAI_API_KEY` come from `.env`. Run `npm run setup:ca` if the corporate certificate needs to be installed for this workspace.

Open **http://127.0.0.1:3000/flow** for the interactive engine explorer. **Explore engine flow** in the wizard opens it with the current source/operation choices and run ID. It includes decision branches, exact prompt-builder examples, schemas, Mermaid export, and recorded AI activity. Exploring a scenario never calls AI or writes to the KB.

- [Optional autonomous pipeline and Node worker](docs/autonomous-pipeline.md)
- [Engine behavior, diagram and recovery guide](docs/engine-guide.md)
- [Guided Mermaid tree](docs/knowledge-studio-flow.mmd)
- [Autonomous Mermaid tree](docs/knowledge-studio-autonomous-flow.mmd)
- [Original implementation review](docs/implementation-review-2026-09-09.md)
- [Fixes mapped to the review](docs/review-fixes-2026-09-09.md)

## Access

Sign in at `/login` using the server-only environment values:

```dotenv
KS_AUTH_USERNAME=admin
KS_AUTH_PASSWORD=your-long-unique-password
AUTH_SECRET=your-random-secret-at-least-32-characters
AUTH_TRUST_HOST=true
KS_AUTH_RA_USER=sauser
```

The local `.env` contains generated credentials. `.env.example` lists the required settings without secrets. Never prefix these settings with `NEXT_PUBLIC_`. Generate a session secret with `openssl rand -base64 48`.

The [NextAuth Credentials provider](https://authjs.dev/getting-started/authentication/credentials) handles sign-in and sign-out with encrypted, HTTP-only cookie sessions lasting eight hours. Next.js `proxy.ts` protects app pages and API routes; APIs also verify the session themselves. Invalid or expired sessions receive an API 401 or a redirect to `/login`. Credentials stay out of browser storage. Changing the username, password, author mapping or session secret invalidates old sessions.

`KS_AUTH_RA_USER` is the RightAnswers impersonation identity and run owner; keeping `sauser` preserves access to existing pilot history. This shared login is not RightAnswers SSO. The legacy `KS_USERS_JSON` Basic API mode remains available only when no new login settings are configured; it cannot bypass a configured login.

### Vercel environment

Add the five variables above to the appropriate Vercel environments, together with the existing RA and OpenAI credentials. Keep `AUTH_SECRET` stable across instances of an environment. Set `AUTH_URL` and `KS_PUBLIC_ORIGIN` to your exact public HTTPS URL for a fixed custom domain; leave them unset for automatic Vercel preview-host handling. Redeploy after environment changes. See [Vercel deployment](docs/vercel-deployment.md) for the complete setup.

Authentication uses stateless sessions. On Vercel, configure `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` for a remote libSQL database. Run history, decisions, audit, locks and write state share that database across instances. The app refuses to use a local database on Vercel.

## Persistence and writes

Without Turso settings, local development uses `.data/knowledge-studio.db`; `KS_DB_PATH` selects another file. Keep it on persistent local storage. Schema additions preserve existing runs/audit rows. Runs predating the source-identity fix cannot be submitted; restore their sources and analyze them again.

Selections, source provenance, templates, survivor choices, operation flags, standards, collection and language are saved as one snapshot. Submission freezes its plan. Conflicts and incomplete fields pause before the affected write. Retries reuse prepared content and successful operations. Uncertain responses require explicit reconciliation with RightAnswers before another write.

New solutions use review status. Published parents use revisions; existing non-live drafts can be edited in place. An unrelated pending revision blocks an update. Merge losers receive internal comments after their own survivor succeeds. Nothing is archived or published by Knowledge Studio.

AI traces store prompts, responses, models/tokens and estimated costs, including submit-time authoring. These contain source content and should be treated like drafts. Configured prices provide estimates, not billing reconciliation.

## Verification

```sh
npm run check   # TypeScript and contract/unit tests
npm run lint
npm run build
```

Tests use isolated temporary databases and mocked external services. `submit-smoke` can write to the configured RA tenant; it is not a standard check. Browser automation is not used in this workspace.

Completed and partial runs offer **Open executed engine flow**. Use **Past executions** in `/flow` to revisit saved decisions, exact prompts and write outcomes. Snapshots persist in the database’s `flow_executions` table; access is scoped to the run owner.
