import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {sha256} from './corpus_common.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const directory=path.join(root,'.tools/rsc-semantic'),commit='f513cf437acca23d1a5882650ee3b148dc463a17';
fs.mkdirSync(directory,{recursive:true});
const request=async url=>{
  const response=await fetch(url,{headers:{'User-Agent':'rs-ocr-source-audit'},signal:AbortSignal.timeout(30000)});
  if(!response.ok)throw Error(`HTTP ${response.status}: ${url}`);
  return Buffer.from(await response.arrayBuffer());
};
const treeFile=path.join(directory,'tree.json');
if(!fs.existsSync(treeFile))fs.writeFileSync(treeFile,await request(`https://api.github.com/repos/UWorldGX/pkmn_rs_chn_rsc/git/trees/${commit}?recursive=1`));
const treeBytes=fs.readFileSync(treeFile),tree=JSON.parse(treeBytes);
if(tree.truncated)throw Error('Incomplete pinned repository tree');
const files=tree.tree.filter(f=>f.type==='blob'&&/\.(txt|md|html)$/i.test(f.path));
const blobHash=bytes=>crypto.createHash('sha1').update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest('hex');
const known=JSON.parse(fs.readFileSync(path.join(root,'corpus/sources.json'))).sources.filter(s=>s.repository==='UWorldGX/pkmn_rs_chn_rsc'&&s.commit===commit);
const downloaded=new Map();
let cursor=0;
await Promise.all(Array.from({length:4},async()=>{
  while(cursor<files.length){
    const f=files[cursor++],local=path.join(directory,'files',f.path),url=`https://raw.githubusercontent.com/UWorldGX/pkmn_rs_chn_rsc/${commit}/${f.path.split('/').map(encodeURIComponent).join('/')}`;
    const existing=known.find(s=>s.path===f.path);
    let bytes=fs.existsSync(local)?fs.readFileSync(local):existing?fs.readFileSync(path.join(root,existing.local)):null;
    if(!bytes||blobHash(bytes)!==f.sha){
      if(!downloaded.has(f.sha))downloaded.set(f.sha,request(`https://api.github.com/repos/UWorldGX/pkmn_rs_chn_rsc/git/blobs/${f.sha}`).then(raw=>Buffer.from(JSON.parse(raw).content.replace(/\s/g,''),'base64')));
      bytes=await downloaded.get(f.sha);
    }
    if(blobHash(bytes)!==f.sha)throw Error('Git blob mismatch: '+f.path);
    fs.mkdirSync(path.dirname(local),{recursive:true});fs.writeFileSync(local,bytes);
    f.url=url;f.local=path.relative(root,local).replaceAll('\\','/');f.sha256=sha256(bytes);
  }
}));
const manifest={repository:'UWorldGX/pkmn_rs_chn_rsc',commit,treeSha256:sha256(treeBytes),allRepositoryBlobs:tree.tree.filter(f=>f.type==='blob').length,
  scope:'All txt/md/html blobs at the pinned commit; historical variants are retrieval evidence only, not active runtime inputs.',files};
fs.writeFileSync(path.join(directory,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({files:files.length,bytes:files.reduce((n,f)=>n+f.size,0),commit}));
