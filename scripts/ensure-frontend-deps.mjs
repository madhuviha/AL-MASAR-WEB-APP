import { spawnSync } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const allowedFrontends = new Set([
  'company-admin/frontend',
  'super-admin/frontend'
])
const requested = process.argv[2]?.replaceAll('\\', '/')

if (!allowedFrontends.has(requested)) {
  console.error('Choose one of the configured portal folders: company-admin/frontend or super-admin/frontend.')
  process.exit(2)
}

const frontend = resolve(projectRoot, requested)
const packageJson = resolve(frontend, 'package.json')
const packageLock = resolve(frontend, 'package-lock.json')
const modules = resolve(frontend, 'node_modules')
const installedLock = resolve(modules, '.package-lock.json')

if (!existsSync(packageJson) || !existsSync(packageLock)) {
  console.error(`The package files are missing from ${requested}. Re-clone the complete AL-MASAR repository.`)
  process.exit(2)
}

const installNeeded = !existsSync(resolve(modules, 'vite'))
  || !existsSync(resolve(modules, 'react'))
  || !existsSync(installedLock)
  || statSync(packageLock).mtimeMs > statSync(installedLock).mtimeMs

if (!installNeeded) {
  console.log(`${requested}: packages are ready.`)
  process.exit(0)
}

console.log(`${requested}: installing the locked packages for this laptop…`)
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const result = spawnSync(npm, ['ci', '--no-audit', '--no-fund'], {
  cwd: frontend,
  stdio: 'inherit',
  shell: process.platform === 'win32',
  windowsHide: true
})

if (result.error) {
  console.error(`Could not start npm: ${result.error.message}`)
  process.exit(1)
}
process.exit(result.status ?? 1)
