import { spawnSync } from 'node:child_process'
import electron from 'electron'

// Match the runtime used to rebuild better-sqlite3, without starting a GUI.
for (const file of [
  'out/tests/shared/money.test.js',
  'out/tests/main/database/quotes.test.js',
  'out/tests/main/sync/sync.test.js'
]) {
  const result = spawnSync(electron, [file], {
    stdio: 'inherit',
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
  })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}
