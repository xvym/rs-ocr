import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {sha256} from './corpus_common.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const {sources} = JSON.parse(fs.readFileSync(path.join(root,'corpus/sources.json')));
for (const source of sources) {
  const file = path.join(root, source.local);
  if (fs.existsSync(file) && sha256(fs.readFileSync(file)) === source.sha256) continue;
  const response = await fetch(source.url);
  if (!response.ok) throw Error(`${response.status}: ${source.url}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (sha256(bytes) !== source.sha256) throw Error(`Hash mismatch: ${source.path}`);
  fs.mkdirSync(path.dirname(file), {recursive:true});
  fs.writeFileSync(file, bytes);
  console.log(`Restored ${source.path}`);
}
console.log(`Verified ${sources.length} pinned sources`);
