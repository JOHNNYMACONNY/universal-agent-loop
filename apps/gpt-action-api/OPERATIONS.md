# GPT Action API Operations

## Production reconciliation visibility

Automatic Production reconciliation is exposed on the exact canonical commit through the GitHub commit-status context `production-runtime-reconcile`.

The status is `pending` while the matching `production-runtime-reconcile` GitHub Actions run is active and becomes `success` or `failure` when that exact run completes. Its target URL is the matching GitHub Actions run, so an autonomous operator can retrieve the exact job and logs without provider credentials or manual GitHub UI navigation.

This status is observability only. It does not add deployment, environment, secret, repository-settings, or billing authority.
