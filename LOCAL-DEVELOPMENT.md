# Open Masar locally in VS Code

## What this folder starts

Open this repository folder, or `INVIHA-TRACK.code-workspace`, in VS Code. After you allow the folder's automatic tasks, VS Code starts both local web portals and installs their locked npm packages the first time they are needed:

- Company and School Bus portal: <http://127.0.0.1:5177/> (School Bus: `/schoolbus`)
- Super Admin portal: <http://127.0.0.1:5178/admin/>

The pages run on your laptop. API requests are securely proxied to the live Hostinger services at `https://track.almasar.qa`; the fleet and School Bus API paths stay separate. This setup does not start another API server, database, or DigitalOcean tunnel.

## Important: this uses live data

Signing in and using the local pages calls the production backend. Creating, editing, importing, or deleting records here changes live data. Use the local pages for UI checks and only make data changes when you intend to update production.

The repository includes the non-secret API address defaults and `.env.example` files. Do not put passwords, database URLs, private keys, or production tokens in GitHub. Any private machine-only settings belong in an ignored `.env.local` file and should not be copied into a commit.

## Set up another laptop

1. Install Git, Node.js (the version in `.nvmrc`, or a compatible current LTS), and VS Code.
2. Clone the source repository: `https://github.com/madhuviha/AL-MASAR.git`.
3. Open the cloned `AL-MASAR` folder in VS Code. You can also open `INVIHA-TRACK.code-workspace` from inside it.
4. If VS Code asks, trust this project and allow its automatic tasks. The two portal terminals should start; the first start may take a few minutes while packages install.
5. Open the local links above. Sign in with the normal account for the portal; credentials are not stored in this repository.

On future days, open the folder and wait for both Vite tasks to report their local addresses. If automatic tasks are disabled, use **Terminal → Run Task** and start `Masar: Company and School Bus Portal` and `Masar: Super Admin Portal`.

## Keep the laptops and GitHub in sync

Before working on a different laptop, pull the latest `main` branch in VS Code's Source Control view. After reviewing your changes, commit and push them to `main`. Do not copy the live server's generated files or secret environment files into the source repository.

## Troubleshooting

- If VS Code does not start the portals, run the two tasks listed above manually.
- If a portal reports its port is already in use, close the old portal terminal or reload the VS Code window once.
- If package installation fails, check that Node.js and npm are installed and that the laptop has internet access, then rerun the task.
- If API requests fail, check that `https://track.almasar.qa` is reachable and that the signed-in account has access. Local API proxy defaults are in each portal's `vite.config.js`; machine-only overrides can be kept in its ignored `.env.local`.
