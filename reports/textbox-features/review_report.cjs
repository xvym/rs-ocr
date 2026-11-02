// Offline report QA. Requires Playwright and a locally installed Chrome.
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
let chromium;
try { ({chromium}=require('playwright')); }
catch { ({chromium}=require('C:/Users/xvym/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')); }

(async()=>{
  const dir=__dirname;
  const data=JSON.parse(fs.readFileSync(path.join(dir,'features.json'),'utf8'));
  const report=fs.readFileSync(path.join(dir,'index.html'),'utf8');
  const audit=path.join(dir,'audit');
  fs.mkdirSync(audit,{recursive:true});
  const broken=[];
  for (const m of report.matchAll(/(?:src|href)="([^"]+)"/g)) {
    const target=m[1];
    if (/^(https?:|data:|#)/.test(target)) continue;
    if (!fs.existsSync(path.resolve(dir,target))) broken.push(target);
  }
  if(broken.length) throw new Error('Broken local links: '+JSON.stringify(broken));
  const edge='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
  const browserPath=process.env.CHROME_PATH || (fs.existsSync(edge)?edge:'C:/Program Files/Google/Chrome/Application/chrome.exe');
  const browser=await chromium.launch({executablePath:browserPath,headless:true,args:['--disable-gpu','--no-sandbox']});
  try {
    const page=await browser.newPage({viewport:{width:1480,height:1080},deviceScaleFactor:1});
    const errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.goto(pathToFileURL(path.join(dir,'index.html')).href,{waitUntil:'networkidle'});
    if(await page.locator('article').count()!==51)throw new Error('Unexpected profile count');
    await page.screenshot({path:path.join(audit,'overview.png')});
    await page.locator('#search').fill('summary');
    const expected=data.profiles.filter(p=>p.key.includes('summary')).length;
    if(await page.locator('article:visible').count()!==expected)throw new Error('Filter mismatch');
    for(const key of ['summary_battle_moves','condition_graph','party_cancel','save_summary']) {
      await page.locator('#search').fill(key);
      const card=page.locator('article:visible').first();
      await card.locator('figure img').waitFor({state:'visible'});
      await page.waitForFunction(()=>Array.from(document.querySelectorAll('article:not([hidden]) figure img')).every(i=>i.complete&&i.naturalWidth>0));
      await card.screenshot({path:path.join(audit,key+'.png')});
    }
    await page.locator('#search').fill('save_summary');
    await page.locator('article:visible summary').click();
    if(await page.locator('article:visible tbody tr').count()!==4)throw new Error('Save variants missing');
    if(errors.length)throw new Error('Browser errors: '+JSON.stringify(errors));
    const result={status:'passed',profile_cards:51,filtering:true,save_variant_rows:4,local_links:true,page_errors:errors};
    fs.writeFileSync(path.join(audit,'browser-checks.json'),JSON.stringify(result,null,2)+'\n');
    console.log(JSON.stringify(result));
  } finally { await browser.close(); }
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
