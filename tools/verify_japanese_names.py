"""Verify fixed Japanese naming templates and their native caret bounds, read-only."""
from pathlib import Path
import hashlib,json,re,struct,sys
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'tools'))
from verify_battle_printing import SHA,SOURCE,all_offsets
from capstone import Cs,CS_ARCH_ARM,CS_MODE_THUMB
from capstone.arm import ARM_OP_IMM
digest=lambda b:hashlib.sha256(b).hexdigest()
read=lambda p:p.read_text(encoding='utf-8-sig')
tree=json.loads(read(SOURCE.parent/'tree.json'));inputs=[]
for local in ['charmap.txt','src/naming_screen.c','include/naming_screen.h']:
    data=(SOURCE/local).read_bytes();expected=next(f['sha256'] for f in tree['files'] if f['path']==local);assert digest(data)==expected
    inputs.append({'local':str((SOURCE/local).relative_to(ROOT)).replace('\\','/'),'sha256':expected})
manifest=json.loads(read(ROOT/'corpus/sources.json'));columns=[]
for name in ['qid_msg.txt','ja-Hrkt_msg.txt']:
    s=next(s for s in manifest['sources'] if Path(s['local']).name==name);b=(ROOT/s['local']).read_bytes();assert digest(b)==s['sha256']
    inputs.append({'local':s['local'],'sha256':s['sha256']});columns.append(b.decode('utf-8-sig').splitlines())
records=dict(zip(*columns,strict=True))
chars={k:int(v,16) for k,v in re.findall(r"^'([^']+)'\s*=\s*([0-9A-F]{2})\s*(?:@[^\n]*)?$",read(SOURCE/'charmap.txt'),re.M) if len(k)==1};chars['　']=0
def encode(text):
    parts=re.findall(r'\[STR_VAR_1\]|.',text);return b''.join(b'\xfd\x02' if p=='[STR_VAR_1]' else bytes([chars[p]]) for p in parts)+b'\xff'
titles=['OtherText_YourName','OtherText_BoxName','OtherText_PokeName'];encoded=[encode(records['rs.common.strings2.'+t]) for t in titles]
md=Cs(CS_ARCH_ARM,CS_MODE_THUMB);md.detail=True
roms=[]
for file in sorted((ROOT/'rom-resource').glob('*.gba')):
    rom=file.read_bytes();game=rom[0xac:0xb0].decode('ascii');assert game in SHA and digest(rom)==SHA[game]
    player=all_offsets(rom,encoded[0]);assert len(player)==1
    candidates=[]
    for p in all_offsets(rom,struct.pack('<I',0x08000000+player[0])):
        start=p-8
        if rom[start:start+8]!=bytes([0,5,1,0,0,0,0,0]):continue
        if rom[start+12:start+20]!=bytes([0,8,2,0,0,0,0,0]) or rom[start+24:start+32]!=bytes([0,5,3,1,0,0,0,0]):continue
        ptrs=[struct.unpack_from('<I',rom,start+12*i+8)[0]-0x08000000 for i in range(3)]
        if all(rom[p:p+len(b)]==b for p,b in zip(ptrs,encoded,strict=True)):candidates.append(start)
    assert len(candidates)==1
    base=candidates[0];pointer_table=struct.pack('<IIII',*(0x08000000+base+i for i in [0,12,24,24]))
    tables=all_offsets(rom,pointer_table);assert len(tables)==1
    refs=all_offsets(rom,struct.pack('<I',0x08000000+tables[0]));assert refs==[0xb13fc]
    # The native initializer stores the selected template at data+0x24 and reads
    # byte +1 for name alignment; the caret reader uses that same bounded field.
    initializer=list(md.disasm(rom[0xb13b0:0xb13ca],0x080b13b0))
    assert [(i.mnemonic,i.op_str) for i in initializer][-5:]==[('ldrb','r1, [r0, #1]'),('lsrs','r1, r1, #1'),('movs','r0, #0xe'),('subs','r0, r0, r1'),('strh','r0, [r4, #2]')]
    checks=[]
    for index,limit in enumerate([5,8,5]):
        for count in range(limit+2):
            ptr=0x08000000+base+12*index
            ram={0x02000024+i:b for i,b in enumerate(struct.pack('<I',ptr))}
            ram.update({0x02000011+i:(1 if i<count else 255) for i in range(16)})
            regs={f'r{i}':0 for i in range(16)};pc=0x080b253c;comparison=(0,0)
            def load(address,size):
                if 0x08000000<=address<0x08800000:return int.from_bytes(rom[address-0x08000000:address-0x08000000+size],'little')
                assert all(address+i in ram for i in range(size)),hex(address)
                return sum(ram[address+i]<<(8*i) for i in range(size))
            def value(ins,op):return op.imm if op.type==ARM_OP_IMM else regs[ins.reg_name(op.reg)]
            for step in range(256):
                ins=next(md.disasm(rom[pc-0x08000000:pc-0x08000000+4],pc,count=1));op=ins.operands;m=ins.mnemonic;nxt=pc+ins.size
                if m in ['push','pop']:pass
                elif m in ['movs','mov']:regs[ins.reg_name(op[0].reg)]=value(ins,op[1])
                elif m in ['adds','subs']:
                    reg=ins.reg_name(op[0].reg);a=regs[reg] if len(op)==2 else value(ins,op[1]);b=value(ins,op[-1]);regs[reg]=(a+b if m=='adds' else a-b)&0xffffffff
                elif m in ['lsls','lsrs']:
                    a,b=value(ins,op[1]),value(ins,op[2]);regs[ins.reg_name(op[0].reg)]=((a<<b) if m=='lsls' else (a>>b))&0xffffffff
                elif m in ['ldr','ldrb']:
                    mem=op[1].mem;base_reg=ins.reg_name(mem.base);address=(((pc+4)&~3) if base_reg=='pc' else regs[base_reg])+mem.disp
                    regs[ins.reg_name(op[0].reg)]=load(address,4 if m=='ldr' else 1)
                elif m=='cmp':comparison=(value(ins,op[0]),value(ins,op[1]))
                elif m in ['bhs','blo','beq','bne']:
                    a,b=comparison
                    if {'bhs':a>=b,'blo':a<b,'beq':a==b,'bne':a!=b}[m]:nxt=op[0].imm
                elif m=='b':nxt=op[0].imm
                elif m=='bx':break
                else:raise AssertionError((hex(pc),m,ins.op_str))
                pc=nxt
            else:raise AssertionError('Caret instruction budget')
            assert regs['r0']==min(count,limit-1),(game,index,count,regs['r0'])
            checks.append({'template':index,'filledCharacters':count,'maxCharacters':limit,'caret':regs['r0'],'passed':True})
    roms.append({'gameCode':game,'sha256':digest(rom),'templateOffset':base,'pointerTableOffset':tables[0],'pointerTableReferenceOffsets':refs,
      'templates':[{'kind':kind,'maxCharacters':limit,'titleQid':'rs.common.strings2.'+title,'titleOffset':struct.unpack_from('<I',rom,base+12*i+8)[0]-0x08000000} for i,(kind,limit,title) in enumerate(zip(['player','box','pokemon'],[5,8,5],titles,strict=True))],
      'initializerSha256':digest(rom[0xb13b0:0xb13ca]),'caretReaderOffset':0xb253c,'caretCodeSha256':digest(rom[0xb253c:0xb257a]),
      'keyboardTableOffset':tables[0]+16,'keyboardTableSha256':digest(rom[tables[0]+16:tables[0]+256]),'checks':checks})
assert {r['gameCode'] for r in roms}==set(SHA)
out={'schemaVersion':1,'implementationSha256':digest(Path(__file__).read_bytes()),'method':'Japanese title/template identity, native template initializer reads and restricted caret execution in both fixed ROMs','sourceInputs':inputs,'roms':roms,
     'limits':{'localJapanesePlayer':5,'localJapanesePokemonNamingUI':5,'pcBoxNamingUI':8},
     'characterPolicy':'Observed names must be representable by pinned native font glyphs. This is a conservative display alphabet, not a claim every glyph can be typed on the naming keyboard; modifier/voicing input is not fully emulated.',
     'boundary':'No live naming UI or full script execution. Foreign/scripted displayed nicknames retain the separate conservative ten-character retrieval budget; names never imply actual species or identity.'}
dest=ROOT/'reports/s6-corpus/japanese-name-evidence.json';dest.parent.mkdir(parents=True,exist_ok=True);dest.write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n',encoding='utf-8',newline='\n')
print('Japanese naming templates/caret verified in both ROMs: local player 5, Pokemon UI 5, box 8')
