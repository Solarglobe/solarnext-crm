# CI/CD Branch Protection

Required GitHub branch protection for `main`:

- Require a pull request before merging.
- Require at least 1 approving review.
- Require status checks to pass before merging.
- Required check: `CI Green`.
- Require branches to be up to date before merging.
- Do not allow bypassing the above settings except repository admins during incident rollback.

Deployment is controlled by repository variables and secrets:

- `DEPLOY_ENABLED=true` activates deploy jobs on `main`.
- `DEPLOY_FRONTEND=vercel` activates the Vercel frontend deployment.
- `DEPLOY_BACKEND=vps` activates the VPS backend deployment.
- Required secrets when enabled: `PRODUCTION_DATABASE_URL`, `PRODUCTION_API_BASE_URL`, and the target-specific Vercel or VPS secrets referenced in `.github/workflows/deploy.yml`.
