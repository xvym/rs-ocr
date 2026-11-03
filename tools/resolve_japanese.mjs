import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadSourceMatcher,resolveRegion} from './japanese_source_matcher.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),args=process.argv.slice(2),options={};
for(let i=0;i<args.length;i+=2) {
  if(!['--japanese','--game','--kind','--input','--out'].includes(args[i])||args[i+1]===undefined)throw Error('Usage: node tools/resolve_japanese.mjs (--japanese TEXT | --input requests.json) [--game ruby|sapphire|both] [--kind species|move|type|...] [--out file.json]');
  if(Object.hasOwn(options,args[i].slice(2)))throw Error('Duplicate option');
  options[args[i].slice(2)]=args[i+1];
}
if(Boolean(options.japanese)===Boolean(options.input))throw Error('Provide Japanese text or a request JSON file');
const {matcher,inputs,records}=loadSourceMatcher(root);
const requests=options.input?JSON.parse(fs.readFileSync(path.resolve(root,options.input),'utf8')):[{japanese:options.japanese,game:options.game||'both',kind:options.kind||null}];
if(!Array.isArray(requests))throw Error('Input must be an array of {japanese, game?, kind?, alternatives?}');
const results=requests.map(r=>resolveRegion(matcher,r.japanese,{...r,game:options.game||r.game||'both',kind:options.kind||r.kind||null}));
const output=JSON.stringify({schemaVersion:1,sourceRecords:records.length,inputs,results},null,2)+'\n';
if(options.out)fs.writeFileSync(path.resolve(root,options.out),output);else process.stdout.write(output);
