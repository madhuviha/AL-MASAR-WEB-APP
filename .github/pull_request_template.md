## What changed and why

Describe the reason, affected source files, and any user-visible change. State explicitly if an exploratory fix was reverted.

## Mandatory fleet-status check

See `backend/TRACKING-STATUS-INCIDENT-2026-11-27.md` for the cause and full release gate.

- [ ] Automated tracker-date contract passed; `last_update` and `position_time` are date strings, and secrets remain redacted.
- [ ] A recent and an old vehicle were checked against tracker Last Seen and diagnostics.
- [ ] Super Admin, Company Admin, and supported Android status labels were checked after deployment, or the reason this was not applicable is recorded.
- [ ] Existing portal layouts were visually reviewed; any UI change was requested and is listed.
- [ ] Backup, restore proof, backend/portal compatibility, live health, and rollback path were recorded for a production release.
- [ ] Security controls and data migrations are described as deployed, verified, or pending separately.
