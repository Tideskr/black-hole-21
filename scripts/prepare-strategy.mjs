import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = resolve(root, 'strategy/certificates/v6/proof.json');
const outputDir = resolve(root, 'public/generated');
const expectedHash = 'f699006e057352a366f777276cc00c711464f499450d6a23521d4a61720c812b';

const raw = await readFile(sourcePath);
const hash = createHash('sha256').update(raw).digest('hex');
if (hash !== expectedHash) throw new Error(`证书 SHA-256 不匹配：${hash}`);

const certificate = JSON.parse(raw.toString('utf8'));
if (certificate.strategy_version !== 6) throw new Error('证书版本必须为 6');
const fullResults = certificate.full_results;
const ai1Keys = Object.keys(fullResults).sort((a, b) => Number(a) - Number(b));
const expectedAi1 = Array.from({ length: 20 }, (_, index) => String(index + 2));
if (JSON.stringify(ai1Keys) !== JSON.stringify(expectedAi1)) throw new Error('首回合必须完整覆盖格 2–21');

function assertCell(value, occupied, label) {
  if (!Number.isInteger(value) || value < 1 || value > 21) throw new Error(`${label} 格号非法：${value}`);
  if (occupied.has(value)) throw new Error(`${label} 重复占据格 ${value}`);
}

const runtimeResults = {};
let h4Mappings = 0;
for (const ai1Key of ai1Keys) {
  const branch = fullResults[ai1Key];
  if (!branch.passed) throw new Error(`AI1=${ai1Key} 未通过`);
  const ai1 = Number(ai1Key);
  const prefix = new Set([1, ai1]);
  assertCell(branch.h2, prefix, `AI1=${ai1} 的 H2`);
  prefix.add(branch.h2);

  const ai2Keys = Object.keys(branch.responses_by_ai2).sort((a, b) => Number(a) - Number(b));
  const expectedAi2 = Array.from({ length: 21 }, (_, i) => i + 1).filter((cell) => !prefix.has(cell)).map(String);
  if (JSON.stringify(ai2Keys) !== JSON.stringify(expectedAi2)) throw new Error(`AI1=${ai1} 的 AI2 未覆盖全部 18 格`);

  const responsesByAi2 = {};
  for (const ai2Key of ai2Keys) {
    const response = branch.responses_by_ai2[ai2Key];
    const ai2 = Number(ai2Key);
    const afterAi2 = new Set([...prefix, ai2]);
    assertCell(response.h3, afterAi2, `AI1=${ai1},AI2=${ai2} 的 H3`);
    afterAi2.add(response.h3);

    const ai3Keys = Object.keys(response.h4_by_ai3).sort((a, b) => Number(a) - Number(b));
    const expectedAi3 = Array.from({ length: 21 }, (_, i) => i + 1).filter((cell) => !afterAi2.has(cell)).map(String);
    if (JSON.stringify(ai3Keys) !== JSON.stringify(expectedAi3)) throw new Error(`AI1=${ai1},AI2=${ai2} 的 AI3 未覆盖全部 16 格`);

    const h4ByAi3 = {};
    for (const ai3Key of ai3Keys) {
      const ai3 = Number(ai3Key);
      const occupied = new Set([...afterAi2, ai3]);
      const h4 = response.h4_by_ai3[ai3Key];
      assertCell(h4, occupied, `AI1=${ai1},AI2=${ai2},AI3=${ai3} 的 H4`);
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
console.log(`v6 策略证书验证通过：20 × 18 × 16，SHA-256 ${hash}`);
