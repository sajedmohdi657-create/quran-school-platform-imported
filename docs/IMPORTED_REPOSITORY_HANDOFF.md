# Imported Repository Baseline and Handoff

## Purpose

This document records the state of the imported QuranOS repository after its transfer to the new GitHub account. It is an operational handoff, not a claim that production deployment or all tests have been completed.

## Repository identity

- Repository: `sajedmohdi657-create/quran-school-platform-imported`
- Default branch: `main`
- Baseline commit inspected on 2026-11-12: `acc5b53d31e099edbf23d7abc5f0bb6ff3574517`
- The imported repository's `main` tree and commit were previously compared with the source repository and found identical at the time of import verification.
- The source repository and the separate empty repository named `quran-school-platform` were intentionally left untouched.

## Application stack and local commands

The current `package.json` identifies the project as an ESM React/Vite/TypeScript application and pins pnpm 10.4.1.

Useful commands defined by the repository:

```bash
pnpm install --frozen-lockfile
pnpm dev
pnpm test
pnpm test:runtime
pnpm check
pnpm build
```

The `build` script runs the Node test suite, runtime tests, TypeScript checking, Vite production build, and `git diff --check`. Several additional migration and Edge Function validation scripts are defined in `package.json`.

Required browser-side Supabase configuration is documented in `.env.example`. Never commit service-role keys, database passwords, access tokens, or other secrets.

## Database migration inventory

- The imported repository contains migration SQL files through `supabase/084_attendance_transactional_sync.sql`.
- The repository includes subscription-related migrations `082` and `083`, followed by attendance migration `084`.
- The last production-applied migration recorded in the project handoff context is `084`. This was not independently queried from the live production database during the repository import review.
- Do not replay migrations against production or assume that repository presence means a migration has been applied.
- In particular, validate migrations `085` and `086` against the intended PostgreSQL version and a disposable local database before considering production rollout.

## GitHub Actions and repository settings

- At the time of this review, the imported repository returned zero workflow runs. This means no post-import Actions run had been recorded; it does not mean the workflows passed.
- Workflow definitions are present under `.github/workflows`, including launch-readiness, subscription migration, guardian notification, and absence-notification validation.
- Some workflows are manual-dispatch or pull-request triggered. A workflow file existing in the repository is not evidence that it has executed.
- The `main` branch was reported as unprotected by the GitHub API during this review. Consider enabling branch protection and required checks after the first reliable CI run is established.
- GitHub Importer does not guarantee transfer of Actions secrets, environments, webhooks, deployment configuration, or external integration permissions. These must be reviewed and recreated separately where required.
- Do not add secrets to repository files or expose them in logs.

## Known documentation gap

The existing README still describes the database as if the project stopped at migration 015 and lists a limited earlier application scope. That description is stale relative to the current migration inventory and recent project history. Update the README only after verifying the current routes, deployment configuration, and production database state.

## Safe next steps

1. Confirm the new repository's Actions settings and required permissions in GitHub.
2. Add required CI secrets/environments only after identifying the exact workflow requirements; do not copy credentials into source files.
3. Run a low-risk, non-production validation workflow first, then the full application and PostgreSQL migration suites.
4. Review any failed job's runner allocation, steps, and logs separately. A job that never starts is not a code-test failure and is not a successful test.
5. Verify Supabase project linkage and migration history read-only before planning any deployment.
6. Keep the original repository intact until the new repository's CI, deployment, and integrations are confirmed.

## Review status

This handoff records repository metadata and source files inspected on 2026-11-12. No production database migration, secret change, paid resource creation, deployment, or destructive repository action was performed as part of this review.
