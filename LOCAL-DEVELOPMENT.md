# Local Development and Deployment Workflow

## Start after a laptop restart

Open this project folder (or `INVIHA-TRACK.code-workspace`) in VS Code. The workspace automatically starts the fleet backend, both web portals, and the database tunnel through the `Start all local servers` task. It also starts the School Bus API when a safe local development database is configured; otherwise that task skips it safely.

1. Database tunnel
2. Backend
3. Company User frontend
4. Super Admin frontend

If VS Code asks to allow automatic tasks, choose **Allow**. You can also run **Tasks: Run Task → Start all local servers** manually.

For a manual fallback, use these commands:

### Database tunnel terminal

```powershell
ssh -N -o ServerAliveInterval=30 -o ExitOnForwardFailure=yes -L 15432:127.0.0.1:5433 -L 18082:127.0.0.1:8082 root@134.122.92.105
```

### Backend terminal

```powershell
cd "C:\Users\madhu\Documents\Codex\2026-09-14\hey\work\release-baseline-vehicle-modal-v12\backend"
$env:ALLOWED_ORIGINS="http://127.0.0.1:5177,http://127.0.0.1:5178,http://localhost:5177,http://localhost:5178"
npm.cmd start
```

Wait for `INVIHA backend listening on http://127.0.0.1:3001`.

### Separate School Bus API (manual start)

The School Bus portal sends its requests to port `3002`; it does not send its school data traffic through the fleet API on port `3001`. The Super Admin development portal proxies `/school-api` to this service too.

School records currently use the same PostgreSQL database as fleet records. The separate School API process and its bounded pool isolate HTTP request handling, but database CPU and I/O are still shared. Full database-level isolation requires a dedicated school database or read replica before high-volume parent usage.

For local development, copy `backend/.env.school.local.example` to `backend/.env.school.local` and set an isolated, non-production PostgreSQL clone containing the core fleet tables the School API reads (`companies`, `auth_users`, `vehicles`, and linked tracker records). The API and migration command accept loopback database hosts only; they never fall back to the shared workspace tunnel or a production database.

```powershell
cd "C:\Users\madhu\Documents\Codex\2026-09-14\hey\work\release-baseline-vehicle-modal-v12\backend"
$env:SCHOOL_DEV_DATABASE_URL="postgres://USER:PASSWORD@127.0.0.1:5432/masar_school_dev"
npm.cmd run migrate:school
npm.cmd run start:school:local
```

After the local clone is configured and migrated, opening this VS Code folder starts the School API automatically on port `3002`. To start only its development server manually, run `npm.cmd run start:school:local` from `backend`. The API verifies that the school schema already exists and exits if it has not been migrated. Tracker positions use a short shared cache.

### Company User frontend terminal

```powershell
cd "C:\Users\madhu\Documents\Codex\2026-09-14\hey\work\release-baseline-vehicle-modal-v12\company-admin\frontend"
npm.cmd run dev -- --host 127.0.0.1 --port 5177
```

Open `http://127.0.0.1:5177/`.

### Super Admin frontend terminal

```powershell
cd "C:\Users\madhu\Documents\Codex\2026-09-14\hey\work\release-baseline-vehicle-modal-v12\super-admin\frontend"
$env:VITE_PROXY_TARGET="http://127.0.0.1:3001"
npm.cmd run dev -- --host 127.0.0.1 --port 5178
```

Open `http://127.0.0.1:5178/admin/`.

## Important rules

- Do not start a second backend if port 3001 is already in use; the backend is already running.
- Port 5177 is the Company User / School Bus portal. Port 5178 is the Super Admin portal.
- Port 3001 serves fleet API requests. Port 3002 serves School Bus API requests.
- Test all edits locally before deployment. Keep the backend and both frontend terminals running while testing.
- The local demo company account is `demo.admin@example.com` with password `DemoFleet@2026`.
- The Super Admin account is used only at port 5178.

## Check a port

```powershell
Get-NetTCPConnection -LocalPort 3001,5177,5178 -State Listen -ErrorAction SilentlyContinue |
  Select-Object LocalPort,OwningProcess
```

## Safe edit and deployment flow

1. Edit source files in the repository.
2. Restart the affected local frontend if needed.
3. Test both portals and the changed feature locally.
4. Run the project build for the frontend you changed:

```powershell
npm.cmd run build
```

5. Review the build output and changes before deployment.
6. Deploy only after local testing passes, using the repository deployment script or the approved deployment procedure.
7. Check the live site after deployment and keep a backup of the previous live release.

## Recovery after a crash

- Reopen the repository folder in VS Code.
- Start the three terminals using the commands above.
- If a port is occupied, reuse the running process or stop only the process shown by `Get-NetTCPConnection`.
- Your source edits remain in the repository; do not reset or delete the worktree when recovering.
