// Dev launcher for the ARENA server against the built dist/ — used by the
// preview harness (no Vite HMR, single stable load). Sets PORT + a local
// DATA_DIR and chdirs to the range root (server reads cwd/env at module eval).
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const rangeRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(rangeRoot);
process.env.PORT = process.env.PORT || '5216';
process.env.DATA_DIR = process.env.DATA_DIR || path.join(rangeRoot, '.devdata');
await import('./index.js');
