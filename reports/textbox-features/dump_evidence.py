"""Format selected AXVJ Thumb instructions; no ROM modifications."""
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parent))
from rom_assets import ROOT,load_roms
sys.path.insert(0,str(ROOT/'outputs/pokeruby-text-audit/source/rom-geometry-deps'))
from capstone import Cs,CS_ARCH_ARM,CS_MODE_THUMB

RANGES=[
 ('日版蓝框 left=1 top=14 width=22 height=4',0x6266C,0x62684),
 ('标准窗口包装函数',0x6F224,0x6F256),
 ('PC 列表、说明和标题窗口参数',0x135AC4,0x135AE8),
 ('背包说明清字范围',0xA0CD6,0xA0CE2),
 ('背包说明文字坐标',0xA0D30,0xA0D3E),
 ('背包操作菜单清字及四操作框',0xA0E86,0xA0EA6),
 ('背包六操作框',0xA0F30,0xA0F3C),
 ('背包操作提示文字坐标',0xA0FB6,0xA0FC0),
 ('队伍返回按钮两行六列 tile，目的 BG_VRAM+0x3CB0',0x68E68,0x68EAE),
 ('队伍场景菜单 top=18-2*n，left=20，width=9',0x86B06,0x86B28),
 ('队伍菜单 bottom=top+2*n+1 的通用绘制',0x86ABA,0x86AD6),
 ('保存摘要宽度和图鉴行分支',0x91160,0x911BA),
 ('保存摘要无图鉴行 bottom=top+9',0x911FC,0x91216),
 ('日版保存摘要宽度判断，非恒真',0x912DC,0x91304),
 ('日版保存摘要宽度判断返回 false',0x91308,0x91310),
 ('状态图 BG2VOFS/BG3VOFS=6',0x131118,0x131124),
 ('状态图性格条复制宽11高4到tile(0,13)',0xECBA8,0xECBC4),
 ('状态图混合寄存器 BLDCNT=0x844 BLDALPHA=0x40B',0xECC34,0xECC54),
 ('状态图性格文字tile(0,14)，最终受BG3上滚影响',0xECD10,0xECD20),
 ('状态图身份文字tile(13,1)，最终受BG3上滚影响',0xEB428,0xEB446),
 ('树果说明文字tile(4,14)/(4,16)',0x141232,0x141246),
 ('摘要信息页tilemap加载',0x9A878,0x9A882),
 ('摘要能力页tilemap加载',0x9A8A0,0x9A8AA),
 ('摘要战斗招式页tilemap加载',0x9A8B4,0x9A8BE),
 ('摘要华丽招式页tilemap加载',0x9A8C8,0x9A8D2),
]

def main():
    rom=load_roms()['AXVJ']
    data=rom['data']
    decoder=Cs(CS_ARCH_ARM,CS_MODE_THUMB)
    lines=['AXVJ rev0 重点反汇编证据', 'SHA256 '+rom['sha256'],
        '小标题是核查者对行为的说明，不是原作源码符号。',
        '仅列红宝石地址；蓝宝石资源逐项位置及内容校验见 evidence.json。',
        '同参数调用检索并不自动绑定用途，不将其伪装成游戏 window ID。','']
    for label,start,end in RANGES:
        lines.append(label)
        for instruction in decoder.disasm(data[start:end],0x08000000+start):
            extra=''
            if instruction.mnemonic=='ldr' and '[pc,' in instruction.op_str:
                delta=int(instruction.op_str.split('#')[1].split(']')[0],0)
                pos=((instruction.address+4)&~3)+delta-0x08000000
                value=int.from_bytes(data[pos:pos+4],'little')
                extra=f' ; [0x{pos+0x08000000:08X}]=0x{value:08X}'
            lines.append(f'{instruction.address:08X}: {instruction.bytes.hex():8} {instruction.mnemonic:8} {instruction.op_str}{extra}')
        lines.append('')
    (Path(__file__).resolve().parent/'disassembly.txt').write_text('\n'.join(lines),encoding='utf-8')

if __name__=='__main__':main()
