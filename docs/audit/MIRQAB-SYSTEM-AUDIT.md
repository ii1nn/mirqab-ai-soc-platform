# MIRQAB SYSTEM AUDIT

Consolidated security audit of the Mirqab SOC platform. Each phase below is appended by its own audit pass; findings are read-only assessments and do not imply any code, dependency, or configuration change was made during the audit itself.

---

## Open-Source & Third-Party Security Assessment
*(Phase 5.5 — Open-Source & Third-Party Component Security Testing, 2026-09-06)*

**Scope covered:** `backend/` (NestJS API), `apps/soc-dashboard/` (React+Vite web dashboard), `apps/employee-desktop/` (Electron+React desktop agent), `infra/docker/` (custom Dockerfiles + `docker-compose.yml`), the vendored `infra/docker/wazuh-docker/` (upstream Wazuh single-node stack), and a repo-wide secrets sweep. `ai-engine/` and `packages/{shared-types,ui-kit,config}` were confirmed to contain only `.gitkeep` stubs with no source or manifest files — there is no separate Python service to audit; all AI/LLM integration (Claude API via `@anthropic-ai/sdk`) lives inside `backend/`. No dependency was upgraded, removed, or modified during this audit — inspection only, per instructions.

**Method:** `npm audit --json` / `npm outdated --json` against the live npm registry (network-reachable, confirmed) for each of the three Node projects; manual `package.json`/lockfile/Dockerfile/compose review; per-direct-dependency license extraction from installed `node_modules/*/package.json`; repo-wide secret-pattern grep excluding `node_modules`/`dist`/`.git`. No SAST or container-image scanner (Trivy/Snyk/Semgrep) is installed in this environment — see Section 8.

### 1–2. Inventory, Versions & Vulnerabilities

**Backend (`backend/`) — 27 prod + 25 dev direct dependencies, 830 resolved packages**

| Component | Version | Type | License | Notes |
|---|---|---|---|---|
| @anthropic-ai/sdk | 0.115.0 (latest 0.124.0) | Direct | MIT | Claude API client |
| @nestjs/core, common, platform-express, platform-socket.io, websockets | 10.4.22 (latest 12.0.1) | Direct | MIT | 2 majors behind; source of most transitive vulns below |
| @nestjs/config | 3.3.0 | Direct | MIT | |
| @nestjs/jwt | 10.2.0 | Direct | MIT | |
| @nestjs/passport | 10.0.3 | Direct | MIT | |
| @nestjs/schedule | 6.1.3 | Direct | MIT | |
| @nestjs/swagger | 7.4.2 | Direct | MIT | pulls vulnerable js-yaml/lodash |
| @nestjs/throttler | 6.5.0 | Direct | MIT | |
| @prisma/client / prisma | 5.22.0 | Direct | Apache-2.0 | has postinstall/preinstall (expected, engine setup) |
| bcrypt | 6.0.0 | Direct | MIT | native module |
| bcryptjs | 2.4.3 | Direct | MIT | **duplicate of bcrypt — redundant** |
| class-transformer / class-validator | 0.5.1 / 0.14.4 | Direct | MIT | |
| helmet | 7.2.0 | Direct | MIT | |
| ioredis | 5.11.1 | Direct | MIT | |
| joi | 17.13.4 | Direct | BSD-3-Clause | |
| passport / passport-jwt | 0.7.0 / 4.0.1 | Direct | MIT | |
| pdfkit | 0.19.1 | Direct | MIT | |
| socket.io / @socket.io/redis-adapter | 4.8.3 / 8.3.0 | Direct | MIT | |
| @nestjs/cli (dev) | 10.4.9 (latest 12.0.0) | Direct (dev) | MIT | source of the dev-tooling CVE chain |
| **multer** | high (GHSA-xf7r-hgr6-v32p, GHSA-v52c-386h-88mc, GHSA-5528-5vmv-3xc2, GHSA-72gw-mp4g-v24j — DoS: cleanup/resource exhaustion/recursion) | Transitive via @nestjs/platform-express | MIT | **runtime-reachable**, no non-breaking fix |
| **js-yaml** | high (GHSA-52cp-r559-cp3m, GHSA-5p4m-2wfm-xmqj, GHSA-mh29-5h37-fv8m — quadratic-CPU DoS, prototype pollution) | Transitive via @nestjs/swagger | MIT | **runtime-reachable**, no non-breaking fix |
| **lodash** | high (GHSA-r5fr-rjxr-66jc code injection via `_.template`, GHSA-f23m-r3pf-42rh / GHSA-xxjr-mmjv-4gpg prototype pollution) | Transitive via @nestjs/swagger | MIT | **runtime-reachable**, no non-breaking fix |
| qs | moderate (GHSA-q8mj-m7cp-5q26 and 2 others, DoS) | Transitive | MIT | runtime-reachable |
| @nestjs/core | moderate (GHSA-36xv-jgw5-4q75) | Direct | MIT | |
| body-parser | low (GHSA-v422-hmwv-36x6) | Transitive | MIT | |
| brace-expansion, glob, picomatch, tmp, ajv, webpack, @angular-devkit/*, inquirer, external-editor | high/moderate/low (ReDoS, symlink path traversal, build-time SSRF, etc.) | Transitive via @nestjs/cli | MIT | **dev-tooling only**, not reachable in the running server — but see Docker finding below |

Backend `npm audit` totals: **0 critical / 9 high / 15 moderate / 4 low**, all in transitive packages. Every `@nestjs/*` fix requires the major **10→12 upgrade** (`fixAvailable.isSemVerMajor: true`); no non-breaking patch exists in the 10.x line.

**soc-dashboard — 11+ direct deps**

| Component | Version | Type | Vulnerability | Severity | License | Fix |
|---|---|---|---|---|---|---|
| vite | 5.4.21 (latest 8.2.2) | Direct | GHSA-fx2h-pf6j-xcff (fs.deny bypass, Windows), GHSA-4w7w-66w2-5vf9 (path traversal), GHSA-v6wh-96g9-6wx3 (NTLMv2 hash leak) | High | MIT | major bump only; dev-server-only, not in shipped bundle |
| react-router-dom | 6.30.4 | Direct | GHSA-jjmj-jmhj-qwj2 (open redirect → XSS) | Moderate | MIT | non-breaking fix available |
| react-router | (transitive) | Transitive | GHSA-wrjc-x8rr-h8h6 (open redirect) | Moderate | MIT | non-breaking fix available |
| esbuild | (transitive via vite) | Transitive | GHSA-67mh-4wv8-2f99 (dev server arbitrary-origin requests) | Moderate | MIT | only via vite major bump |
| brace-expansion, js-yaml, nanoid | (transitive) | Transitive | ReDoS / quadratic CPU / infinite loop | High | MIT | non-breaking fixes available |
| @tanstack/react-query, axios, clsx, framer-motion, lucide-react, react/react-dom, reactflow, recharts, socket.io-client, zustand | current, all `^` ranges | Direct | none flagged | — | MIT/ISC | — |

`npm audit` totals: 0 critical / 4 high / 3 moderate / 0 low (7 total).

**employee-desktop — same web deps plus Electron stack**

| Component | Version | Type | Vulnerability | Severity | License | Fix |
|---|---|---|---|---|---|---|
| **electron** | **29.4.6** (latest 44.2.0 — 15 majors / ~2 years behind, past EOL support window) | Direct | Dozens of GHSA advisories incl. use-after-free (GHSA-532v-xpq5-8h95, GHSA-8337-3p73-46f4, GHSA-jjp3-mq3x-295m), renderer command-line switch injection (GHSA-9wfr-w7mm-pc7f), **context-isolation bypass via `Function.prototype.bind` hijack (GHSA-h7rp-cf8h-j98x)**, custom-protocol CORS bypass, sandboxed-iframe popup bypass | **High (multiple)** | MIT | major bump only (29→44) |
| tar | (transitive via electron-builder) | Transitive | GHSA-23hp-3jrh-7fpw + ~10 chained advisories (decompression DoS, hardlink/symlink path traversal) | **Critical** | ISC | build-toolchain risk only, not shipped in end-user app; fix via electron-builder update |
| electron-builder | 24.13.3 (latest 26.15.3) | Direct | pulls the above tar chain + app-builder-lib/builder-util/etc. (GHSA-p2f4-r6v6-j797, credential leak on cross-origin redirect in electron-updater) | High | MIT | major bump only |
| extract-zip | (transitive via electron) | Transitive | GHSA-jmr9-qjv8-65gv (symlink path traversal) | High | MIT | via electron bump |
| @xmldom/xmldom | (transitive) | Transitive | GHSA-6gmq-8vp8-gcm6 (XML fragment injection) | Moderate | MIT/LGPL-2.1 dual | — |
| brace-expansion, js-yaml, nanoid, esbuild, react-router, react-router-dom | same as soc-dashboard | Transitive/Direct | see above | High/Moderate | MIT | non-breaking (except esbuild) |

`npm audit` totals: **1 critical / 13 high / 4 moderate / 0 low (18 total)**.

**Docker base images**

| Component | Base image | Tag | Pinned? | EOL/status | Root/non-root |
|---|---|---|---|---|---|
| backend | node | 20-alpine | minor-pinned, no digest | supported | **root — no USER directive** |
| soc-dashboard build stage | node | 20-alpine | minor-pinned | supported | discarded, not shipped |
| soc-dashboard runtime / nginx reverse proxy | nginx | 1.25-alpine | minor-pinned | supported | default nginx (worker as `nginx` user) |
| postgres | postgres | 16-alpine | minor-pinned | supported | official image default (non-root) |
| redis | redis | 7-alpine | minor-pinned | supported | official image default (non-root) |
| wazuh.manager / wazuh.indexer / wazuh.dashboard | wazuh/wazuh-manager, -indexer, -dashboard | 4.14.7 | exact-pinned | **`VERSION.json` in the vendored tree declares `"stage": "rc1"` — this is a release-candidate, not the GA 4.14.7 release** (current stable per Wazuh's GitHub releases is GA 4.14.7) | vendor default (root, required for the manager) |

No image uses `latest` or a fully floating tag. None use content-digest (`@sha256:...`) pinning.

### 3. Software Supply Chain Review

- **No deprecated packages** found via `npm ls --all` in any of the three projects; no typosquat-shaped or unrecognized package names among direct dependencies anywhere.
- **Duplicate dependency:** `bcrypt` and `bcryptjs` are both direct backend dependencies — two separate password-hashing implementations to keep patched instead of one. Not a vulnerability by itself, but unnecessary supply-chain surface.
- **Install scripts:** backend — `bcrypt` (native binary via node-gyp-build), `prisma`/`@prisma/client` (preinstall/postinstall, standard engine setup). employee-desktop — only `electron` (postinstall downloads its prebuilt binary from Electron's CDN; standard, but means `npm install` reaches an external CDN). None of these are unexpected for their respective packages.
- **Unnecessary attack surface in the backend production image:** `backend/Dockerfile` copies the entire `node_modules` (including `@nestjs/cli`, webpack, `@angular-devkit/*`, and every dev-tooling package carrying the 9 high-severity findings above) into the runtime container instead of an `--omit=dev` install. This is a deliberate, documented tradeoff (lets `prisma migrate deploy` run at boot without needing network access to fetch the Prisma CLI), but it means dev-only CVEs physically ship inside the production image even though they're not executed at runtime.
- **Vendored, unpinned third-party project:** `infra/docker/wazuh-docker/` is a full, currently **untracked** (`git status` shows `??`) clone of the entire upstream `wazuh/wazuh-docker` GitHub repository — including its own `.git` history, CI workflows, docs, and multi-node/agent variants Mirqab doesn't use — rather than a minimal, pinned subset. It is not referenced by version/commit/checksum in any Mirqab manifest (no `git submodule`, no documented pin). Recommendation: either convert to a proper pinned `git submodule`/subtree at a specific GA tag, or vendor only the `single-node/` files actually used, with the version recorded in a manifest.
- **Redundant Python service directory:** `ai-engine/` (FAISS + Claude client + MITRE mapping stub) is explicitly superseded by `backend/src/modules/ai/` per the project's own README/phase-5 design notes and contains no code — it carries no dependency risk today but is dead weight in the repo that could confuse a future contributor into building against it.
- No excessive-permission packages, no unexpected/unrequested network-calling packages beyond the expected ones (Electron's own binary download, Prisma's engine fetch) were found among direct dependencies.

### 4. License Audit

All **direct** dependencies across `backend/`, `apps/soc-dashboard/`, and `apps/employee-desktop/` resolve to **MIT, Apache-2.0, BSD-3-Clause, or ISC** — all permissive, all normally compatible with commercial/closed-source distribution. One transitive package, `@xmldom/xmldom` (employee-desktop), is dual MIT/LGPL-2.1-licensed — LGPL terms typically only bind on modification/relinking of the library itself, not on the application that merely depends on it, but this should get a legal-review pass since employee-desktop is distributed to end-user machines as a packaged Electron binary (a distribution scenario LGPL analysis is more sensitive to than a server-side dependency).

The one **GPL-family component** in the repo is the entire vendored **`wazuh/wazuh-docker` tree, GPLv2-licensed** (confirmed via its `LICENSE` file). This ships as a set of Docker Compose configs and image references (Mirqab does not modify or statically link against Wazuh's own source), which is the deployment pattern GPL is generally understood to treat most leniently (running a GPL program in a separate container/process, communicating over a network API, is different from linking it into Mirqab's own binaries) — but this characterization requires legal confirmation before any commercial redistribution of the full Mirqab stack (as opposed to Mirqab's own code alone), not just running it as an internal SOC deployment.

`backend/package.json` itself is `"license": "UNLICENSED"` (private/proprietary — correct for an internal product). No root-level `LICENSE` file exists for Mirqab's own code, and no license is stated for Mirqab itself in `README.md`.

**Flagged for legal review (not a legal conclusion):**
- Vendored `wazuh-docker` (GPLv2) — distribution model and any redistribution-to-customer implications.
- `@xmldom/xmldom` (MIT/LGPL-2.1 dual) inside the distributed Electron app.
- Absence of a stated license for Mirqab's own codebase — worth resolving before any customer-facing contract references "open-source components used."

### 5. Docker & Base Image Audit

See the base-image table in Section 1–2. Additional findings:

- **`backend` container runs as root** — no `USER` instruction in either build or runtime stage, despite the `node:20-alpine` base image shipping a ready-made unprivileged `node` user that could be adopted with a single line. This is the clearest, lowest-effort container-hardening gap found.
- **No privileged containers, no `network_mode: host`, no `cap_add`, no Docker-socket mounts** anywhere across `infra/docker/docker-compose.yml`, the vendored `wazuh-docker` single-node/multi-node/agent compose files, or any Dockerfile. This is a genuinely clean result for the custom-built stack.
- **`postgres` is published on `5432:5432`** to the host interface (not just the internal Docker bridge) — a documented tradeoff so a natively-run (`npm run start:dev`) backend can reach it during development, but wider exposure than a fully containerized deployment needs. Recommend `127.0.0.1:5432:5432` or removing the published port outside local dev.
- **`wazuh.indexer` (OpenSearch) is published on `9200:9200`** directly to the host — combined with the default `INDEXER_PASSWORD`/`API_PASSWORD` below, this is a materially higher-risk exposure if the host is ever reachable beyond localhost.
- **Vendored `wazuh-docker/single-node/docker-compose.yml` hardcodes well-known upstream demo credentials directly in the compose file**: `INDEXER_PASSWORD=SecretPassword`, `API_PASSWORD=MyS3cr37P450r.*-`, and `DASHBOARD_PASSWORD=kibanaserver` (username and password identical). These are documented upstream as "change before production" placeholders, but nothing in the Mirqab repo currently enforces rotation before the stack could actually be started. If this compose file is ever brought up in any environment reachable beyond an isolated dev machine without changing these, it is a **P0 credential issue** — publicly documented default passwords for a security-monitoring platform.
- Backend container mounts `../../datasets:/app/datasets:ro` and a Wazuh CA cert, both read-only — no writable host-filesystem mounts found anywhere.
- Self-signed TLS material (`*.pem` under `infra/docker/nginx/certs/`, and the Wazuh single-node demo cert bundle) is correctly excluded from git via `.gitignore` and confirmed untracked — good hygiene, these are locally-generated/vendored dev artifacts, not a repo leak.

### 6. Dependency Integrity

- All three Node projects (`backend`, `soc-dashboard`, `employee-desktop`) have a committed `package-lock.json` at **lockfileVersion 3**, giving reproducible, integrity-hash-verified installs (`npm ci` is used in `backend/Dockerfile`).
- All direct dependency version ranges use conventional **`^` caret ranges** — none use `*`, `latest`, or an unbounded range. Reproducibility in practice comes from the committed lockfile, which is present and current in all three projects.
- No Python lockfile applicable — no Python service exists in this codebase (`ai-engine/` is an empty stub; see Scope note above).
- The root `package-lock.json` (`mirqab-project/package-lock.json`) is an essentially empty stub (`"packages": {}`, no root `package.json`) — the repo is not set up as an npm workspace; each app manages its own lockfile independently. This is consistent, not a defect, but worth knowing if a future workspace-level tool (`npm audit` at the root, Dependabot config, etc.) is added — it would need to target each subproject explicitly.

### 7. Secrets in Open-Source Files

| # | File | Type | Severity | Notes |
|---|---|---|---|---|
| 1–3 | `infra/docker/.env` | `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `MONITORING_INGEST_API_KEY` — real, random, working values | **P0** | Not committed to git (correctly `.gitignore`d, confirmed via `git ls-files`), but real live secrets sit in plaintext on disk. Must be rotated before any shared/staging/production use — anyone with filesystem access has full JWT-forgery and monitoring-ingest capability. |
| 4 | `infra/docker/.env` → `WAZUH_API_PASSWORD` | Real value in active use, but is Wazuh's own well-known upstream demo default, hardcoded in the vendored compose file | High | Not yet committed (vendored tree is currently untracked) but would become permanently committed if that tree is ever `git add`-ed as-is. |
| 5 | `infra/docker/.env` → `POSTGRES_PASSWORD` / `ADMIN_PASSWORD` | Placeholder-style strings (`change-me`, `ChangeMe123!`) that are the actual values the seeded dev DB/admin account use | Medium | Not committed. |
| 6 | `backend/.env` and all `.env.example` files | Obvious placeholder text throughout | Info (safe) | No real credentials. |
| 7 | `infra/docker/wazuh-docker/single-node/config/wazuh_api_cert/server.key` (+ `.crt`, `-ca.pem`) | Real PEM private key content | Medium | Upstream Wazuh quickstart's own bundled demo/self-signed cert, not Mirqab-generated. Untracked (whole vendored dir is `??`). |
| 8 | `backend/check-password.js` | bcrypt hash + plaintext matching the documented default seed password | Low (hygiene) | Leftover debug script, tracked in git — recommend deleting, not a new secret. |
| 9 | `backend/probe.js` | Empty, self-described "safe to delete" stub | Low (hygiene) | Repo clutter. |
| 10 | Vendored Wazuh CI workflow `${{ secrets.CI_GPG_PRIVATE_KEY }}` | GitHub Actions secrets reference | Info (false positive) | No actual key material; part of upstream Wazuh's own CI, irrelevant to Mirqab. |

**No secret is currently committed to git.** `.gitignore` correctly excludes `.env`, `.env.local`, and `infra/docker/.env`. Findings #1–#3 are still rated **P0 — must be rotated before production** per the instruction to flag any real, working secret regardless of git status: these are live, functioning JWT-signing and API-ingest secrets sitting in plaintext on this machine. `mirqab-project-complete.zip` (a sibling archive one directory up, outside this audit's file-tree scope) may contain a frozen snapshot of this `.env` — worth confirming before that archive is shared anywhere.

### 8. SAST / Dependency Scanning

No dependency-vulnerability scanner, SAST tool, secret-scanner, container scanner, or license scanner is currently installed or configured in this repository (no `.github/dependabot.yml`, no Snyk/Semgrep config, no pre-commit secret-scan hook, no Trivy/Grype invocation found). This audit's vulnerability data came from direct, on-demand `npm audit` runs against the live registry — not from a persisted, repeatable tool.

**Recommended additions (not installed during this audit, per instructions):**
- **Dependency vulnerability scanning:** GitHub Dependabot (free, native to GitHub, needs only a `.github/dependabot.yml`) or Snyk, scheduled weekly against all three `package.json` files.
- **SAST:** Semgrep (free OSS ruleset, works well against TypeScript/NestJS/React) or GitHub CodeQL if the repo is hosted on GitHub.
- **Secret scanning:** `gitleaks` or `trufflehog` as a pre-commit hook and a CI gate — would have caught the `check-password.js` pattern immediately and prevents any future accidental `.env` commit.
- **Container scanning:** Trivy (free, scans both the custom Dockerfiles' resulting images and the vendored Wazuh images for OS-package CVEs) — would directly validate/refresh the "release-candidate Wazuh tag" and "root backend container" findings above on every build.
- **License scanning:** `license-checker` (npm) run in CI against all three projects' full resolved trees (this audit only hand-checked direct dependencies) to catch any GPL/AGPL introduced transitively in future dependency bumps.

---

## Open-Source Risk Report

| Component | Version | Type | Vulnerability | Severity | License | Risk | Recommendation |
|---|---|---|---|---|---|---|---|
| electron | 29.4.6 | Direct | Dozens of GHSA advisories; context-isolation bypass, use-after-free (multiple) | High (multiple, EOL) | MIT | Unpatched Chromium/Node shipped inside every deployed desktop agent; sandbox-escape-class bugs | Plan a major upgrade to a current Electron LTS line before any pilot with real endpoints |
| tar (via electron-builder) | <=7.5.18 | Transitive | GHSA-23hp-3jrh-7fpw + chain (decompression DoS, path traversal) | Critical | ISC | Build-toolchain only, not shipped to end users | Update electron-builder to pull a patched tar |
| Wazuh single-node stack | 4.14.7-rc1, default creds | Vendored | Hardcoded `INDEXER_PASSWORD`, `API_PASSWORD`, `DASHBOARD_PASSWORD` (well-known upstream defaults) | **P0 if ever reachable beyond localhost** | GPLv2 | Publicly documented default creds for a security platform | Rotate before any non-isolated run; pin to GA (not rc1) tag |
| infra/docker/.env secrets | live values | N/A | Real JWT/API secrets in plaintext on disk | P0 | N/A | JWT forgery / monitoring-ingest bypass if disk/backup exposed | Rotate before staging/production; never distribute this file |
| multer (via @nestjs/platform-express) | current in 10.x tree | Transitive | DoS (cleanup/resource exhaustion/recursion) | High | MIT | Runtime-reachable in backend | Requires NestJS 10→12 major upgrade |
| js-yaml (via @nestjs/swagger) | current in 10.x tree | Transitive | Quadratic-CPU DoS, prototype pollution | High | MIT | Runtime-reachable in backend | Requires NestJS 10→12 major upgrade |
| lodash (via @nestjs/swagger) | current in 10.x tree | Transitive | Code injection via `_.template`, prototype pollution | High | MIT | Runtime-reachable in backend | Requires NestJS 10→12 major upgrade |
| vite | 5.4.21 | Direct (soc-dashboard) | `server.fs.deny` bypass, path traversal, NTLMv2 hash leak | High | MIT | Dev-server only, not in shipped bundle | Update to vite 6/7 line pre-pilot |
| react-router-dom | 6.30.4 | Direct (both frontends) | Open redirect → XSS | Moderate | MIT | Non-breaking fix available | Patch now — no breaking change required |
| brace-expansion / nanoid / esbuild | transitive, all 3 projects | Transitive | ReDoS / ReDoS / infinite loop | High | MIT | Non-breaking fixes mostly available | Patch via `npm audit fix` where non-breaking |
| bcrypt + bcryptjs | 6.0.0 / 2.4.3 | Direct (backend) | None (redundancy, not a CVE) | — | MIT | Two hashing implementations to maintain | Consolidate to one |
| wazuh-docker vendored tree | untracked, unpinned | Vendored | N/A (supply-chain) | Medium | GPLv2 | Not version/checksum-pinned in any manifest; risk of accidental full commit including demo creds/private key | Convert to pinned submodule or gitignore explicitly |
| backend Docker image | node:20-alpine, root | N/A | Runs as root; ships full dev `node_modules` | Medium | N/A | Wider container attack surface than necessary | Add `USER node`; consider `--omit=dev` with a network-available migration step |
| @xmldom/xmldom | transitive (employee-desktop) | Transitive | GHSA-6gmq-8vp8-gcm6 (XML fragment injection) | Moderate | MIT/LGPL-2.1 dual | Distributed inside packaged Electron app | Legal review of LGPL distribution term; patch available |

### Critical Open-Source Risks
*(would block Mirqab from safely entering a company environment as-is)*

1. **Live JWT signing/API secrets sitting in plaintext `infra/docker/.env`** — must be rotated and the file kept off any shared medium before staging/production use.
2. **Wazuh single-node stack ships well-known default `INDEXER_PASSWORD`/`API_PASSWORD`/`DASHBOARD_PASSWORD`** with nothing enforcing rotation before the stack can run — a P0 the moment that stack is reachable beyond an isolated dev machine.
3. **Electron 29.4.6 is ~2 years / 15 majors past EOL**, shipping an unpatched Chromium/Node runtime inside a security agent installed on employee endpoints — the exact threat surface (renderer compromise → sandbox escape) a SOC product's own agent should minimize, not carry.
4. **Vendored Wazuh image tag is a release candidate (`4.14.7-rc1`), not the GA release** — should not be the version running any pilot's actual detection/alerting backbone.

### High-Priority Updates
*(should happen before a company pilot, even though none are actively exploited today)*

- Backend: NestJS 10→12 major upgrade (resolves multer/js-yaml/lodash/qs high-severity, runtime-reachable findings) — the single highest-leverage fix in the backend.
- employee-desktop: Electron 29→44 and electron-builder 24→26 major upgrades.
- soc-dashboard: react-router-dom patch (non-breaking) now; vite 5→6/7 major upgrade before pilot.
- backend Dockerfile: add `USER node` (or equivalent) to stop running as root.
- Consolidate bcrypt/bcryptjs to a single hashing library.
- Pin the vendored `wazuh-docker` tree to a specific GA tag/commit (not the current unpinned, untracked rc1 clone) and rotate its default credentials.

### License Concerns
*(flagged for legal review, not a legal conclusion)*

- Vendored `wazuh/wazuh-docker` (GPLv2) — confirm the network-service deployment model doesn't create obligations for any commercial redistribution of the bundled Mirqab+Wazuh stack.
- `@xmldom/xmldom` (MIT/LGPL-2.1 dual) shipped inside the distributed employee-desktop Electron binary.
- No stated license for Mirqab's own codebase (`backend/package.json` is `UNLICENSED`/private, appropriate internally, but no root `LICENSE` file exists) — resolve before any customer-facing claims about open-source component usage.

### Supply-Chain Concerns

- `infra/docker/wazuh-docker/` vendored wholesale (full upstream repo incl. its own `.git`, CI, docs, unused multi-node/agent variants) and currently untracked/unpinned in Mirqab's own version control.
- Duplicate password-hashing dependency (`bcrypt` + `bcryptjs`) in the backend.
- Backend production Docker image ships the entire dev-tooling `node_modules` tree (NestJS CLI, webpack, Angular DevKit), carrying 9 high-severity CVEs that are not reachable at runtime but do widen the image's static attack surface unnecessarily.
- No dependency/SAST/secret/container/license scanning tooling is currently wired into the repo or CI (see Section 8) — today's clean git-secrets result and license posture depend on manual diligence rather than an enforced gate.
- `ai-engine/` is a fully superseded, empty stub directory kept in the repo — no risk today, but worth removing to avoid future confusion about which AI integration path is authoritative.

### Production Recommendation

**Pilot requires remediation.**

The custom-built application code (backend, soc-dashboard) has a genuinely clean license posture, no critical runtime-reachable vulnerabilities in its own direct dependencies, reproducible lockfile-based installs, and a container/compose configuration with no privileged/host-network/socket-exposure red flags. That part of the stack is safe for continued internal development and testing today.

What blocks a company pilot is concentrated in four fixable items: (1) rotating the live secrets currently in `infra/docker/.env`, (2) rotating/removing the default Wazuh credentials and moving off the `4.14.7-rc1` tag before that stack is ever reachable outside an isolated machine, (3) the Electron version being materially past its security-support window on a product that runs as an agent on employee endpoints, and (4) the NestJS major-version upgrade needed to clear the backend's runtime-reachable high-severity transitive CVEs. None of these require an architecture change — they are version/config remediation, not a redesign — but none should be considered done until addressed. Recommend re-running this audit's `npm audit` + secrets scan after those four items land, before greenlighting a company pilot.
