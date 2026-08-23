import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const outputDir = resolve(here, 'dist');
mkdirSync(outputDir, { recursive: true });

const exported = [
  '_malloc', '_free', '_exact_best_move', '_strong_best_move', '_score_diff',
  '_get_last_value', '_get_last_nodes', '_get_last_cutoffs',
  '_get_last_iterations', '_get_last_estimate', '_set_random_seed',
];

function compile(fileName, environment) {
  const result = spawnSync(process.env.EMCC ?? 'emcc', [
    resolve(here, 'src/black_hole_engine.c'),
    '-O3', '-flto', '-DNDEBUG',
    '-sMODULARIZE=1', '-sEXPORT_ES6=1', `-sENVIRONMENT=${environment}`,
    '-sFILESYSTEM=0', '-sALLOW_MEMORY_GROWTH=1', '-sINITIAL_MEMORY=33554432',
    `-sEXPORTED_FUNCTIONS=${JSON.stringify(exported)}`,
    '-sEXPORTED_RUNTIME_METHODS=["HEAP8"]',
    '-o', resolve(outputDir, fileName),
  ], { stdio: 'inherit', shell: false });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

compile('black_hole_engine.js', 'web,worker');
compile('black_hole_engine.node.js', 'node');
