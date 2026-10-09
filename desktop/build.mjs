import { build } from 'esbuild';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
const outdir = 'desktop-build/app';
await mkdir(outdir, { recursive: true });
await build({
  entryPoints: {
    main: 'desktop/main.ts',
    preload: 'desktop/preload.ts',
    backend: 'desktop/backend.ts',
  },
  outdir,
  outExtension: { '.js': '.cjs' },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node24',
  external: ['electron'],
  logLevel: 'info',
});
await cp('dist', `${outdir}/dist`, { recursive: true });
const { name, version, license } = JSON.parse(await readFile('package.json', 'utf8'));
await writeFile(
  `${outdir}/package.json`,
  JSON.stringify(
    {
      name,
      version,
      license,
      main: 'main.cjs',
      description: 'ExpertMesh desktop agent workspace',
      author: 'ExpertMesh contributors',
    },
    null,
    2,
  ),
);
