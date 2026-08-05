// Assembles api/deploy — the exact folder that gets zipped and shipped to the
// Function App. The zip root must contain host.json, a production package.json
// and the compiled output.
//
// It also vendors the production dependency closure out of the local pnpm store
// as real files (pnpm's own node_modules is a tree of symlinks, which does not
// survive a zip). That keeps the deployment self-contained, so the Function App
// never has to run a remote npm install to boot.
import { existsSync, realpathSync } from 'node:fs';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const apiRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const outDir = join(apiRoot, 'deploy');
const modulesDir = join(outDir, 'node_modules');

const pkg = JSON.parse(await readFile(join(apiRoot, 'package.json'), 'utf8'));

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

await cp(join(apiRoot, 'dist'), join(outDir, 'dist'), {
  recursive: true,
  filter: (src) => !src.endsWith('.js.map'),
});
await cp(join(apiRoot, 'host.json'), join(outDir, 'host.json'));

/**
 * Walks `node_modules` directories upward from `fromDir`. `require.resolve` is
 * not usable here: many packages (including @azure/functions-extensions-base)
 * do not expose `./package.json` through their `exports` map.
 */
function resolvePackageDir(name, fromDir) {
  let dir = fromDir;
  for (;;) {
    const candidate = join(dir, 'node_modules', name);
    // realpath matters: pnpm links each package in from a content-addressed
    // store, and a package's own dependencies live next to its *real* location,
    // not next to the symlink.
    if (existsSync(join(candidate, 'package.json'))) return realpathSync(candidate);
    const parent = dirname(dir);
    if (parent === dir) throw new Error(`Cannot resolve ${name} from ${fromDir}`);
    dir = parent;
  }
}

const vendored = new Set();

async function vendor(name, fromDir) {
  if (vendored.has(name)) return;
  vendored.add(name);

  const srcDir = resolvePackageDir(name, fromDir);
  // `dereference` turns pnpm's symlinks into real files so the zip carries the
  // actual package contents.
  await cp(srcDir, join(modulesDir, name), { recursive: true, dereference: true });

  const manifest = JSON.parse(await readFile(join(srcDir, 'package.json'), 'utf8'));
  for (const dep of Object.keys(manifest.dependencies ?? {})) {
    await vendor(dep, srcDir);
  }
}

for (const dep of Object.keys(pkg.dependencies ?? {})) {
  await vendor(dep, apiRoot);
}

// Scripts and devDependencies are deliberately dropped: the app never loads the
// toolchain, and there is no build left to run.
await writeFile(
  join(outDir, 'package.json'),
  JSON.stringify(
    {
      name: pkg.name,
      version: pkg.version,
      private: true,
      main: pkg.main,
      type: pkg.type,
      engines: pkg.engines,
      dependencies: pkg.dependencies,
    },
    null,
    2,
  ) + '\n',
);

console.log(`Staged Function App package in ${outDir}`);
console.log(`Vendored ${vendored.size} production dependencies: ${[...vendored].join(', ')}`);
