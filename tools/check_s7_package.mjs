import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {sha256} from './corpus_common.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const java=process.env.JAVA_HOME&&path.join(process.env.JAVA_HOME,'bin/java.exe');if(!java||!fs.existsSync(java))throw Error('JAVA_HOME must point to the Java 21 toolchain used for packaging');
const jar=path.join(root,'desktop/target/rs-ocr-desktop-0.1.0.jar'),isolated=fs.mkdtempSync(path.join(root,'.tools/s7-isolated-'));
fs.copyFileSync(jar,path.join(isolated,'application.jar'));
const requests=[
 {japanese:'エネコロロ『みゃあん？',type:'field_dialog'},
 {japanese:'ABCは\nパソコンの スイッチを いれた！',type:'field_dialog'},
 {japanese:'ハルカは\nパソコンの スイッチを いれた！',type:'field_dialog'},
 {japanese:'ピクニックガール',type:'field_dialog'},
 {japanese:'ピクニックガール',type:'field_dialog',game:'sapphire'},
 {japanese:'あいて',type:'battle_message'},
 {japanese:'[PLAYER]',type:'field_dialog'},
 {japanese:'',type:'field_dialog',restart:true}
];
const actual=execFileSync(java,['-cp','application.jar','io.github.rsocr.desktop.translation.TranslationCli'],{cwd:isolated,input:requests.map(r=>JSON.stringify(r)).join('\n')+'\n',encoding:'utf8',timeout:30000}).trim().split('\n').map(s=>JSON.parse(s));
const first=i=>actual[i].regions[0].units[0];
assert.equal(first(0).chinese,'向尾喵：喵？');assert.equal(first(1).chinese,'ABC启动了电脑。');assert.equal(first(2).chinese,'小遥启动了电脑。');
assert.equal(first(3).chinese,null);assert.equal(first(3).reason,'original_rsc_context_required');assert.equal(first(4).chinese,'野餐少女');assert.equal(first(5).chinese,null);assert.equal(first(6).chinese,null);assert.equal(actual[7].player,null);
const entries=execFileSync(path.join(process.env.JAVA_HOME,'bin/jar.exe'),['tf',jar],{encoding:'utf8'}).split(/\r?\n/);
assert.ok(entries.includes('translation/runtime.json'));assert.ok(entries.includes('native/windows-x64/rscapture.dll'));
assert.ok(!entries.some(p=>/^(?:corpus\/|reports\/|archive\/)|\.gba$|reference\.json$|testcase/.test(p)));
fs.mkdirSync(path.join(isolated,'translation'));fs.writeFileSync(path.join(isolated,'translation/runtime.json'),fs.readFileSync(path.join(root,'desktop/target/generated-resources/translation/runtime.json'),'utf8')+' ');
execFileSync(path.join(process.env.JAVA_HOME,'bin/jar.exe'),['uf','application.jar','translation/runtime.json'],{cwd:isolated});
let tamperedRejected=false;try{execFileSync(java,['-cp','application.jar','io.github.rsocr.desktop.translation.TranslationCli'],{cwd:isolated,input:JSON.stringify(requests[0])+'\n',stdio:['pipe','pipe','pipe'],timeout:30000});}catch(error){const stderr=String(error.stderr);tamperedRejected=error.status!==0&&stderr.includes('IOException')&&stderr.includes('TranslationEngine');}assert.ok(tamperedRejected);
const report={passed:true,requests:requests.length,standaloneJarOnly:true,externalRuntime:'Java 21; no Node, ROM, upstream checkout, screenshot or acceptance answers required',networkUsed:false,
  jarSha256:sha256(fs.readFileSync(jar)),s6ManifestSha256:actual[0].resourceVersion,embeddedTranslationResources:true,embeddedCaptureComponent:true,sourceAndAnswersAbsent:true,tamperedResourceRejected:tamperedRejected,checks:['original unique text including known localization error','current unknown player literal','original name lexicon','version conflict fallback','explicit version selection','incomplete actor fallback','placeholder rejection','restart clears automatic identity','changed embedded resource rejected'],results:actual.map((r,i)=>({request:requests[i],output:r.regions[0].units.map(u=>u.output),player:r.player}))};
fs.mkdirSync(path.join(root,'reports/s7-integration'),{recursive:true});fs.writeFileSync(path.join(root,'reports/s7-integration/package-checks.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({passed:true,requests:requests.length,jarSha256:report.jarSha256}));
