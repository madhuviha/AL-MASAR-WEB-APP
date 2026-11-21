Hostinger live review release — 2026-11-21

This deployment is built from the deployment Git branch. It updates the
Company Admin and Super Admin static portals, compacts the Dashboard Vehicle
Status card while expanding its live map, adds the Login Contact Links settings
category while preserving current settings, and changes the School Bus admin
password minimum to four characters.

The backend changes are targeted edits against the exact live file versions
reviewed on Hostinger. The guarded script refuses unexpected file hashes and
keeps production-only rate-limit/security code intact. It backs up both web
roots and both backend files, restarts the two existing services, and verifies
the served pages and health endpoints. It does not run SQL or change the
database.

The release payload is assembled from the two successful frontend builds plus
this script. It must not include local database/tunnel files, credentials, or
the unrelated backend/server.js local-development changes.
