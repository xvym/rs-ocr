const {chromium}=require('C:/Users/xvym/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const fs=require('node:fs/promises');
(async()=>{
  const browser=await chromium.launch({headless:true,channel:'chrome'});
  try {
  const page=await browser.newPage({viewport:{width:1280,height:1000},deviceScaleFactor:1});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const root=path.resolve(__dirname,'../../../reports/textbox-catalog');
  await page.goto(pathToFileURL(path.join(root,'index.html')).href);
  const summary=await page.locator('main').innerText();
  if(!summary.includes('GBA 45 类、NGC 47 类')||!summary.includes('585 个区域'))throw Error('Summary counts differ');
  for(const [platform,count] of [['gba',45],['ngc',47]]){
    await page.goto(pathToFileURL(path.join(root,platform+'.html')).href);
    const actual=await page.locator('#types tr').count();
    if(actual!==count)throw Error(`${platform}: ${actual} type rows`);
    const first=page.locator('#types button').first();
    await first.click();
    console.log(platform,await page.locator('#stats').innerText(),'type filter clicked');
  }
  if(errors.length)throw Error(errors.join('\n'));
  const validationPath=path.join(root,'validation.json');
  const validation=JSON.parse(await fs.readFile(validationPath,'utf8'));
  validation.browser_checks={summary_counts:true,type_table_rows:{gba:45,ngc:47},type_filtering:true,page_errors:[]};
  await fs.writeFile(validationPath,JSON.stringify(validation,null,2)+'\n');
  console.log('Report summary, HTML tables and interactive type filtering passed.');
  } finally { await browser.close(); }
})().catch(e=>{console.error(e);process.exitCode=1});
