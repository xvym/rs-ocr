"""Read-only Japanese ROM evidence for bounded battle-template construction.

Executes just the two move-particle/suffix selectors with a restricted Thumb
interpreter. It stops at StringCopy, records the source pointer and checks the
literal against the pinned Japanese corpus. No game execution or ROM mutation.
"""
from pathlib import Path
import hashlib,json,re,struct,sys

ROOT=Path(__file__).resolve().parents[1]
SOURCE=ROOT/'.tools/corpus-source/pokeruby-5784633ce4ef7ade1a7f2d2d0c288e3d5e6cdd7f'
sys.path.insert(0,str(ROOT/'outputs/pokeruby-text-audit/source/rom-geometry-deps'))
from capstone import Cs,CS_ARCH_ARM,CS_MODE_THUMB
from capstone.arm import ARM_OP_IMM,ARM_OP_REG
import capstone

SHA={'AXVJ':'e911caa1ffbf8704cd45bbe064ade40e24efa50dfdce82adf4b2899b5f733852','AXPJ':'6a5ff7656531ab41d1ea9cd8f2d045ab6228405b43f3ee09ea3ff5077c0f60c9'}
digest=lambda b:hashlib.sha256(b).hexdigest()
read=lambda p:p.read_text(encoding='utf-8-sig')

def all_offsets(data,needle):
    result=[];p=0
    while True:
        p=data.find(needle,p)
        if p<0:return result
        result.append(p);p+=1

def main():
    tree=json.loads(read(SOURCE.parent/'tree.json'))
    paths=['src/battle_message.c','src/data/battle_strings_en.h','src/battle_script_commands.c','include/constants/moves.h','include/battle_message.h','charmap.txt']
    inputs=[]
    for local in paths:
        data=(SOURCE/local).read_bytes();expected=next(f['sha256'] for f in tree['files'] if f['path']==local)
        assert digest(data)==expected,local
        inputs.append({'local':str((SOURCE/local).relative_to(ROOT)).replace('\\','/'),'sha256':expected})
    corpus_manifest=json.loads(read(ROOT/'corpus/sources.json'))
    for name in ['qid_msg.txt','ja-Hrkt_msg.txt']:
        item=next(s for s in corpus_manifest['sources'] if Path(s['local']).name==name)
        assert digest((ROOT/item['local']).read_bytes())==item['sha256'],name
        inputs.append({'local':item['local'],'sha256':item['sha256']})
    definitions={name:int(value) for name,value in re.findall(r'^#define\s+(MOVE_\w+)\s+(\d+)',read(SOURCE/'include/constants/moves.h'),re.M)}
    code=read(SOURCE/'src/battle_message.c')
    body=re.search(r'const u16 gUnknown_084016BC\[\]\s*=\s*\{([\s\S]*?)\};',code)[1]
    ids=[definitions[token] if token in definitions else int(token) for token in re.findall(r'\bMOVE_\w+\b|\b0\b',body)]
    table=struct.pack('<'+'H'*len(ids),*ids);groups=[[]]
    for move in ids:
        if move:groups[-1].append(move)
        else:groups.append([])
    assert len(groups)==5 and not groups[-1]
    index={move:i for i,group in enumerate(groups) for move in group}
    assert len(index)==len(ids)-4
    qids=read(ROOT/'outputs/corpus-inputs/qid_msg.txt').splitlines()
    japanese=read(ROOT/'outputs/corpus-inputs/ja-Hrkt_msg.txt').splitlines()
    records=dict(zip(qids,japanese,strict=True));prefix='rs.common.battle_strings.'
    charmap={token:int(value,16) for token,value in re.findall(r"^'([^']+)'\s*=\s*([0-9A-F]{2})\s*(?:@[^\n]*)?$",read(SOURCE/'charmap.txt'),re.M) if len(token)==1}
    charmap['\u3000']=0;charmap[' ']=0
    def encode(text):
        text=re.sub('[０-９]',lambda m:chr(ord(m[0])-0xfee0),text)
        return bytes(charmap[c] for c in text)+b'\xff'
    suffixes=['BattleText_Exclamation2','BattleText_Exclamation3','BattleText_Exclamation4','BattleText_Exclamation5','BattleText_Exclamation']
    expected_suffix=[encode(records[prefix+s]) for s in suffixes]
    expected_particle=[encode(s) for s in ['は','は','は','の','の']]
    md=Cs(CS_ARCH_ARM,CS_MODE_THUMB);md.detail=True
    def selector(rom,start,move):
        regs={f'r{i}':0 for i in range(16)};regs['r0']=0x02020000;pc=start+0x08000000;comparison=(0,0)
        def load(address,size):
            if address==0x02038f68:return 0x02010000
            if address==0x02010000:return move
            if address==0x02020000 and size==1:return 0xff
            assert 0x08000000<=address<0x08800000,(hex(address),size)
            return int.from_bytes(rom[address-0x08000000:address-0x08000000+size],'little')
        def value(ins,op):return op.imm if op.type==ARM_OP_IMM else regs[ins.reg_name(op.reg)]
        for step in range(2048):
            ins=next(md.disasm(rom[pc-0x08000000:pc-0x08000000+4],pc,count=1));op=ins.operands;m=ins.mnemonic;next_pc=pc+ins.size
            if m=='push':pass
            elif m in ('movs','mov'):
                name=ins.reg_name(op[0].reg);v=value(ins,op[1])
                if name=='pc':next_pc=v&~1
                else:regs[name]=v
            elif m=='adds':
                name=ins.reg_name(op[0].reg);regs[name]=(value(ins,op[1])+value(ins,op[2]) if len(op)==3 else regs[name]+value(ins,op[1]))&0xffffffff
            elif m=='lsls':regs[ins.reg_name(op[0].reg)]=(value(ins,op[1])<<value(ins,op[2]))&0xffffffff
            elif m in ('ldr','ldrh','ldrb'):
                mem=op[1].mem;base=ins.reg_name(mem.base);address=((pc+4)&~3) if base=='pc' else regs[base]
                address+=mem.disp
                if mem.index:address+=regs[ins.reg_name(mem.index)]
                regs[ins.reg_name(op[0].reg)]=load(address,{'ldr':4,'ldrh':2,'ldrb':1}[m])
            elif m=='cmp':comparison=(value(ins,op[0]),value(ins,op[1]))
            elif m=='bl':
                assert op[0].imm==0x080042e8,(hex(pc),ins.op_str)
                pointer=regs['r1'];assert 0x08000000<=pointer<0x08800000
                offset=pointer-0x08000000;end=rom.index(b'\xff',offset)
                return rom[offset:end+1],offset,step+1
            elif m=='b':next_pc=op[0].imm
            elif m in ('beq','bne','blt','bgt','bhi','bge','ble','bls'):
                a,b=comparison;signed=lambda n:n if n<0x80000000 else n-0x100000000
                cond={'beq':a==b,'bne':a!=b,'blt':signed(a)<signed(b),'bgt':signed(a)>signed(b),'bhi':a>b,'bge':signed(a)>=signed(b),'ble':signed(a)<=signed(b),'bls':a<=b}[m]
                if cond:next_pc=op[0].imm
            else:raise AssertionError((hex(pc),m,ins.op_str))
            pc=next_pc
        raise AssertionError('Selector instruction budget exceeded')
    rom_results=[]
    for file in sorted((ROOT/'rom-resource').glob('*.gba')):
        rom=file.read_bytes();game=rom[0xac:0xb0].decode('ascii');assert game in SHA and digest(rom)==SHA[game]
        offsets=all_offsets(rom,table);assert len(offsets)==1
        table_offset=offsets[0]
        refs=all_offsets(rom,struct.pack('<I',0x08000000+table_offset));assert refs==[0x11cbb4,0x11cc14]
        suffix_offsets={};particle_offsets={};max_steps=0
        for move in range(1,355):
            group=index.get(move,4)
            particle,p,steps=selector(rom,0x11cb7c,move);max_steps=max(max_steps,steps);assert particle==expected_particle[group],(game,move,particle)
            suffix,s,steps=selector(rom,0x11cbd4,move);max_steps=max(max_steps,steps);assert suffix==expected_suffix[group],(game,move,suffix)
            particle_offsets[str(group)]=p;suffix_offsets[suffixes[group]]=s
        literals={}
        for name in ['BattleStatText_Attack','BattleStatText_Defense','BattleStatText_Speed','BattleStatText_SpAtk','BattleStatText_SpDef','BattleStatText_Accuracy','BattleStatText_Evasion','BattleText_Sharply','BattleText_Rose','BattleText_Harshly','BattleText_Fell','BattleText_Wild','BattleText_Foe']:
            data=encode(records[prefix+name]);found=all_offsets(rom,data);assert found,name
            literals[name]={'offsets':found,'bytesSha256':digest(data)}
        rom_results.append({'gameCode':game,'sha256':digest(rom),'revision':rom[0xbc],'moveTableOffset':table_offset,'moveTablePointerReferences':refs,
          'selectorFunctions':{'particle':0x11cb7c,'suffix':0x11cbd4},'selectorCodeSha256':digest(rom[0x11cb7c:0x11cc70]),
          'movesChecked':354,'maxInterpretedInstructions':max_steps,'particleOffsetsByGroup':particle_offsets,'suffixOffsets':suffix_offsets,'literals':literals})
    assert {r['gameCode'] for r in rom_results}==set(SHA)
    output={'schemaVersion':1,'method':'Pinned source classification table byte equality plus restricted execution of both native Japanese Thumb selectors for all 354 move IDs in both ROMs; literal stat/descriptor/prefix evidence',
      'capstoneVersion':capstone.__version__,'sourceInputs':inputs,'tableSha256':digest(table),'groups':groups,
      'particleTextsByGroup':['は','は','は','の','の'],'suffixSourcesByGroup':suffixes,'roms':rom_results,
      'boundary':'No whole-battle-script or live execution. Stat source semantics also use pinned source call-site review; generated rules do not approve Chinese.'}
    target=ROOT/'reports/battle-source-matching/japanese-evidence.json';target.parent.mkdir(parents=True,exist_ok=True)
    target.write_text(json.dumps(output,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print('Japanese selectors verified: 354 moves x 2 selectors x 2 ROMs; stat/prefix literal evidence retained')

if __name__=='__main__':main()
