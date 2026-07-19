# Node 24 failed-import retry — probe (2026-07-19)

Firsthand probe for the .mcpb semantic-degradation effort (wayfinder map #43, ticket #44):
when `import("@huggingface/transformers")` rejects with `ERR_MODULE_NOT_FOUND` and the package
is *then* installed into `node_modules` — same running process — does a retried `import()`
succeed on Node 24?

**Answer: NO for our layout. Restart is required.** Worse, the in-process retry doesn't just
fail — it fails with a *different, misleading* error, because the first failed lookup poisons a
process-lifetime negative cache in Node's resolver.

Environment at probe time: **Node v24.15.0** (the target env per CLAUDE.md), macOS
Apple Silicon. Probe script: minimal ESM workspace, fake packages written straight into
`node_modules` mid-process (equivalent to `npm install` landing on disk). Full script at the
bottom.

## Results

| Scenario | Layout at first failure | Retry after install |
|---|---|---|
| A | `node_modules/` **entirely absent** | **RECOVERS** — retry imports fine |
| A′ | `node_modules/` exists (other deps present), package absent — **the real .mcpb layout** | **NEVER recovers** — permanent failure, error mutates (below) |
| A″ | same as A′ with a **scoped** name (`@fake-scope/pkg`, the actual `@huggingface/transformers` shape) | **NEVER recovers** |
| B | package present, its own *dependency* absent; dep installed later | **NEVER recovers** (direct import of the dep also stays broken) |
| C | package present but **throws during evaluation** once; cause fixed on disk | **NEVER recovers** — original error replayed verbatim (ESM module map memoizes evaluation errors) |

The A′/A″ retry error is the trap:

```
before install:  Cannot find package 'fake-pkg2' imported from <probe>/probe.mjs
after install:   Cannot find package '<probe>/node_modules/fake-pkg2/index.js' imported from …
```

After the install, Node *finds* the directory but replays a cached "no package.json here"
verdict, ignores the package's real `exports`, falls back to legacy `index.js` resolution, and
fails forever with an error that looks like a broken package rather than a stale process.

## Mechanism (Node source, v24.15.0)

- `src/node_modules.cc` `GetPackageJSON` (~lines 99–119): a failed `package.json` read inserts
  `std::nullopt` into `binding_data->package_configs_` — "so that we don't need to open and
  attempt to read this path again". Process-lifetime, no invalidation path.
- `lib/internal/modules/package_json_reader.js` adds JS-side maps on top
  (`moduleToParentPackageJSONCache`, `deserializedPackageJSONCache`).
- Scenario A recovers only because with no `node_modules/` at all, resolution fails before any
  `package.json` read is attempted — nothing gets negatively cached. The moment the directory
  chain exists (every real install: npx, dev checkout, .mcpb), the negative cache engages.
- Scenario C is the separate, long-known ESM behavior: a module whose evaluation throws is
  cached in errored state for the process lifetime; re-`import()` replays the same rejection.
  Covers the "transformers installed but its native onnxruntime binding fails once" class too.

## Implications for the map

- **#45 (never-cache a failed model load) takes its degrade branch.** Clearing our memo cannot
  make install-then-`build_index --force` work in-process — Node's own cache blocks it. And a
  bare re-probe is actively *worse* than a memoized failure: the retry surfaces the mutated
  `…/index.js` error instead of the original honest one. The useful shape is: keep (or re-take)
  the failure, but make every surfaced message say **"model installed after startup → restart
  the MCP server (in Claude Desktop: toggle the extension or restart the app)"**.
- **#47 (universal remediation message)** must end with the restart instruction — installing
  the package is necessary but never sufficient for a running server, in all three install
  modes.
- **#48 (`calibre_ping` semantic status)**: "dependency resolvable?" probed by a live process
  that already failed once will lie (or worse, mislead with the poisoned-cache error). A
  disk-level check (does `node_modules/@huggingface/transformers/package.json` exist next to
  the server?) is the honest signal to pair with the in-process load state.

## Probe script

```js
// probe.mjs — run with node >= 24 in an empty dir with {"type":"module"} package.json
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const nm = join(root, 'node_modules');

function installPkg(name, indexSource) {
  const dir = join(nm, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ name, version: '1.0.0', type: 'module', exports: './index.mjs' })
  );
  writeFileSync(join(dir, 'index.mjs'), indexSource);
}

async function tryImport(spec) {
  try {
    const m = await import(spec);
    return { ok: true, marker: m.marker };
  } catch (e) {
    return { ok: false, code: e.code, msg: String(e.message).split('\n')[0] };
  }
}

function report(label, r) {
  console.log(`${label}: ${r.ok ? `OK marker=${r.marker}` : `FAIL code=${r.code} :: ${r.msg}`}`);
}

rmSync(nm, { recursive: true, force: true });

console.log('--- Scenario A: package absent, then installed ---');
report('A1 before install', await tryImport('fake-pkg'));
installPkg('fake-pkg', 'export const marker = "A-installed";\n');
report('A2 after install ', await tryImport('fake-pkg'));

console.log("--- Scenario A': node_modules pre-exists, package absent, then installed ---");
installPkg('unrelated-pkg', 'export const marker = "unrelated";\n');
report("A'1 before install", await tryImport('fake-pkg2'));
installPkg('fake-pkg2', 'export const marker = "A2-installed";\n');
report("A'2 after install ", await tryImport('fake-pkg2'));
report("A'3 retry again   ", await tryImport('fake-pkg2'));

console.log("--- Scenario A'': scoped package absent, then installed ---");
report("A''1 before install", await tryImport('@fake-scope/pkg'));
installPkg('@fake-scope/pkg', 'export const marker = "scoped-installed";\n');
report("A''2 after install ", await tryImport('@fake-scope/pkg'));

console.log('--- Scenario B: dependency absent, then installed ---');
installPkg('fake-parent', 'import { marker as dep } from "fake-dep";\nexport const marker = "parent+" + dep;\n');
report('B1 before dep install', await tryImport('fake-parent'));
installPkg('fake-dep', 'export const marker = "dep";\n');
report('B2 after dep install ', await tryImport('fake-parent'));
report('B3 retry once more   ', await tryImport('fake-parent'));
report('B4 import dep directly', await tryImport('fake-dep'));

console.log('--- Scenario C: evaluation throws once, then fixed on disk ---');
const flag = join(root, 'c-flag');
rmSync(flag, { force: true });
installPkg(
  'fake-throw',
  `import { existsSync } from 'node:fs';\nif (!existsSync(${JSON.stringify(flag)})) throw new Error('first-eval failure');\nexport const marker = 'C-recovered';\n`
);
report('C1 before fix', await tryImport('fake-throw'));
writeFileSync(flag, 'ok');
report('C2 after fix ', await tryImport('fake-throw'));
report('C3 same pkg, subpath-less retry', await tryImport('fake-throw'));
```
