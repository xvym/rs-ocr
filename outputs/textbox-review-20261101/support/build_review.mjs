import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {Workbook, SpreadsheetFile} from '@oai/artifact-tool';

const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,'../../..');
const output=path.resolve(here,process.argv[2]||'../文本框分类审阅.xlsx');
const wb=Workbook.create();
const nativeLinks=[];
function addLink(sheet,address,target,label){sheet.getRange(address).values=[[label]];nativeLinks.push({sheet:sheet.name,address,target,label});}
const summary=wb.worksheets.add('审阅总览');
const documents={};
for(const p of ['gba','ngc'])documents[p]=JSON.parse(await fs.readFile(path.join(root,'reports/textbox-catalog',p+'.json'),'utf8'));
const assets=JSON.parse(await fs.readFile(path.join(here,'review_images.json'),'utf8'));
const sheets={};
for(const purpose of ['类型审阅','逐图审阅','区域明细'])for(const p of ['gba','ngc'])sheets[p+purpose]=wb.worksheets.add(p.toUpperCase()+purpose);
const palette={ink:'#183447',header:'#243E56',light:'#F1F5F9',input:'#FFF3D3',link:'#066EA8'};
const stateLabels={visible:'有可见文字',empty:'空文字框',heading_only_body_empty:'有标题，正文为空',fully_occluded:'完全被遮挡',missing_gba_sample:'待补 GBA 样本'};
const link=(target,label)=>`=HYPERLINK("${target.replaceAll('"','""')}","${label.replaceAll('"','""')}")`;
const originalLink=(r)=>link(pathToFileURL(path.join(root,r.source)).href,'查看原图');
const box=b=>'['+b.join(', ')+']';
function compactIds(ids){if(!ids.length)return '';const numbers=ids.map(v=>Number(v.slice(-3)));const prefix=ids[0].slice(0,-3);const runs=[];for(let i=0;i<numbers.length;i++){let last=numbers[i];const first=last;while(i+1<numbers.length&&numbers[i+1]===last+1)last=numbers[++i];const pad=n=>String(n).padStart(3,'0');runs.push(prefix+pad(first)+(last===first?'':'～'+prefix+pad(last)));}return runs.join('；');}
function col(n){let s='';for(n++;n;n=Math.floor((n-1)/26))s=String.fromCharCode(65+(n-1)%26)+s;return s;}
function baseSheet(s,title,note,source,headers,rows,widths,tableName,height){
  const last=6+rows.length,end=col(headers.length-1);
  s.showGridLines=false;
  s.getRange(`A1:${end}${last}`).format.font={name:'Arial',size:11,color:palette.ink};
  s.getRange(`A1:${end}${last}`).format.verticalAlignment='center';
  s.getRange(`A1:${end}${last}`).format.rowHeight=24;
  s.getRange('A2').values=[[title]];s.getRange('A2').format.font={size:16,bold:true};
  s.getRange(`A2:${end}2`).format.borders={bottom:{style:'thin',color:'#AEBFCC'}};
  s.getRange('A3').values=[[note]];s.getRange('A4').values=[[source]];
  s.getRange('A3:A4').format.font={size:11,color:'#586C7C',italic:true};
  s.getRange(`A6:${end}6`).values=[headers];
  s.getRange(`A7:${end}${last}`).values=rows;
  const table=s.tables.add(`A6:${end}${last}`,true,tableName);table.showFilterButton=true;table.style='TableStyleLight1';
  s.getRange(`A7:${end}${last}`).format.fill='#FFFFFF';
  for(let row=8;row<=last;row+=2)s.getRange(`A${row}:${end}${row}`).format.fill='#F3F6FA';
  s.getRange(`A6:${end}6`).format={fill:palette.header,font:{name:'Arial',size:11,bold:true,color:'#FFFFFF'},rowHeight:30,horizontalAlignment:'center',verticalAlignment:'center',wrapText:true};
  s.getRange(`A6:${end}6`).format.borders={insideVertical:{style:'thin',color:'#FFFFFF'}};
  s.getRange(`A7:${end}${last}`).format.rowHeightPx=height;
  for(let i=0;i<headers.length;i++)s.getRange(`${col(i)}1:${col(i)}${last}`).format.columnWidthPx=widths[i];
  s.getRange(`A7:${end}${last}`).format.wrapText=true;
  s.freezePanes.freezeRows(6);s.freezePanes.freezeColumns(2);
  return last;
}
function reviewControls(s,last,additionalInputs=[]){
  const statuses=s.getRange(`B7:B${last}`);
  statuses.dataValidation={rule:{type:'list',values:['未审阅','通过','需修改','待确认']}};
  statuses.format.fill=palette.input;
  for(const c of ['C',...additionalInputs])s.getRange(`${c}7:${c}${last}`).format.fill=palette.input;
  for(const [status,fill,color] of [['需修改','#FDE2E2','#9B1C1C'],['待确认','#FFF0C2','#805B00'],['通过','#E4F3EA','#28623D']]){
    statuses.conditionalFormats.add('containsText',{text:status,format:{fill,font:{color,bold:status==='需修改'}}});
  }
}
const idMaps={};
for(const p of ['gba','ngc']){
  const d=documents[p],typeAssets=assets[p],defs=Object.fromEntries([...(d.excluded_region_types||[]),...d.region_types].map(v=>[v.key,v]));
  idMaps[p]=Object.fromEntries(typeAssets.map(v=>[v.key,v.id]));
  const s=sheets[p+'类型审阅'];s.tabColor=p==='gba'?'#1F4E78':'#62538C';
  const rows=d.region_types.map((t,i)=>{
    const a=typeAssets[i];
    const state=stateLabels[a.text_state]||a.text_state;
    return [a.id,t.review_status||'未审阅',t.review_comment||'',t.group,t.name,a.missingSample?'待补 GBA 样本':'',a.missingSample?'位置参考 NGC-116，未混用截图':'',t.image_count,(t.logical_box_provisional?'参考 ':'')+box(t.logical_box),'',t.content,'',a.representative,
      [t.note,state==='有可见文字'?'':`代表图状态：${state}`,a.occluded_by.length?'代表图有遮挡：'+a.occluded_by.map(k=>defs[k].name).join('、'):''].filter(Boolean).join('；'),compactIds(t.example_ids),t.key,t.appearance];
  });
  const last=baseSheet(s,p.toUpperCase()+' 文本框类型审阅','浅黄色列可填写；红框标出代表图中的区域。坐标为 [x,y,宽,高]，逻辑画面 240×160。',
    `来源：reports/textbox-catalog/${p}.json；${d.image_count} 张截图，${d.region_type_count} 类。代表图中的文字可能为空或被遮挡，见“已有说明”。`,
    ['类型编号','审阅状态','审阅意见','类别','区域名称','位置预览（红框）','局部截图','样本数','现有逻辑坐标','建议逻辑坐标','可见内容','原图链接','代表截图编号','已有说明','全部样本编号','区域键','外观与字体目视描述'],
    rows,[110,105,280,130,235,360,272,80,180,180,330,105,125,360,620,270,360],p.toUpperCase()+'TypeReview',264);
  reviewControls(s,last,['J']);
  s.getRange(`H7:H${last}`).setNumberFormat('0');
  s.getRange(`I7:J${last}`).format.font={name:'Consolas',size:11};
  for(let i=0;i<typeAssets.length;i++){
    const a=typeAssets[i],row=i+7;
    if(a.missingSample){s.getRange(`L${row}`).values=[['待补样本']];continue;}
    addLink(s,`L${row}`,pathToFileURL(path.join(root,a.source)).href,'查看原图');
    s.getRange(`L${row}`).format.font={color:palette.link};
    for(const [key,column,width] of [['context',5,348],['crop',6,260]]){
      const data=await fs.readFile(a[key]);
      s.images.add({dataUrl:'data:image/png;base64,'+data.toString('base64'),anchor:{from:{row:row-1,col:column,rowOffsetPx:6,colOffsetPx:6},extent:{widthPx:width,heightPx:252}}});
    }
  }
console.log(s.name,rows.length,'review rows,',typeAssets.filter(a=>!a.missingSample).length*2,'embedded images');

  const imageSheet=sheets[p+'逐图审阅'];
  const imageRows=d.images.map(r=>[r.id,r.review_status||'未审阅',r.review_comment||'',r.layout,'',r.regions.length,[...new Set(r.regions.map(v=>defs[v.type].group))].join('、'),[...r.observations,r.scope_note].filter(Boolean).join('；'),
    r.regions.map(v=>idMaps[p][v.type]+' '+defs[v.type].name).join('\n'),r.regions.filter(v=>v.occluded_by.length).map(v=>defs[v.type].name+' ← '+v.occluded_by.map(k=>defs[k].name).join('、')).join('\n'),
    r.regions.filter(v=>v.text_state!=='visible').map(v=>defs[v.type].name+'：'+stateLabels[v.text_state]).join('\n'),box(r.viewport_original),r.source,r.sha256,
    r.external_text_regions.map(v=>v.name+' '+box(v.original_box)+' '+v.content).join('；')]);
  const imageLast=baseSheet(imageSheet,p.toUpperCase()+' 逐图审阅','本页状态与类型审阅独立。可按页面、类别或现有备注筛选，再通过链接打开原图。',
    `来源：reports/textbox-catalog/${p}.json 的 images；保留全部 ${d.image_count} 张截图。`,
    ['截图编号','审阅状态','审阅意见','页面／状态','原图链接','本轮区域数','类别','现有状态备注','区域类型清单','遮挡关系','空框／文字状态','游戏视口（原图）','原图文件','SHA-256','外层设备文字'],
    imageRows,[115,105,300,210,105,105,210,400,560,460,360,210,500,520,540],p.toUpperCase()+'ImageReview',72);
  reviewControls(imageSheet,imageLast);
  imageSheet.getRange(`F7:F${imageLast}`).setNumberFormat('0');
  d.images.forEach((r,i)=>addLink(imageSheet,`E${i+7}`,pathToFileURL(path.join(root,r.source)).href,'查看原图'));
  imageSheet.getRange(`E7:E${imageLast}`).format.font={color:palette.link};
  for(let i=0;i<imageRows.length;i++){
    const needed=Math.max(...[2,7,8,9,10].map(c=>String(imageRows[i][c]).split('\n').reduce((n,line)=>n+Math.max(1,Math.ceil(line.length/Math.floor([115,105,300,210,105,105,210,400,560,460,360][c]/14))),0)));
    if(needed>3)imageSheet.getRange(`A${i+7}:O${i+7}`).format.rowHeightPx=Math.min(320,needed*21+10);
  }

  const detail=sheets[p+'区域明细'];
  const detailRows=[];const detailSources=[];
  for(const r of d.images)for(const v of r.regions){
    detailRows.push([v.instance_id,r.id,idMaps[p][v.type],defs[v.type].name,...v.logical_box,...v.original_box,stateLabels[v.text_state],v.occluded_by.map(k=>defs[k].name).join('、'),v.visible_logical_rectangles.map(box).join('；'),'',r.layout]);detailSources.push(r);
  }
  const detailLast=baseSheet(detail,p.toUpperCase()+' 区域明细','每行对应一个截图中的一个区域。完整候选框与可见几何分开保留，隐藏文字不补出。',
    `来源：reports/textbox-catalog/${p}.json 的 images[].regions；${detailRows.length} 个游戏内区域。`,
    ['区域实例编号','截图编号','类型编号','区域名称','逻辑 X','逻辑 Y','逻辑宽','逻辑高','原图 X','原图 Y','原图宽','原图高','文字状态','被哪些区域遮挡','可见逻辑矩形','原图链接','页面／状态'],
    detailRows,[180,120,115,255,75,75,75,75,80,80,80,80,200,360,460,110,220],p.toUpperCase()+'RegionDetails',72);
  detail.getRange(`E7:L${detailLast}`).setNumberFormat('0');detail.getRange(`E7:L${detailLast}`).format.horizontalAlignment='right';
  detailSources.forEach((r,i)=>addLink(detail,`P${i+7}`,pathToFileURL(path.join(root,r.source)).href,'查看原图'));
  detail.getRange(`P7:P${detailLast}`).format.font={color:palette.link};
}

summary.showGridLines=false;summary.tabColor='#243E56';
summary.getRange('A1:H43').format.font={name:'Arial',size:11,color:palette.ink};
summary.getRange('A1:H43').format.rowHeight=25;
summary.getRange('A1:H43').format.verticalAlignment='center';
for(const [i,w] of [180,95,110,110,110,110,110,120].entries())summary.getRange(`${col(i)}1:${col(i)}43`).format.columnWidthPx=w;
summary.getRange('A2').values=[['文本框分类审阅']];summary.getRange('A2').format.font={size:16,bold:true};
summary.getRange('A2:H2').format.borders={bottom:{style:'thin',color:'#AEBFCC'}};
summary.getRange('A3').values=[[`资料日期：2026-11-01。本轮保留 GBA ${assets.gba.length} 类、NGC ${assets.ngc.length} 类，状态统计随填写更新。`]];
summary.getRange('A5:H5').values=[['审阅层级','记录数','未审阅','通过','需修改','待确认','空状态','通过比例']];
summary.getRange('A5:H5').format={fill:palette.header,font:{name:'Arial',size:11,bold:true,color:'#FFFFFF'},horizontalAlignment:'center',rowHeight:28};
const progress=[['GBA 类型','GBA类型审阅',assets.gba.length],['NGC 类型','NGC类型审阅',assets.ngc.length],['GBA 逐图','GBA逐图审阅',documents.gba.images.length],['NGC 逐图','NGC逐图审阅',documents.ngc.images.length]];
for(let i=0;i<progress.length;i++){
  const [label,name,n]=progress[i],r=i+6,last=n+6;
  summary.getRange(`A${r}`).values=[[label]];
  summary.getRange(`B${r}`).formulas=[[`=COUNTA('${name}'!$A$7:$A$${last})`]];
  summary.getRange(`C${r}:F${r}`).formulas=[['未审阅','通过','需修改','待确认'].map((s,j)=>`=COUNTIFS('${name}'!$B$7:$B$${last},${col(j+2)}$5)`)];
  summary.getRange(`G${r}`).formulas=[[`=COUNTBLANK('${name}'!$B$7:$B$${last})`]];
  summary.getRange(`H${r}`).formulas=[[`=IF(B${r}=0,0,D${r}/B${r})`]];
}
summary.getRange('B6:G9').setNumberFormat('0');summary.getRange('H6:H9').setNumberFormat('0%');
summary.getRange('E6:E9').conditionalFormats.add('cellIs',{operator:'greaterThan',formula:0,format:{fill:'#FDE2E2',font:{color:'#9B1C1C',bold:true}}});
summary.getRange('G6:G9').conditionalFormats.add('cellIs',{operator:'greaterThan',formula:0,format:{fill:'#FFF0C2',font:{color:'#805B00'}}});
summary.getRange('A12:C12').values=[['区域明细','区域数量','说明']];
summary.getRange('A12:C12').format={fill:palette.header,font:{color:'#FFFFFF',bold:true},horizontalAlignment:'center'};
for(const [p,r] of [['gba',13],['ngc',14]]){
  const n=documents[p].images.reduce((a,r)=>a+r.regions.length,0);
  summary.getRange(`A${r}`).values=[[p.toUpperCase()]];
  summary.getRange(`B${r}`).formulas=[[`=COUNTA('${p.toUpperCase()}区域明细'!$A$7:$A$${n+6})`]];
}
summary.getRange('C13').values=[['游戏内文字区域']];summary.getRange('C14').values=[['外框设备提示在逐图表单列']];
summary.getRange('A17').values=[['审阅入口']];summary.getRange('A17').format.font={bold:true};
for(const [i,name] of ['GBA类型审阅','NGC类型审阅','GBA逐图审阅','NGC逐图审阅','GBA区域明细','NGC区域明细'].entries()){
  addLink(summary,`A${i+18}`,`#'${name}'!A1`,name);summary.getRange(`A${i+18}`).format.font={color:palette.link};
}
summary.getRange('D18').values=[['类型页含嵌入预览与局部截图，可脱离原图目录查看。']];
summary.getRange('D19').values=[['逐图页保留全部截图与状态备注，原图链接使用本机位置。']];
summary.getRange('D20').values=[['区域明细保留逐实例数值坐标，可按截图或类型筛选。']];
summary.getRange('A26').values=[['填写方式与坐标']];summary.getRange('A26').format.font={bold:true};
const instructions=[
 '浅黄色为可填写字段：审阅状态、审阅意见，以及类型页中的建议逻辑坐标。',
 '先审阅类型与代表图，再按需要核对逐图表；这两种审阅状态独立记录。',
 '状态可选：未审阅、通过、需修改、待确认。空状态单独统计，避免误记为已审阅。',
 '逻辑坐标格式为 [x,y,宽,高]，左上角为原点，按 240×160 游戏画面表示。',
 '现有框是人工近似区域，包含边框和留白，约 ±3 个逻辑像素；尚未像素级校准。',
 'GBA 原图 1200×800，全图归一化；NGC 原图 1600×1200，近似视口 [212,200,1172,800]。',
 '类型页图片标有类型编号和代表截图编号。可据编号核对图片与记录的对应关系。',
 '本次是布局整理，未建立逐字符日文答案，也未验证 OCR 准确率、实时打印或滚动行为。'
];
instructions.forEach((s,i)=>summary.getRange(`A${i+27}`).values=[[s]]);
summary.getRange('A36').values=[['来源与样本缺口']];summary.getRange('A36').format.font={bold:true};
summary.getRange('A37').values=[['来源：reports/textbox-catalog/gba.json、ngc.json；原图来自 gba_testcase 与 ngc_testcase。']];
summary.getRange('A38').values=[['未见 PC 盒子网格、实际寄存/移动页，以及商店出售、数量选择和成交确认页。']];
summary.getRange('A39').values=[['GBA 本批未见树果标签页；NGC 无训练家战斗完整流程。GBA-315 已补齐战斗招式选择。']];
summary.getRange('A40').values=[['未见独立图鉴与宝可导航完整页；没有连续录像，不能验证动态窗口轨迹。']];
summary.getRange('A41').values=[['额外收录的华丽招式、方块盒、混合机与状态图，不代表更改首版产品范围。']];
if(documents.gba.metadata.review_selection)summary.getRange('A42').values=[['已按用户删除的类型行同步范围。原编号保留，排除项存档；保留不等于审阅通过。']];
if(documents.gba.images.some(r=>r.id==='GBA-315'))summary.getRange('A43').values=[['新增 GBA-315：确认 GBA-T073 右下招式信息，并新增 GBA-T074 左下四招式菜单。']];

wb.recalculate();
console.log((await wb.inspect({kind:'table',range:'审阅总览!A5:H14',include:'values,formulas',tableMaxRows:10,tableMaxCols:8,maxChars:5000})).ndjson);
// Verify that review totals respond to a user's status change, then restore it.
const test=sheets.gba类型审阅;test.getRange('B7').values=[['需修改']];wb.recalculate();
const changed=summary.getRange('E6').values;if(changed[0][0]!==1)throw new Error('Review progress did not recalculate: '+JSON.stringify(changed));
test.getRange('B7').values=[['未审阅']];wb.recalculate();
if(summary.getRange('E6').values[0][0]!==0)throw new Error('Review state not restored');
const errors=await wb.inspect({kind:'match',searchTerm:'#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!|#SPILL!|#CALC!',options:{useRegex:true,maxResults:30},summary:'Formula errors',maxChars:2500});
console.log(errors.ndjson);
await fs.mkdir(path.join(here,'previews'),{recursive:true});
for(const name of ['审阅总览',...Object.values(sheets).map(s=>s.name)]){
  const range=name==='审阅总览'?'A1:H41':name.endsWith('类型审阅')?'A1:I8':name.endsWith('逐图审阅')?'A1:H10':'A1:M10';
  const image=await wb.render({sheetName:name,range,scale:1,format:'png'});
  await fs.writeFile(path.join(here,'previews',name+'.png'),new Uint8Array(await image.arrayBuffer()));
}
await (await SpreadsheetFile.exportXlsx(wb)).save(output);
await fs.writeFile(path.join(here,'native_links.json'),JSON.stringify(nativeLinks));
await fs.writeFile(path.join(here,'checks.json'),JSON.stringify({sheets:7,images:documents.gba.images.length+documents.ngc.images.length,types:{gba:assets.gba.length,ngc:assets.ngc.length},regions:[...documents.gba.images,...documents.ngc.images].reduce((n,r)=>n+r.regions.length,0),embeddedImages:[...assets.gba,...assets.ngc].filter(a=>!a.missingSample).length*2,progressRecalculation:true,output},null,2));
console.log('Saved '+output);
