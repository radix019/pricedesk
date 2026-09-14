# PriceDesk API on Ubuntu EC2

These are preparation instructions, not an executed deployment. The Electron app,
its database and its packaging are separate. Run one API process against one SQLite
file on an EBS-backed filesystem; do not put the file inside a release directory.

## Runtime and build

Use a maintained Node.js 22 patch release, **22.16.0 or newer**. This change was
tested with **Node 22.21.0 and pnpm 11.18.0**. Node's built-in `node:sqlite` avoids
Electron native modules. The minimum increased from 22.13 because the
[SQLite backup API](https://nodejs.org/api/sqlite.html#sqlitebackupsourcedb-path-options)
was added in 22.16; Node 22 still prints an experimental SQLite notice.
[pnpm 11 supports Node 22](https://pnpm.io/installation#compatibility).

Install a supported Node runtime system-wide on EC2. Verify `/usr/bin/node --version`
before using the service; Ubuntu's default Node package may be too old. If the binary
is installed elsewhere, change `ExecStart` and the backup commands to that absolute
path. systemd does not source an interactive shell or an nvm profile. Install the
tested script runner with `npm install --global pnpm@11.18.0` on the build host.

From a clean repository checkout, run:

```bash
node --version
pnpm --version
npm ci --prefix server
pnpm --dir server run typecheck
pnpm --dir server run test
pnpm --dir server run build
```

`server/package-lock.json` remains the dependency lock: npm installs from it and
pnpm runs the scripts. Do not run root `pnpm install` on EC2: the root package has
Electron dependencies and a native rebuild hook. No root dependencies are needed
to build the server. If the desktop development dependencies are already installed,
`node_modules/.bin/eslint server/src` runs the repository's lint rules.

The server imports `src/shared/money.ts` and `src/shared/sync.ts` from the repository
root. Include those files and the server sources in the **build checkout**. The build
cleans only `server/dist` and excludes test files; it emits both the server and shared
modules. The resulting release needs only:

```text
/opt/pricedesk-api/releases/<release>/server/
  package.json
  package-lock.json
  dist/server/src/*.js
  dist/src/shared/*.js
  node_modules/                 # install with the command below
```

In that release's `server/` folder, use `npm ci --omit=dev --ignore-scripts` to install
only runtime dependencies. Preserve the entire `dist` layout. Do not copy databases,
backups, environment files, or the Electron package into releases. Keep releases
owned by the deployment administrator and readable but not writable by the API user.

After setting the production environment, the start commands are equivalent:

```bash
pnpm run start
node dist/server/src/index.js
```

The systemd service uses Node directly, so pnpm is optional on the runtime machine.

## Environment and persistent data

Copy [`.env.example`](.env.example) to `/etc/pricedesk/api.env` on EC2 when deploying:

```dotenv
NODE_ENV=production
HOST=127.0.0.1
PORT=4317
DATABASE_PATH=/var/lib/pricedesk/pricedesk.sqlite
```

The application does not automatically load `.env`. systemd loads its EnvironmentFile;
for a foreground production start use:

```bash
/usr/bin/node --env-file=/etc/pricedesk/api.env dist/server/src/index.js
```

- `PORT` accepts decimal integers 1–65535. `HOST` accepts an IP address; production
  deliberately rejects any bind other than `127.0.0.1`.
- `DATABASE_PATH` defaults to the path above in production and must be absolute.
  Keep any override outside releases, on persistent storage. The supplied service
  grants write access only to its `/var/lib/pricedesk` state directory.
- Development retains `data/pricedesk-api.sqlite` relative to the working directory.
  Existing `PRICEDESK_API_PORT` and `PRICEDESK_API_DB` settings remain supported;
  `PORT` and `DATABASE_PATH` take precedence when provided.
- Electron defaults to `http://13.204.88.45:4317`. Set `PRICEDESK_API_URL` in the
  desktop process environment to override it; server `HOST` and `PORT` control
  the server listener, not the desktop destination.

No existing file is moved, deleted or reset on startup. An absent database is created
and migrated before HTTP begins listening. Existing schema version 1 is opened without
taking a migration write lock. Older schemas migrate in a `BEGIN IMMEDIATE` transaction,
with a version recheck after acquiring the lock; failure rolls back partial changes.
A newer schema or invalid database fails startup. A 5-second busy timeout bounds lock
waits. Repeated startup failures are rate-limited by systemd. Investigate the logs and
competing writers instead of deleting the file. The API has **no seed data**.

Do not substitute the Electron SQLite database: it has a different schema. To move an
existing backend database to EC2 later, use a verified backup and a planned restore
while the service is stopped. Simply starting at an empty new path creates an empty API.

## Dedicated systemd service

[`deploy/pricedesk-api.service`](deploy/pricedesk-api.service) runs as `pricedesk-api`,
uses `/opt/pricedesk-api/current/server`, and creates `/var/lib/pricedesk` with mode
0700 using `StateDirectory`. `UMask=0077` and the application umask restrict new files.
The service cannot write releases or read user home directories; it receives no Linux
capabilities and cannot gain privileges. Logs go to the journal.

The following are **future EC2 setup commands**, not commands run by this change.
Create the dedicated account only if it does not already exist:

```bash
sudo useradd --system --user-group --home-dir /var/lib/pricedesk --no-create-home --shell /usr/sbin/nologin pricedesk-api
sudo install -d -o root -g pricedesk-api -m 0750 /etc/pricedesk
sudo install -o root -g pricedesk-api -m 0640 server/.env.example /etc/pricedesk/api.env
sudo install -m 0644 server/deploy/pricedesk-api.service /etc/systemd/system/pricedesk-api.service
```

Review any existing environment file before copying over it. After building a release,
point `/opt/pricedesk-api/current` at that release. Verify the Node binary, directory
permissions and environment, then start and check it:

```bash
sudo systemd-analyze verify /etc/systemd/system/pricedesk-api.service
sudo systemctl daemon-reload
sudo systemctl enable --now pricedesk-api
sudo systemctl status pricedesk-api
sudo journalctl -u pricedesk-api -n 100 --no-pager
curl --fail http://127.0.0.1:4317/health
```

`SIGTERM`/`SIGINT` stop accepting requests, drain active requests, then close SQLite.
Repeated shutdown requests share one promise. After 15 seconds, incomplete HTTP
connections are closed so shutdown can finish before systemd's 30-second limit.
Requests synchronously committed before a lost response retain their receipt and can
be retried with the same operation UUID. Bind failures close the opened database.

For a later release, back up first, stop the service, switch the `current` symlink and
start it again. Do not overlap old and new processes during migrations. Code rollback
is possible only when the older code supports the installed schema version; never
downgrade a schema or restore an old backup over newer uploads automatically.

## Reverse proxy and authentication assessment

Terminate HTTPS at a reverse proxy on the same EC2 host, forwarding to
`http://127.0.0.1:4317`. Keep port 4317 closed in the EC2 security group. For Nginx,
the following belongs in the intended, authenticated TLS virtual host's location:

```nginx
location / {
    proxy_pass http://127.0.0.1:4317;
    proxy_set_header Host $host;
    client_max_body_size 512k;
    proxy_connect_timeout 5s;
    proxy_read_timeout 30s;
}
```

This snippet supplies **neither TLS certificates nor authentication**. The API leaves
Express `trust proxy` disabled because its routes do not need forwarded client identity.

Current endpoint assessment:

| Endpoint       | Authentication today | Exposure consequence                                                                 |
| -------------- | -------------------- | ------------------------------------------------------------------------------------ |
| `GET /health`  | None                 | Returns only `{"status":"ok"}` after a database probe; keep internal where possible. |
| `POST /quotes` | None                 | Any caller who can reach it can submit draft quotes and consume storage.             |

There are no quote read/list/update/delete HTTP endpoints. Validation, recalculated
integer totals, UUID uniqueness and payload hashes provide integrity and duplicate
handling, **not authentication or authorization**. Prices remain client-supplied draft
snapshots. Receipts and quote IDs are global; there is no account, device or tenant scope.
Someone with an existing UUID and identical payload can replay its acknowledgement.

Before public access, provide authenticated access at the reverse proxy (for example,
per-device mutual TLS), or implement application authentication and authorization.
Use a private network/VPN until that is ready. Do not put a shared long-lived secret
in the Electron bundle. Desktop HTTPS endpoint and credential handling require a
separate client change; this task intentionally preserves the existing HTTP contract.
In particular, the current sync worker treats 401/403 as permanent failures, so plan
credential refresh and retry behaviour before adding authentication to a live client.

## SQLite-consistent online backups

The new `backup` command uses Node's SQLite **online backup API**, not a file copy.
It opens the source read-only, never migrates it, and fails if it is missing. It captures
committed data, including WAL contents, into a unique timestamped private directory,
checks SQLite integrity and foreign keys, then publishes `pricedesk.sqlite` inside it.
It never overwrites an earlier backup and removes its incomplete output on failure.

Run on EC2 as the API user (the service may remain running):

```bash
sudo -u pricedesk-api /usr/bin/node --env-file=/etc/pricedesk/api.env /opt/pricedesk-api/current/server/dist/server/src/backup.js /var/lib/pricedesk/backups
```

The command prints the completed file path and exits nonzero on failure. For an
already-configured shell in the release's `server/` folder, the equivalent is:

```bash
pnpm run backup /var/lib/pricedesk/backups
```

Copy **that completed backup** to your managed off-instance backup destination;
keeping it only on the EC2 volume does not protect against loss of the volume.
Schedule the command and apply retention after verifying off-instance copies. The
command performs no pruning. Never copy just the live `.sqlite` file while writers
are active, and never independently copy its WAL/SHM files as an online backup.

Test a restore to a separate temporary path first: open the backup with `node:sqlite`,
run `PRAGMA integrity_check` and `PRAGMA foreign_key_check`, then start a separate API
against the copy on an unused loopback port. Verify a known operation replays its
original acknowledgement. For a real restore, stop the service, preserve the current
database and matching sidecars together, restore the verified file with ownership
`pricedesk-api:pricedesk-api` and mode 0600, and restart. Never leave old WAL/SHM files
beside a restored database. Restoring an older snapshot can lose later receipts, so
coordinate recovery of uploads before restoring production data.

## Verification status

Executed successfully with Node 22.21.0 and pnpm 11.18.0:

- Server typecheck, production build, repository ESLint rules on `server/src`, and
  `git diff --check`.
- All 16 server tests: environment validation, existing duplicate/conflict behaviour,
  transaction rollback, migration failure, API restart, draining an in-flight upload,
  bind failure, and backup correctness while a WAL writer has an uncommitted transaction.
- Compiled production entry point using an environment file: `GET /health`, online
  backup CLI with integrity verification, and `SIGTERM` shutdown with exit code 0.
- `systemd-analyze verify server/deploy/pricedesk-api.service` (syntax verification;
  the host also reported an unrelated existing AnyDesk unit warning).

All runtime checks used temporary databases; the compiled build contains no test files.

EC2 provisioning, service installation/start under the dedicated account, reverse proxy
TLS/authentication, off-instance backup scheduling and a production restore drill remain
deployment checks. No EC2 resources or existing databases were changed.
