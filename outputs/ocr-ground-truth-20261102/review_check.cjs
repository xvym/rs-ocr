// Local offline artifact QA; does not access or change a user's browser session.
const fs=require('node:fs');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
let chromium;
try{({chromium}=require('playwright'))}
catch{({chromium}=require('C:/Users/xvym/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'))}
(async()=>{
  const data=JSON.parse(fs.readFileSync(path.join(__dirname,'ground_truth.json'),'utf8'));
  const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--disable-gpu']});
  const errors=[];
  try{
    const page=await browser.newPage({viewport:{width:1400,height:1000},deviceScaleFactor:1});
    page.on('pageerror',e=>errors.push(e.message));
    await page.goto(pathToFileURL(path.join(__dirname,'review.html')).href,{waitUntil:'load'});
    if(await page.locator('article:visible').count()!==574)throw Error('Initial recognition target count');
    await page.screenshot({path:path.join(__dirname,'sheets','review-overview.png')});
    await page.locator('#platform').selectOption('gba');
    if(await page.locator('article:visible').count()!==371)throw Error('GBA filter');
    await page.locator('#platform').selectOption('ngc');
    if(await page.locator('article:visible').count()!==203)throw Error('NGC filter');
    await page.locator('#platform').selectOption('');
    await page.locator('#scope').selectOption('excluded');
    if(await page.locator('article:visible').count()!==11)throw Error('Excluded region filter');
    await page.screenshot({path:path.join(__dirname,'sheets','review-excluded.png')});
    await page.locator('#scope').selectOption('');
    if(await page.locator('article:visible').count()!==585)throw Error('Archive count');
    await page.locator('#scope').selectOption('active');
    await page.locator('#q').fill('GBA-090-R03');
    if(await page.locator('article:visible').count()!==1)throw Error('Restored complete battle prompt missing');
    await page.locator('#q').fill('NGC-099-R03');
    if(await page.locator('article:visible').count()!==0)throw Error('Clipped FEEL region restored incorrectly');
    await page.locator('#q').fill('GBA-234-R03');
    if(await page.locator('article:visible').count()!==1)throw Error('ID search');
    if(!(await page.locator('article:visible pre').textContent()).includes('ねむる'))throw Error('Corrected transcript not displayed');
    await page.locator('#q').fill('カイオーガ');
    const expected=data.regions.filter(r=>r.recognition_in_scope&&(r.instance_id+' '+r.region_type+' '+r.region_name+' '+r.text).includes('カイオーガ')).length;
    if(await page.locator('article:visible').count()!==expected)throw Error('Japanese search');
    await page.locator('#q').fill('GBA-001-R01');
    const broken=await page.locator('article:visible img').evaluateAll(imgs=>imgs.filter(i=>!i.complete||i.naturalWidth===0).map(i=>i.src));
    if(broken.length)throw Error('Broken visible image');
    if(errors.length)throw Error(errors.join('; '));
    const result={status:'passed',article_count:585,recognition_target_count:574,gba_filter_count:371,ngc_filter_count:203,excluded_filter_count:11,restored_prompt_visible:true,clipped_feel_excluded:true,id_search:true,japanese_search:true,visible_image_loaded:true,page_errors:errors};
    fs.writeFileSync(path.join(__dirname,'browser-validation.json'),JSON.stringify(result,null,2)+'\n');
    process.stdout.write(JSON.stringify(result));
  }finally{await browser.close()}
})().catch(e=>{process.stderr.write(String(e));process.exitCode=1});
