import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = resolve(root, 'strategy/certificates/v6/proof.json');
const outputDir = resolve(root, 'public/generated');
const expectedHash = 'db99816cc75f3fc5ee50939af8cd8fdf20faf0872e10df0da4705d45d35b4cca';

const raw = await readFile(sourcePath);
const hash = createHash('sha256').update(raw).digest('hex');
if (hash !== expectedHash) throw new Error(`Certificate SHA-256 mismatch: ${hash}`);

const certificate = JSON.parse(raw.toString('utf8'));
if (certificate.certificate_format !== 'black-hole-21-first-player-opening-v1') throw new Error('Unexpected certificate format');
if (typeof certificate.proof_statement !== 'string' || certificate.proof_statement.length < 80) throw new Error('Certificate proof statement is missing');
if (certificate.strategy_version !== 6) throw new Error('Certificate strategy version must be 6');
const fullResults = certificate.full_results;
const ai1Keys = Object.keys(fullResults).sort((a, b) => Number(a) - Number(b));
const expectedAi1 = Array.from({ length: 20 }, (_, index) => String(index + 2));
if (JSON.stringify(ai1Keys) !== JSON.stringify(expectedAi1)) throw new Error('The first reply must cover cells 2 through 21');

function assertCell(value, occupied, label) {
  if (!Number.isInteger(value) || value < 1 || value > 21) throw new Error(`${label} has an invalid cell number: ${value}`);
  if (occupied.has(value)) throw new Error(`${label} repeats occupied cell ${value}`);
}

const runtimeResults = {};
let h4Mappings = 0;
for (const ai1Key of ai1Keys) {
  const branch = fullResults[ai1Key];
  if (!branch.passed) throw new Error(`A1=${ai1Key} did not pass`);
  const ai1 = Number(ai1Key);
  const prefix = new Set([1, ai1]);
  assertCell(branch.h2, prefix, `H2 for A1=${ai1}`);
  prefix.add(branch.h2);

  const ai2Keys = Object.keys(branch.responses_by_ai2).sort((a, b) => Number(a) - Number(b));
  const expectedAi2 = Array.from({ length: 21 }, (_, i) => i + 1).filter((cell) => !prefix.has(cell)).map(String);
  if (JSON.stringify(ai2Keys) !== JSON.stringify(expectedAi2)) throw new Error(`A2 for A1=${ai1} does not cover all 18 cells`);

  const responsesByAi2 = {};
  for (const ai2Key of ai2Keys) {
    const response = branch.responses_by_ai2[ai2Key];
    const ai2 = Number(ai2Key);
    const afterAi2 = new Set([...prefix, ai2]);
    assertCell(response.h3, afterAi2, `H3 for A1=${ai1},A2=${ai2}`);
    afterAi2.add(response.h3);

    const ai3Keys = Object.keys(response.h4_by_ai3).sort((a, b) => Number(a) - Number(b));
    const expectedAi3 = Array.from({ length: 21 }, (_, i) => i + 1).filter((cell) => !afterAi2.has(cell)).map(String);
    if (JSON.stringify(ai3Keys) !== JSON.stringify(expectedAi3)) throw new Error(`A3 for A1=${ai1},A2=${ai2} does not cover all 16 cells`);

    const h4ByAi3 = {};
    for (const ai3Key of ai3Keys) {
      const ai3 = Number(ai3Key);
      const occupied = new Set([...afterAi2, ai3]);
      const h4 = response.h4_by_ai3[ai3Key];
      assertCell(h4, occupied, `H4 for A1=${ai1},A2=${ai2},A3=${ai3}`);
      h4ByAi3[ai3Key] = h4;
      h4Mappings += 1;
    }
    responsesByAi2[ai2Key] = { h3: response.h3, h4ByAi3 };
  }
  runtimeResults[ai1Key] = { h2: branch.h2, responsesByAi2 };
}

const runtime = {
  strategyVersion: 6,
  sha256: hash,
  h1: 1,
  fullResults: runtimeResults,
  stats: {
    ai1Branches: ai1Keys.length,
    ai2Branches: ai1Keys.length * 18,
    h4Mappings,
    exactCalls: 6153,
    exactNodes: 33370517302,
    proofSeconds: 2052,
  },
};

await mkdir(outputDir, { recursive: true });
await writeFile(resolve(outputDir, 'strategy-v6.json'), JSON.stringify(runtime));
await writeFile(resolve(outputDir, 'strategy-v6.meta.json'), JSON.stringify({
  strategyVersion: 6,
  sha256: hash,
  sourceBytes: raw.byteLength,
  ...runtime.stats,
}, null, 2) + '\n');
console.log(`Strategy certificate passed: 20 × 18 × 16, SHA-256 ${hash}`);
