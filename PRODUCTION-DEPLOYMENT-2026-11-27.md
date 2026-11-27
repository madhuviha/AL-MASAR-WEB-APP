# Production deployment record — Google Maps permissions

Date: 2026-11-27 (UTC)

## Change

PR #4, “Restore user-permitted Google map choices,” was merged to `main` at commit `0bbfed92f69903a1c26a92d65cd8259516134c34`.

That code change removes three hard-coded assignments that forced Google Road, Satellite, and Hybrid off after the application calculated the user's and global map permissions. Google map choices remain subject to those permissions and the configured Google Maps browser key.

## Live deployment

The live backend at `/opt/inviha-backend/server.js` was updated with only those three assignment removals. The deployment backed up the prior file before editing it. No frontend bundles, School Bus files, or MFA settings were changed.

The backend service was restarted. One health request immediately after restart could not connect while the process was coming up; a later retry succeeded. Final checks reported the service active and `/health` returned `ok: true` with release `v4`.

## Operational note

Do not treat one failed health request immediately after restart as a failed release. Wait for the service to finish starting and retry health checks for a bounded period before rolling back. The live backend directory is not a Git checkout, so this deployment did not add a commit marker to the live health response. The merged PR remains the source-of-truth code change; this file records the production action and verification.
