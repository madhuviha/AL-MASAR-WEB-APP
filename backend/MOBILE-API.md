# Mobile authentication and parent API

## Role model

The API uses the exact app role names `fleet` and `parent`. A user can have either role or both. The existing `auth_users.role` remains the fleet account's permission role (`super_admin`, `company_admin`, or `company_user`); parent access is granted separately in `auth_user_app_roles`. Existing accounts are backfilled during startup: parent accounts get `parent`, and other accounts get `fleet`.

## Login and switching

`POST /api/auth/login` keeps returning `token`, `user`, and `expiresAt`. It now also returns top-level `availableRoles`, `defaultRole`, and `activeRole`. `user` includes `accountRole`, `availableRoles`, `defaultRole`, and `activeRole`; its legacy `role` value is the effective authorization role for the issued token. The default is `fleet` when that role is granted, otherwise `parent`.

Browser portals send `X-Masar-Client: web-company`, `web-admin`, or `web-school`. Those requests receive an HttpOnly session cookie and a token-free JSON response. Native mobile clients should omit that header and continue using the bearer-token contract below. The server distinguishes the clients so the web hardening does not break the installed mobile apps.

Login attempt limits are enforced by the API for browser and mobile clients. The fleet endpoint (`POST /api/auth/login`) and School Bus endpoint (`POST /api/school/auth/login`) share one account counter: the first five requests in a 60-second window are processed normally, including successful sign-ins, and request six receives HTTP `429` with `{ "error": "too_many_login_attempts", "message": "Too many login attempts. Please try again after 1 minute." }` and a `Retry-After` header. The window resets 60 seconds after its first attempt. Mobile clients should display the server-provided `message` for this response.

To switch, send the current bearer token with:

```http
POST /api/auth/switch-role
Authorization: Bearer <current-token>
Content-Type: application/json
```

```json
{"role":"parent"}
```

The response contains a fresh `token`, `user`, `availableRoles`, `defaultRole`, `activeRole`, and `expiresAt`. The old token remains valid and keeps its original scope. Store/use the returned token for the selected mode. The server rejects unassigned roles.

## Account linking

Do not merge users automatically by email. If a school parent and fleet user are separate records, a Super Admin links them explicitly:

```http
POST /api/auth/link-parent-account
Authorization: Bearer <super-admin-token>
Content-Type: application/json
```

```json
{"companyId":7,"fleetUserId":100,"parentUserId":205,"confirmation":"LINK PARENT ACCOUNT"}
```

Both records must be active and belong to the stated company; the fleet record must be a company admin/user and the parent record must be a parent. The operation grants the parent role to the fleet identity, moves the child links and parent notification preferences, deactivates the separate parent identity, revokes its sessions and push tokens, and records an audit event. The parent signs in with the fleet account email/password and registers push notifications again. The response identifies the unified account and returns `pushRegistrationRequired` when needed.

## Parent endpoints

The existing `/api` endpoints remain supported. Equivalent short paths are also available for mobile clients:

- `GET /api/school/parent/dashboard` or `GET /school/parent/dashboard`
- `GET /api/school/children` or `GET /school/children`
- `GET /api/school/scans?limit=50` or `GET /school/scans?limit=50`
- `POST /api/push/register` or `POST /push/register`
- `POST /api/push/unregister` or `POST /push/unregister`
- `GET /api/school/children/:childId/bus-location` or `GET /school/children/:childId/bus-location`

All endpoints require a bearer token. Parent-mode queries are filtered on the server through `school_child_parents.parent_user_id`; client-supplied company or child IDs cannot widen access. The bus-location endpoint returns the assigned vehicle, GPS coordinates, GPS fix time, and packet-received time only after verifying that the requested child is linked to the signed-in parent. It returns `404` for an unlinked child and returns `gpsAvailable:false` with null coordinates when the bus has no usable fix.

Push tokens are registered with the active role. Parent-mode tokens do not receive general fleet alerts; child boarding/drop-off notifications continue to be queued to parent-linked accounts.

## Bearer-token retirement plan

Mobile bearer tokens remain supported during the mobile-app transition. Target retirement date: **2027-05-26**. The replacement mobile authentication flow and a minimum supported app version must ship by **2027-04-26**, followed by a 30-day adoption window. Do not disable bearer tokens on the target date unless the replacement app is published, adoption has been checked, and users have had a clear upgrade notice. No retirement behavior is enabled by this documentation change alone.
