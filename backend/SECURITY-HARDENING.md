# Security hardening notes

This change set hardens browser sessions and API responses across the Company Admin, Super Admin, and School Bus portals.

## Browser authentication

- Web sign-in no longer stores session tokens in local or session storage, sends them in `Authorization` headers, or places them in URLs.
- Browser sessions use host-only, `HttpOnly`, `SameSite=Lax` cookies. Production cookies are `Secure`; the separate admin, company, school, and support cookies prevent the admin and support flows from sharing the same session.
- Normal browser sessions expire after 12 hours by default. `WEB_SESSION_HOURS` controls that limit. “Remember me” lasts up to `SESSION_DAYS` (7 days by default, capped at 30). School and Super Admin logins use a session cookie unless the user selects “Remember me.” Support sessions expire after 15 minutes.
- Super Admin password sign-in supports an enrollment or verification challenge. `SUPER_ADMIN_MFA_REQUIRED` defaults to `false` until a second active Super Admin has enrolled and emergency reset has been rehearsed. During that staged period, Super Admins can sign in normally or choose **Set up authenticator now** to enroll before global enforcement; already-enrolled admins always use MFA. When required, the server creates no Super Admin session until TOTP or a one-time recovery code succeeds. TOTP secrets are encrypted with `SUPER_ADMIN_MFA_ENCRYPTION_KEY`, which must be set to a random 32-byte value in the server's secret store. Recovery codes are shown once and only hashes are stored. Existing Super Admin sessions are revoked when MFA is first enabled.
- TOTP enrollment and sign-in have a database-backed limit of eight attempts per Super Admin and IP in 15 minutes, in addition to the five-attempt challenge limit. Failed MFA and rate-limit events are audit logged without codes or secrets.
- `reset-super-admin-mfa.mjs` is an interactive emergency procedure. A different active Super Admin must authorize with a fresh TOTP code; the target's factor, recovery codes, challenges, and sessions are cleared in one transaction. It refuses to remove the last active MFA factor and records the authorizing and target user IDs.
- Unsafe requests carrying a session cookie require an exact allowed `Origin`; cross-site Fetch Metadata is rejected. CORS uses explicit origins and credentials.
- Login-as support now opens a same-origin `/support/` page and receives an HttpOnly support cookie. The session token is not returned to the browser JavaScript or placed in the page URL.

## API and account protections

- JSON API responses recursively remove password, hash, token, API key, secret, authorization, and credential fields. Sensitive assignment values in returned strings are redacted as well.
- Native mobile login and role switching still return bearer tokens so the existing installed apps keep working. Browser requests are token-free. Removing mobile bearer responses requires a coordinated native-app update.
- Fleet and School Bus login share the database-backed limit of five attempts per account per 60 seconds and a hashed-IP limit of 120 requests per 15 minutes. A second process-local limiter blocks repeated failures sooner. Retry responses include `Retry-After`.
- Login identifiers and passwords have request-size limits. Passwords continue to be stored as salted `scrypt` hashes and are checked with a constant-time comparison. The existing hash format is retained so current accounts do not need a password reset or migration.
- Existing server-side role and company-scope checks remain in place. The response redaction layer is an additional safety net.
- The recurring `migration-auth-app-roles.sql` now changes schema only. It no longer backfills app roles or rewrites active sessions at startup. Missing grants no longer imply fleet access. Account creation and explicit account-link actions grant roles, and role-changing actions are audited. Existing grants are preserved until an approved data migration.
- Both frontend build scripts explicitly disable source maps. The Super Admin development server is bound to loopback.
- The Company Admin frontend removes an unused vulnerable React Router dependency and pins ExcelJS's UUID dependency to the patched 11.1.1 release; its dependency audit is clean.

## Deployment requirements

Use two gated releases. **Release 1** is the backend and Super Admin portal MFA/cookie work, exact-origin rejection, HSTS and CSP Report-Only proxy configuration, plus the reviewed School Bus role-constraint repair. **Release 2** contains data migrations only after its preflight reports have been reviewed, together with a schema guard that blocks hard company deletion from cascading into or detaching related records. Before either release, create a production backup and complete a restore drill in an isolated database. No migration is run against production before the backup and restore are proven.

Deploy the backend and Super Admin frontend together before setting `SUPER_ADMIN_MFA_REQUIRED=true`; older Super Admin pages cannot complete MFA. Keep the flag off until a second active Super Admin is enrolled and the reset procedure is rehearsed. Company Admin and School Bus continue to use their existing cookie sign-in flow. The portals use same-origin API paths, so the live reverse proxy must send `/inviha-api/` and `/school-api/` to the matching APIs and preserve `X-Forwarded-Proto: https`. Set `NODE_ENV=production`, `SUPER_ADMIN_MFA_ENCRYPTION_KEY`, `ALLOWED_ORIGINS`, and `SCHOOL_ALLOWED_ORIGINS` in the server secret store. The two origin lists must contain comma-separated exact HTTPS origins; production startup rejects missing, wildcard, or HTTP entries.

The HTML pages no longer enforce CSP through meta tags. The Nginx example uses `Content-Security-Policy-Report-Only` and sends reports to `/inviha-api/api/security/csp-report`; the receiver records only a directive and URL origins, omitting paths, samples, and credential values. This lets the team review violations before enforcement. `connect-src https:` remains intentionally broad for configurable map/geocoder integrations; narrowing it requires an explicit provider allowlist or moving providers behind same-origin APIs.

The School Bus schema check is in `release1-school-schema-check.sql`. The explicit schema-only role constraint repair is in `migration-school-admin-role.sql`; it is not executed at application startup and stops if it finds an unexpected role value. The root cause of the live account-creation failure is still unverified until the production constraint and server error code are checked. The read-only vehicle duplicate, role-grant, and company foreign-key reports are in `release2-preflight-reports.sql`; run them only after a verified backup and restore. `migration-company-delete-restrict.sql` changes direct company foreign-key delete actions to RESTRICT without modifying rows, so a hard delete fails while related records exist instead of cascading or detaching them.

The mobile bearer-token retirement target is **2027-05-26**, tied to a replacement mobile authentication flow and minimum supported app version due **2027-04-26**. Keep bearer authentication enabled until the updated app is published and adoption is checked; the date is a rollout target, not an automatic server cutoff.

The browser-to-API flow assumes the API is reverse-proxied under the portal hostname. Support login also assumes the Super Admin and `/support/` page share that hostname so the host-only support cookie can be used.

## Verification and remaining boundary

The added security tests cover cookie flags and separation, request-origin checks, token-free browser clients, IP/account throttling, sensitive-value redaction, schema-only role migration, report-only CSP configuration, and the second-admin emergency reset guard.

Native bearer tokens remain visible to the native application because the mobile client contract is still active. Passwords must also be submitted to the sign-in endpoint; an account owner can inspect their own browser’s request in developer tools. The application does not store or log the submitted password.

The HTML export path was reviewed: displayed report values and brand text pass through HTML escaping, and vehicle SVG markup comes from fixed templates selected by a finite category lookup. React-rendered user text remains escaped by React. Custom inline styles remain allowed by the report-only CSP for the current UI. Production HTTPS redirects, Nginx headers, the live `/school-api/` upstream, and actual production origin values must still be checked on the Hostinger host before release; source configuration is not proof of live deployment.
