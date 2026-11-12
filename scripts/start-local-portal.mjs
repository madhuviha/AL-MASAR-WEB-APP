import { spawn, spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const portals = {
  company: { folder: 'company-admin/frontend', port: '5177', url: 'http://127.0.0.1:5177/' },
  'super-admin': { folder: 'super-admin/frontend', port: '5178', url: 'http://127.0.0.1:5178/admin/' }
}
const portal = portals[process.argv[2]]

if (!portal || process.argv[3] !== portal.port) {
  console.error('Usage: node scripts/start-local-portal.mjs company 5177 | super-admin 5178')
  process.exit(2)
}

console.log('LIVE API MODE: this local page reads and saves data through https://track.almasar.qa.')
console.log('Changes made here affect live fleet or school data.')

const node = process.execPath
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const prepare = spawnSync(node, [resolve(root, 'scripts/ensure-frontend-deps.mjs'), portal.folder], {
  cwd: root,
  stdio: 'inherit',
  windowsHide: true
})

if (prepare.error) {
  console.error(`Could not prepare this portal: ${prepare.error.message}`)
  process.exit(1)
}
if (prepare.status !== 0) process.exit(prepare.status ?? 1)

const child = spawn(npm, ['run', 'dev', '--', '--host', '127.0.0.1', '--port', portal.port], {
  cwd: resolve(root, portal.folder),
  stdio: 'inherit',
  shell: process.platform === 'win32',
  windowsHide: true
})

let stopping = false
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    if (stopping) return
    stopping = true
    child.kill(signal)
  })
}

child.on('error', error => {
  console.error(`Could not start the ${portal.folder} development server: ${error.message}`)
  process.exitCode = 1
})
child.on('exit', (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0)
})
