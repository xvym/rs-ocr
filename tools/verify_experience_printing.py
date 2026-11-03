"""Read-only evidence for Japanese experience buffer construction.

Executes only the native buffer-write block with declared register/RAM inputs.
It does not execute experience calculation, battle scripts or the whole printer.
"""
from pathlib import Path
from itertools import product
import hashlib,json,re,struct,sys
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'tools'))
from verify_battle_printing import SHA,all_offsets,SOURCE
from capstone import Cs,CS_ARCH_ARM,CS_MODE_THUMB
from capstone.arm import ARM_OP_IMM
digest=lambda b:hashlib.sha256(b).hexdigest()
read=lambda p:p.read_text(encoding='utf-8-sig')

def main():
    tree=json.loads(read(SOURCE.parent/'tree.json'));inputs=[]
    for local in ['charmap.txt','src/battle_script_commands.c','src/battle_message.c','include/battle_message.h','include/battle_string_ids.h',
                  'data/text/barboach.inc','data/maps/BattleTower_Lobby/scripts.inc','src/battle_tower.c',
                  'data/maps/LittlerootTown_ProfessorBirchsLab/scripts.inc','data/maps/LittlerootTown_ProfessorBirchsLab/text.inc']:
        data=(SOURCE/local).read_bytes();expected=next(f['sha256'] for f in tree['files'] if f['path']==local)
        assert digest(data)==expected,local
        inputs.append({'local':str((SOURCE/local).relative_to(ROOT)).replace('\\','/'),'sha256':expected})
    manifest=json.loads(read(ROOT/'corpus/sources.json'));columns=[]
    for name in ['qid_msg.txt','ja-Hrkt_msg.txt']:
        source=next(s for s in manifest['sources'] if Path(s['local']).name==name)
        data=(ROOT/source['local']).read_bytes();assert digest(data)==source['sha256']
        inputs.append({'local':source['local'],'sha256':source['sha256']});columns.append(data.decode('utf-8-sig').splitlines())
    records=dict(zip(*columns,strict=True));prefix='rs.common.battle_strings.'
    names=['BattleText_GainExpPoints','BattleText_Terminator','BattleText_BoostedExp']
    expected_texts=['[B_BUFF1][B_BUFF2]　けいけんちを　もらった！\\c','は\\n','は　おおめに\\n']
    assert [records[prefix+n] for n in names]==expected_texts
    charmap={token:int(value,16) for token,value in re.findall(r"^'([^']+)'\s*=\s*([0-9A-F]{2})\s*(?:@[^\n]*)?$",read(SOURCE/'charmap.txt'),re.M) if len(token)==1}
    charmap['　']=0;charmap[' ']=0
    def encode(text):
        result=b''
        for token in re.findall(r'\[B_BUFF[12]\]|\\[nc]|.',text):
            result+= {'[B_BUFF1]':b'\xfd\x00','[B_BUFF2]':b'\xfd\x01','\\n':b'\xfe','\\c':b'\xfb'}.get(token,bytes([charmap[token]]) if len(token)==1 else b'')
        return result+b'\xff'
    encoded=list(map(encode,expected_texts));md=Cs(CS_ARCH_ARM,CS_MODE_THUMB);md.detail=True
    block_start,block_end=0x1d770,0x1d7dc
    results=[]
    for file in sorted((ROOT/'rom-resource').glob('*.gba')):
        rom=file.read_bytes();game=rom[0xac:0xb0].decode('ascii');assert game in SHA and digest(rom)==SHA[game]
        matches=all_offsets(rom,encoded[0]);assert len(matches)==1
        template_offset=matches[0]
        tables=[]
        for reference in all_offsets(rom,struct.pack('<I',0x08000000+template_offset)):
            base=reference-4 # message 13 is the second entry; table begins at 12
            pointers=[struct.unpack_from('<I',rom,base+4*(i-12))[0]-0x08000000 for i in [13,329,330]]
            if all(0<=p<len(rom) and rom[p:p+len(data)]==data for p,data in zip(pointers,encoded,strict=True)):
                tables.append((base,pointers))
        assert len(tables)==1,(game,tables)
        table,pointers=tables[0]
        instructions=list(md.disasm(rom[block_start:block_end],0x08000000+block_start))
        assert instructions[-1].mnemonic=='bl' and instructions[-1].op_str=='#0x80129c0'
        def pc_word(offset):
            ins=next(i for i in instructions if i.address==0x08000000+offset)
            assert ins.mnemonic=='ldr' and ins.reg_name(ins.operands[1].mem.base)=='pc'
            return struct.unpack_from('<I',rom,((offset+4)&~3)+ins.operands[1].mem.disp)[0]
        actor_address=pc_word(0x1d77c)+pc_word(0x1d77e)
        party_address=pc_word(0x1d77c)+pc_word(0x1d788)
        observations=[]
        for message in [329,330]:
            for amount in [0,15,1956,99999]:
                for party_index,actor_id in product([0,5],[0,2]):
                    regs={f'r{i}':0 for i in range(16)};regs['r7']=message;regs['sb']=0x0203f000
                    ram={actor_address:actor_id,party_address:party_index,**{0x0203f000+i:b for i,b in enumerate(struct.pack('<I',amount))}}
                    writes={}
                    def load(address,size):
                        if 0x08000000<=address<0x08800000:return int.from_bytes(rom[address-0x08000000:address-0x08000000+size],'little')
                        assert all(address+i in ram for i in range(size)),hex(address)
                        return sum(ram[address+i]<<(8*i) for i in range(size))
                    def value(ins,op):return op.imm if op.type==ARM_OP_IMM else regs[ins.reg_name(op.reg)]
                    called=False
                    for ins in instructions:
                        op=ins.operands;m=ins.mnemonic;reg=lambda n:ins.reg_name(op[n].reg)
                        if m in ('mov','movs'):regs[reg(0)]=value(ins,op[1])
                        elif m=='adds':regs[reg(0)]=(value(ins,op[1])+value(ins,op[2]))&0xffffffff
                        elif m in ('lsls','lsrs','asrs'):
                            v,n=value(ins,op[1]),value(ins,op[2])
                            if m=='asrs' and v>=0x80000000:v-=0x100000000
                            regs[reg(0)]=((v<<n) if m=='lsls' else (v>>n))&0xffffffff
                        elif m=='ands':regs[reg(0)]&=value(ins,op[1])
                        elif m=='rsbs':regs[reg(0)]=(-value(ins,op[1]))&0xffffffff
                        elif m in ('ldr','ldrb'):
                            mem=op[1].mem;base=ins.reg_name(mem.base)
                            address=(((ins.address+4)&~3) if base=='pc' else regs[base])+mem.disp
                            regs[reg(0)]=load(address,4 if m=='ldr' else 1)
                        elif m=='strb':
                            mem=op[1].mem;address=regs[ins.reg_name(mem.base)]+mem.disp
                            assert 0x02000000<=address<0x02040000 or 0x03000000<=address<0x03008000,hex(address)
                            writes[address]=value(ins,op[0])&255
                        elif m=='bl':
                            assert regs['r0']==13 and regs['r1']==actor_id
                            called=True
                        else:raise AssertionError((hex(ins.address),m,ins.op_str))
                    assert called
                    buff1=pc_word(0x1d770);buff2=pc_word(0x1d7a2)
                    get=lambda address,count:bytes(writes[address+i] for i in range(count))
                    first=get(buff1,8);second=get(buff2,9)
                    assert first==bytes([0xfd,4,actor_id,party_index,0,message&255,message>>8,0xff])
                    assert second==bytes([0xfd,1,4,5])+struct.pack('<I',amount)+b'\xff'
                    observations.append({'componentStringId':message,'amount':amount,'partyIndex':party_index,'actorId':actor_id,'passed':True})
        results.append({'gameCode':game,'sha256':digest(rom),'tableOffset':table,
          'sources':[{'qid':prefix+n,'stringId':i,'offset':p,'encodedSha256':digest(data)} for n,i,p,data in zip(names,[13,329,330],pointers,encoded,strict=True)],
          'nativeBlock':{'start':block_start,'endExclusive':block_end,'sha256':digest(rom[block_start:block_end]),'prepareStringTarget':0x080129c0},
          'bufferAddresses':{'B_BUFF1':buff1,'B_BUFF2':buff2},'checks':observations})
    assert {r['gameCode'] for r in results}==set(SHA)
    output={'schemaVersion':1,'method':'Japanese template/table identity and restricted execution of the native experience buffer-write block in both fixed ROMs',
      'sourceInputs':inputs,'roms':results,'normalComponent':'BattleText_Terminator','boostedComponent':'BattleText_BoostedExp',
      'bufferSemantics':{'B_BUFF1':'nickname-with-prefix followed by selected component string','B_BUFF2':'unsigned 32-bit number, decimal mode 0, width budget 5'},
      'boundary':'Block inputs supplied explicitly. No calculation/trade-status execution, full printer, identity inference, Chinese publication or live acceptance.'}
    (ROOT/'reports/battle-source-matching/experience-evidence.json').write_text(json.dumps(output,ensure_ascii=False,indent=2)+'\n',encoding='utf-8',newline='\n')
    print('Verified Japanese experience template/table and 32 native buffer cases per ROM')

if __name__=='__main__':main()
