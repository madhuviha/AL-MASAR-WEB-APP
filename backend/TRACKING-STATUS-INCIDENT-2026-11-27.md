# Fleet status incident: 26–27 November 2026

## Impact and root cause

After the 26 November security rollout attempts, recently reporting vehicles could show **Not Tracked Yet** in the fleet portals and Android app, although tracker inventory and diagnostics still showed recent packets and Last Seen times. This affected a core customer function.

The defect was introduced in commit `3d778cd` (`backend/security-controls.mjs`). Its API response redaction recursively copied ordinary objects, but treated JavaScript `Date` instances as objects with no enumerable properties. Consequently `last_update`, `position_time`, and other dates became `{}` in `/inviha-api/api/vehicles`. The clients could not parse those values and fell into their never-tracked classification. The redaction change had tests for removing secrets but no test asserting that tracker dates survived. A backend health check still returned OK, so it did not detect the broken response contract.

This was an application response bug. The read-only tracker linkage check found that the linked device IDs and IMEIs matched, and recently reporting devices had fresh tracker database timestamps. The UI labels were symptoms of the malformed API dates.

## What changed

| Date | Change | Result |
| --- | --- | --- |
| 26 November | `3d778cd` prepared MFA, cookie sessions, origin/CSRF controls, response redaction, security configuration, and migration materials. | The response filter introduced the date regression. The security work has staged release requirements; a Git commit alone does not prove every feature is live. |
| 26–27 November | A Company Admin session reload fix was deployed after repeated 401 responses caused page reloads. | The deployed fix keeps the existing layout and handles session expiry without a reload loop. Its source is included in this review branch. |
| 27 November | `e780d28` tried backend tracker timestamp fallbacks. | They did not fix the root cause and were removed by `8a897e8`; the net review diff contains no `backend/server.js` tracker fallback. |
| 27 November | `27c6a1c` reconciled Super Admin status against the linked tracker inventory's freshest Last Seen time. | The user confirmed Super Admin status corrected; no layout or stylesheet change was made. |
| 27 November | `8a897e8` changed redaction to serialize valid `Date` values as ISO strings and invalid dates as `null`, with a regression test that also checks credential removal. | The live backend returned date strings again. The user confirmed recent vehicles showed correct status in Company Admin and Android, including after the unused fallbacks were removed. |

The production cleanup reported an active backend and an OK `/health` response. The user confirmed the final vehicle labels in Company Admin and Android. These are point-in-time checks, not continuous monitoring. Some vehicles with genuinely old or missing tracker updates should remain offline or untracked.

## Mandatory release gate for future changes

For **every change to backend response shaping, security redaction, vehicle API fields, tracker status logic, or any portal/mobile status display**:

1. Run the automated tracker-date contract test in `backend/tests/security-controls.test.mjs`; it must prove `last_update` and `position_time` are parseable ISO strings, not `{}`, while password and token fields stay removed.
2. Review a representative `/inviha-api/api/vehicles` response from a signed-in test account. Check recent and old vehicles separately; never share the full response or credentials in a ticket.
3. Check at least one recently reporting vehicle in Super Admin, Company Admin, and the supported Android build. Its status must match tracker Last Seen and diagnostics. Check an old/offline vehicle as the negative case.
4. Run affected tests and builds, review the UI visually without replacing existing layouts, and record results in the PR and release notes.
5. Back up production before a deploy, verify the restore path, deploy the reviewed backend and compatible portal builds together, then repeat the API and three-client checks. Stop or roll back if any client shows a mismatch.

The GitHub workflow in `.github/workflows/tracking-contract.yml` runs the automated regression on pull requests to `main`. To make that check impossible to skip, a repository administrator must also add **Tracking API contract / tracker-date-contract** as a required status check in the `main` branch protection or ruleset. Manual live checks cannot be enforced by CI and must be signed off in each release note.

## Release status and remaining work

This incident fix does **not** approve or run the proposed data migrations. School Bus account creation remains a separate issue. The production MFA requirement was left off while the sole Super Admin has not completed the staged enrollment and recovery proof. HSTS, CSP Report-Only, Secure cookie behavior, exact production origins, and the complete coordinated security release still require independent live verification; failed deployment attempts and a healthy API response are not proof of those controls. Do not mark them complete based on this status repair.

No production credentials, session tokens, or database rows are included in this note.
