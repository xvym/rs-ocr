"""Build OCR glyphs from the two pinned Japanese ROMs, never from test labels.

The pinned pokeruby PNGs only locate byte-identical assets in each Japanese ROM.
No US address is reused. Font maps must also be found verbatim in both ROMs.
Requires Pillow; development only. The application reads the generated JSON.
"""
from pathlib import Path
import argparse
import hashlib
import json
import re
from collections import defaultdict
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'outputs/pokeruby-text-audit/source/pokeruby-5784633ce4ef7ade1a7f2d2d0c288e3d5e6cdd7f'
EXPECTED = {
    'AXVJ': 'e911caa1ffbf8704cd45bbe064ade40e24efa50dfdce82adf4b2899b5f733852',
    'AXPJ': '6a5ff7656531ab41d1ea9cd8f2d045ab6228405b43f3ee09ea3ff5077c0f60c9',
}


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def encode(image, font):
    w, h = image.size
    p = image.load()
    raw = bytearray()
    # Font 0 stores both 8x8 halves consecutively. Other assets are tiled.
    if font == 0:
        for y in range(0, h, 16):
            for x in range(0, w, 8):
                for dy in range(16):
                    raw.append(sum(p[x+dx, y+dy] << (7-dx) for dx in range(8)))
    else:
        for y in range(0, h, 8):
            for x in range(0, w, 8):
                for dy in range(8):
                    if font == 1:
                        raw.append(sum(p[x+dx, y+dy] << (7-dx) for dx in range(8)))
                    else:
                        for dx in range(0, 8, 2):
                            raw.append((0,15,14)[p[x+dx,y+dy]] | ((0,15,14)[p[x+dx+1,y+dy]] << 4))
    # The build rules omit unused trailing glyphs (fonts.mk).
    return bytes(raw[:{0:3840, 1:2048, 3:16256, 4:7040}[font]])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out', type=Path, default=ROOT/'src/main/resources/ocr/fonts.json')
    args = parser.parse_args()
    roms = {}
    for path in (ROOT/'rom-resource').glob('*.gba'):
        raw = path.read_bytes()
        game = raw[0xAC:0xB0].decode('ascii')
        if game not in EXPECTED or digest(raw) != EXPECTED[game]:
            raise ValueError(f'Unrecognized ROM: {path.name}')
        roms[game] = raw
    if set(roms) != set(EXPECTED):
        raise ValueError('Both pinned Japanese ROMs are required.')
    sources = []

    def locate(name, raw):
        offsets = {}
        for game, rom in roms.items():
            pos = rom.find(raw)
            if pos < 0 or rom.find(raw, pos+1) >= 0:
                raise ValueError(f'{game}: {name} is not uniquely byte-identical')
            offsets[game] = f'0x{pos:06X}'
        sources.append(dict(asset=name, sha256=digest(raw), bytes=len(raw), offsets=offsets))
        pos = int(offsets['AXVJ'], 16)
        return roms['AXVJ'][pos:pos+len(raw)]

    mapping = (SOURCE/'src/data/text/type1_map.h').read_text()
    pairs = bytes(int(x,16) for x in re.findall(r'0x([0-9A-Fa-f]+)', mapping))
    # Japanese code at AXVJ 0x3790 indexes 4-byte entries; US uses u8 pairs.
    padded = b''.join(pairs[i:i+2]+b'\0\0' for i in range(0,len(pairs),2))
    native_map = locate('type1_map_u32_entries', padded)
    tile_map = b''.join(native_map[i:i+2] for i in range(0,len(native_map),4))
    # Duplicate code assignments in the upstream map: Japanese definitions win.
    chars = {}
    charmap = (SOURCE/'charmap.txt').read_text(encoding='utf-8')
    for token, code in re.findall(r"^'([^']+)'\s*=\s*([0-9A-F]{2})\s*(?:@[^\n]*)?$", charmap, re.M):
        if len(token) == 1:
            chars[int(code,16)] = token
    chars[0] = ' '
    chars[0xAF] = '・'
    chars[0xB7] = '円'
    chars.update({0xB1:'『', 0xB2:'』', 0xB3:'「', 0xB4:'」'})
    glyphs = []
    for font in (0,1,3,4):
        image = Image.open(SOURCE/f'graphics/fonts/font{font}_jpn.png')
        raw = locate(f'font{font}_jpn', encode(image,font))
        # Decode the bytes read from the Japanese ROM, not screenshot bitmaps.
        tile_bytes = 8 if font in (0,1) else 32

        def tile(index):
            b = raw[index*tile_bytes:(index+1)*tile_bytes]
            if tile_bytes == 8:
                return [[(row >> (7-x)) & 1 for x in range(8)] for row in b]
            return [[(b[y*4+x//2] >> ((x%2)*4)) & 15 for x in range(8)] for y in range(8)]

        for code, text in sorted(chars.items()):
            if code >= (0xF0 if font == 0 else len(tile_map)//2):
                continue
            if font == 0:
                pixels = tile(code*2) + tile(code*2+1)
            elif font == 3:
                index = (code//16)*32+code%16
                pixels = tile(index)+tile(index+16)
            else:
                pixels = tile(tile_map[code*2])+tile(tile_map[code*2+1])
            if len(pixels) != 16:
                continue
            fg = 1 if font in (0,1) else 15
            rows = [sum((v == fg) << (7-x) for x,v in enumerate(row)) for row in pixels]
            if code and not any(rows):
                continue
            glyphs.append(dict(font=font, code=code, text=text, rows=rows))
    symbols=Image.open(SOURCE/'graphics/summary_screen/text.png')
    raw=bytearray()
    pixels=symbols.load()
    for y in range(symbols.height):
        for x in range(0,8,2):raw.append(pixels[x,y] | pixels[x+1,y]<<4)
    native=locate('summary_text_symbols',bytes(raw))
    for index,text,fg in ((0,'ID',15),(1,'PP',1),(2,'No',15),(3,'Lv',15),(4,'Lv',1)):
        rows=[]
        for y in range(16):
            line=native[(index*16+y)*4:(index*16+y+1)*4]
            values=[(line[x//2] >> ((x%2)*4)) & 15 for x in range(8)]
            rows.append(sum((v==fg) << (7-x) for x,v in enumerate(values)))
        glyphs.append(dict(font=3,code=0x100+index,text=text,rows=rows))
    resource = dict(schema_version=1, glyphs=glyphs)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(resource,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    equivalents={}
    for font in (3,4):
        groups=defaultdict(list)
        for g in glyphs:
            if g['font']==font and g['text'] not in groups[tuple(g['rows'])]:groups[tuple(g['rows'])].append(g['text'])
        equivalents[str(font)]=[tokens for rows,tokens in groups.items() if any(rows) and len(tokens)>1]
    report = dict(rom_sha256=EXPECTED, upstream_commit=SOURCE.name.removeprefix('pokeruby-'),
                  charmap_sha256=digest((SOURCE/'charmap.txt').read_bytes()),
                  assets=sources, glyph_count=len(glyphs), identical_foreground_groups=equivalents,runtime_resource_sha256=digest(args.out.read_bytes()),
                  boundary='ROM-byte identity verifies shared assets and tile map; Unicode assignments are a development proposal pending independent review. No test transcriptions used.')
    out = ROOT/'reports/ocr-development/font-extraction.json'
    out.parent.mkdir(parents=True,exist_ok=True)
    out.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(report,ensure_ascii=True,indent=2))


if __name__ == '__main__':
    main()
