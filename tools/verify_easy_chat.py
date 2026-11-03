"""Read-only Japanese Easy Chat dictionaries and 100 native tower greetings.

Matches complete fixed Japanese word tables and every named tower record in
both ROMs. Native record stride/field offsets are established by all 100 names,
not copied from the different US struct. Printing layout remains separately
identified evidence, not an emulated full Japanese game execution.
"""
from pathlib import Path
import hashlib,json,re,struct,sys
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'tools'))
from verify_battle_printing import SOURCE,SHA,all_offsets
from capstone import Cs,CS_ARCH_ARM,CS_MODE_THUMB
from capstone.arm import ARM_OP_IMM
md=Cs(CS_ARCH_ARM,CS_MODE_THUMB);md.detail=True
digest=lambda b:hashlib.sha256(b).hexdigest()
tree=json.loads((SOURCE.parent/'tree.json').read_text(encoding='utf-8-sig'));inputs=[]
for local in ['charmap.txt','src/easy_chat_2.c','src/battle_tower.c','include/global.h','include/constants/easy_chat.h','src/data/battle_tower/trainers.h']:
 b=(SOURCE/local).read_bytes();expected=next(f['sha256'] for f in tree['files'] if f['path']==local);assert digest(b)==expected
 inputs.append({'local':str((SOURCE/local).relative_to(ROOT)).replace('\\','/'),'sha256':expected})
manifest=json.loads((ROOT/'corpus/sources.json').read_text(encoding='utf-8-sig'));columns=[]
for name in ['qid_msg.txt','ja-Hrkt_msg.txt']:
 s=next(s for s in manifest['sources'] if Path(s['local']).name==name);b=(ROOT/s['local']).read_bytes();assert digest(b)==s['sha256']
 inputs.append({'local':s['local'],'sha256':s['sha256']});columns.append(b.decode('utf-8-sig').splitlines())
records=dict(zip(*columns,strict=True))
chars={k:int(v,16) for k,v in re.findall(r"^'([^']+)'\s*=\s*([0-9A-F]{2})\s*(?:@[^\n]*)?$",(SOURCE/'charmap.txt').read_text(encoding='utf-8-sig'),re.M) if len(k)==1}
chars['　']=0;chars[' ']=0
def encode(text):
 text=re.sub('[０-９]',lambda m:chr(ord(m[0])-0xfee0),text)
 return bytes(chars[c] for c in text)
groups={int(n,16):name.lower() for name,n in re.findall(r'^#define EC_GROUP_(\w+)\s+0x([0-9a-f]+)',(SOURCE/'include/constants/easy_chat.h').read_text(),re.M)}
tables={group:[(q,t) for q,t in records.items() if q.startswith('rs.common.easy_chat_group_'+name+'.') and t] for group,name in groups.items() if group not in [0,18,19,21]}
roms=[];all_greetings=[]
for file in sorted((ROOT/'rom-resource').glob('*.gba')):
 b=file.read_bytes();game=b[0xac:0xb0].decode();assert digest(b)==SHA[game]
 dictionary=[]
 for group,rows in tables.items():
  blob=b''.join(encode(t)+b'\xff' for q,t in rows);hits=all_offsets(b,blob);assert len(hits)==1,(game,group,hits)
  dictionary.append({'group':group,'name':groups[group],'offset':hits[0],'words':len(rows),'sha256':digest(blob)})
 group_table=struct.unpack_from('<I',b,0xe68d4)[0]-0x08000000
 for d in dictionary:assert struct.unpack_from('<I',b,group_table+4*d['group'])[0]==0x08000000+d['offset']
 def word_bytes(word):
  if word==65535:return b''
  group,index=word>>9,word&511
  if group in [0,21]:p=struct.unpack_from('<I',b,0xe6890)[0]-0x08000000+index*6
  elif group in [18,19]:p=struct.unpack_from('<I',b,0xe689c)[0]-0x08000000+index*8
  else:
   p=struct.unpack_from('<I',b,group_table+4*group)[0]-0x08000000
   for _ in range(index):p=b.index(255,p)+1
  return b[p:b.index(255,p)]
 def execute_greeting(pointer,ids):
  regs={f'r{i}':0 for i in range(13)};regs.update({'sb':0,'sl':0,'fp':0,'ip':0,'sp':0x03007f00,'lr':0x01000001});regs['r0']=pointer
  ram={};pc=0x081300dc;comparison=(0,0);calls=[]
  if pointer==0x0203e000:ram.update({pointer+i:v for i,v in enumerate(struct.pack('<6H',*ids))})
  def load(a,n):
   if 0x08000000<=a<0x08800000:return int.from_bytes(b[a-0x08000000:a-0x08000000+n],'little')
   assert all(a+i in ram for i in range(n)),hex(a)
   return sum(ram[a+i]<<(8*i) for i in range(n))
  def write(a,n,v):
   assert 0x02000000<=a<0x02040000 or 0x03000000<=a<0x03008000,hex(a)
   for i in range(n):ram[a+i]=(v>>(8*i))&255
  def signed(v):return v if v<0x80000000 else v-0x100000000
  for step in range(60000):
   if pc==0x01000000:break
   ins=next(md.disasm(b[pc-0x08000000:pc-0x08000000+4],pc,count=1));ops=ins.operands;m=ins.mnemonic;nxt=pc+ins.size
   reg=lambda op:ins.reg_name(op.reg)
   val=lambda op:op.imm if op.type==ARM_OP_IMM else regs[reg(op)]
   if m=='push':
    regs['sp']-=len(ops)*4
    for i,o in enumerate(ops):write(regs['sp']+i*4,4,regs[reg(o)])
   elif m=='pop':
    for i,o in enumerate(ops):regs[reg(o)]=load(regs['sp']+i*4,4)
    regs['sp']+=len(ops)*4
   elif m in ['mov','movs']:regs[reg(ops[0])]=val(ops[1])
   elif m in ['adds','subs','add','sub']:
    a=regs[reg(ops[0])] if len(ops)==2 else val(ops[1]);v=val(ops[-1]);regs[reg(ops[0])]=(a+v if m.startswith('add') else a-v)&0xffffffff
   elif m in ['lsls','lsrs']:
    a,n=val(ops[1]),val(ops[2]);regs[reg(ops[0])]=((a<<n) if m=='lsls' else (a>>n))&0xffffffff
   elif m=='ands':regs[reg(ops[0])]&=val(ops[1])
   elif m in ['ldr','ldrb','ldrh','str','strb']:
    mem=ops[1].mem;base=ins.reg_name(mem.base);a=(((pc+4)&~3) if base=='pc' else regs[base])+mem.disp
    if mem.index:a+=regs[ins.reg_name(mem.index)]
    size=1 if m.endswith('b') else 2 if m.endswith('h') else 4
    if m.startswith('ld'):regs[reg(ops[0])]=load(a,size)
    else:write(a,size,val(ops[0]))
   elif m=='cmp':comparison=(val(ops[0]),val(ops[1]))
   elif m in ['bhs','blo','beq','bne','bhi','bls','bgt','bge']:
    a,c=comparison
    if {'bhs':a>=c,'blo':a<c,'beq':a==c,'bne':a!=c,'bhi':a>c,'bls':a<=c,'bgt':signed(a)>signed(c),'bge':signed(a)>=signed(c)}[m]:nxt=ops[0].imm
   elif m=='b':nxt=ops[0].imm
   elif m=='bx':nxt=val(ops[0])&~1
   elif m=='bl':
    target=ops[0].imm
    if target==0x080e6710:
     # Declared leaf: copy exactly the native word bytes from the verified
     # group table, species or move field. No English/Chinese text is used.
     data=word_bytes(regs['r1']);dest=regs['r0']
     for i,v in enumerate(data+b'\xff'):write(dest+i,1,v)
     regs['r0']=dest+len(data)
    else:
     assert target in [0x080e68f0,0x080e6854,0x080e67c4],hex(target)
     if target==0x080e67c4:calls.append({'wordsPerRow':regs['r2'],'rows':regs['r3'],'destination':regs['r0']})
     regs['lr']=nxt|1;nxt=target
   else:raise AssertionError((hex(pc),m,ins.op_str))
   pc=nxt
  else:raise AssertionError('Native greeting instruction budget')
  assert len(calls)==1
  dest=calls[0]['destination'];data=[]
  for i in range(1024):
   v=load(dest+i,1)
   if v==255:break
   data.append(v)
  else:raise AssertionError('Native greeting terminator')
  cols=calls[0]['wordsPerRow']
  # Spaces before empty final words are significant native output; reconstruct
  # with the actual native rule instead of joining only nonempty words.
  rows=[b''.join(word_bytes(w)+(b'\x00' if j<cols-1 and w!=65535 else b'') for j,w in enumerate(ids[i:i+cols])) for i in range(0,6,cols)]
  expected=rows[0]+b'\xfe'+(rows[1] if cols==3 else rows[1]+b'\xfa'+rows[2])
  assert bytes(data)==expected,(cols,data,list(expected))
  return {'wordsPerRow':cols,'rows':len(rows),'nativeOutputSha256':digest(bytes(data)),'steps':step,'passed':True}
 names=[records[f'rs.common.battle_tower_trainers.gBattleTowerTrainers.{i}'] for i in range(100)]
 first=all_offsets(b,encode(names[0]));assert len(first)==1
 base=first[0]-1;stride=20;greeting_offset=6
 for i,name in enumerate(names):
  assert b[base+i*stride+1:base+i*stride+1+len(encode(name))]==encode(name),(game,i)
  # All fixed Japanese names occupy three bytes, not the US eight-byte field.
  assert len(encode(name))<=3
  assert set(b[base+i*stride+1+len(encode(name)):base+i*stride+4])<={0,255}
  ids=struct.unpack_from('<6H',b,base+i*stride+greeting_offset);words=[]
  for word in ids:
   group,index=word>>9,word&511
   if group in [0,21]:qid=f'rs.common.species_names.gSpeciesNames.{index}'
   elif group in [18,19]:qid=f'rs.common.move_names.gMoveNames.{index}'
   elif word==65535:words.append({'word':word,'japanese':'','qid':None});continue
   else:qid=tables[group][index][0]
   assert qid in records
   assert word_bytes(word)==encode(records[qid]),(game,word,qid)
   words.append({'word':word,'qid':qid,'japanese':records[qid]})
  printing=execute_greeting(0x08000000+base+i*stride+greeting_offset,ids)
  all_greetings.append({'gameCode':game,'trainerIndex':i,'name':name,'recordOffset':base+i*stride,'words':words,'printing':printing})
 stress=[{'case':'declared_overlength_words_not_a_fixed_greeting',**execute_greeting(0x0203e000,[0x0210]*6)},
         {'case':'declared_empty_words_not_a_fixed_greeting',**execute_greeting(0x0203e000,[65535]*6)}]
 assert stress[0]['wordsPerRow']==2 and stress[1]['wordsPerRow']==3
 roms.append({'gameCode':game,'sha256':digest(b),'dictionaries':dictionary,'groupPointerTableOffset':group_table,'towerTableOffset':base,'nativeStride':stride,'nameFieldBytes':3,'greetingFieldOffset':greeting_offset,'towerTableSha256':digest(b[base:base+100*stride]),'verifiedRecords':100,'declaredStressCases':stress,
  'printingCode':[{'start':p,'endExclusive':q,'sha256':digest(b[p:q])} for p,q in [(0x1300dc,0x13014c),(0xe67c4,0xe6854),(0xe6854,0xe68f0),(0xe68f0,0xe6958)]]})
out={'schemaVersion':1,'implementationSha256':digest(Path(__file__).read_bytes()),'sourceInputs':inputs,'roms':roms,'greetings':all_greetings,
 'method':'Every Japanese word table is matched in full; all 100 native three-byte trainer names at stride 20 establish the Japanese record identity and six encoded word fields at +6. Both ROM hashes verified.',
 'printingBoundary':'Restricted execution of the Japanese wrapper, native word-length lookup, line-width predicate and formatter for each fixed greeting. Word-copy leaf copies independently verified native table bytes. Japanese selects 3x2 unless either three-word row exceeds 20 characters, then 2x3 with a scroll. No full text renderer, live script, record-mixing or e-Reader execution.',
 'scope':'Native fixed greetings only. Record mixing and e-Reader user compositions remain arbitrary and require complete phrase semantics, not Chinese word-gloss concatenation.'}
dest=ROOT/'reports/s6-corpus/easy-chat-native-evidence.json';dest.parent.mkdir(exist_ok=True,parents=True);dest.write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n',encoding='utf-8',newline='\n')
print('Verified Japanese Easy Chat word dictionaries and 100 encoded tower greetings in each ROM')
