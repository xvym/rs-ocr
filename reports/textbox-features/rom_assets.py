"""ROM-only graphics and window primitives used by the feature audit."""
from pathlib import Path
import sys
import struct
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'reports/rom-geometry-audit'))
from inspect_rom import load_roms, CACHE, SOURCE, encode_tiles, matching_tiles

_reference_cache=None
_offset_cache={}


def reference_rom():
    global _reference_cache
    if _reference_cache is None:
        _reference_cache=load_roms()['AXVJ']
    return _reference_cache


def locate_equivalent(reference,rom,offset,size=None):
    """Locate by complete decoded content, never by an assumed version delta."""
    if reference['sha256']==rom['sha256']:
        return offset
    token=(rom['sha256'],offset,size)
    if token in _offset_cache:
        return _offset_cache[token]
    if offset in reference['streams']:
        raw=reference['streams'][offset][0]
        hits=[p for p,(b,_) in rom['streams'].items() if b==raw]
    else:
        assert size is not None
        raw=reference['data'][offset:offset+size]
        hits=[]
        pos=0
        while (pos:=rom['data'].find(raw,pos))>=0:
            hits.append(pos)
            pos+=1
    assert len(hits)==1,(hex(offset),size,'not uniquely relocatable',list(map(hex,hits)))
    _offset_cache[token]=hits[0]
    return hits[0]


def palette555(raw):
    values = np.frombuffer(raw, dtype='<u2')
    rgb5 = np.stack([(values >> shift) & 31 for shift in (0, 5, 10)], axis=1)
    return values, np.rint(rgb5 * (255 / 31)).astype(np.uint8)


def decode_tiles(raw):
    values = np.frombuffer(raw, dtype=np.uint8).reshape(-1, 8, 4)
    out = np.empty((len(values), 8, 8), dtype=np.uint8)
    out[:, :, 0::2] = values & 15
    out[:, :, 1::2] = values >> 4
    return out


def tilemap_indices(tiles, tilemap, width=256, height=256, tile_offset=0):
    cells = np.frombuffer(tilemap, dtype='<u2').reshape(-1, 32)
    result = np.zeros((height, width), dtype=np.uint16)
    for cy in range(min(len(cells), height // 8)):
        for cx in range(min(32, width // 8)):
            value = int(cells[cy, cx])
            index = (value & 1023) - tile_offset
            if not 0 <= index < len(tiles):
                continue
            tile = tiles[index]
            if value & 1024:
                tile = tile[:, ::-1]
            if value & 2048:
                tile = tile[::-1, :]
            result[cy*8:cy*8+8, cx*8:cx*8+8] = tile + (value >> 12) * 16
    return result


def bbox(mask):
    ys, xs = np.nonzero(mask)
    return [int(xs.min()), int(ys.min()), int(xs.max()-xs.min()+1), int(ys.max()-ys.min()+1)] if len(xs) else None


def standard_style(rom, index=0):
    table=0x34FEA8
    if rom['data'][0xAC:0xB0]!=b'AXVJ':
        ref=reference_rom()
        g=locate_equivalent(ref,rom,0x34E3E8,288)+0x08000000
        p=locate_equivalent(ref,rom,0x34FA68,32)+0x08000000
        pointer_pair=struct.pack('<II',g,p)
        table=rom['data'].find(pointer_pair)
        assert table>=0 and rom['data'].find(pointer_pair,table+1)<0
    gfx, pal = struct.unpack_from('<II', rom['data'], table + index * 8)
    gfx -= 0x08000000
    pal -= 0x08000000
    return dict(tiles=decode_tiles(rom['data'][gfx:gfx+288]),
                palette=rom['data'][pal:pal+32], gfx_offset=gfx, palette_offset=pal,table_offset=table)


def standard_frame(style, rect):
    left, top, right, bottom = rect
    result = np.zeros((160, 240), dtype=np.uint16)
    coverage = np.zeros((160, 240), dtype=bool)
    for y in range(top, bottom+1):
        for x in range(left, right+1):
            index = (0 if y == top else 6 if y == bottom else 3) + (0 if x == left else 2 if x == right else 1)
            if 0 <= x < 30 and 0 <= y < 20:
                result[y*8:y*8+8, x*8:x*8+8] = style['tiles'][index]
                coverage[y*8:y*8+8, x*8:x*8+8] = style['tiles'][index] != 0
    return result, coverage


def dialogue_frame(rom):
    """Japanese DrawDialogueFrame: left=1, top=14, width=22, height=4."""
    ref=reference_rom() if rom['data'][0xAC:0xB0]!=b'AXVJ' else rom
    gfx=locate_equivalent(ref,rom,0x34FCE8,448)
    pal=locate_equivalent(ref,rom,0x1B3A8C,32)
    tiles = decode_tiles(rom['data'][gfx:gfx+448])
    width, height = 22, 4
    entries = []
    for y in range(height+2):
        for x in range(width+6):
            flip = 0
            if y in (0, height+1):
                index = {0:1, 1:2, 2:3, width+3:5, width+4:2, width+5:6}.get(x, 4)
                flip = 2048 if y == height+1 else 0
            elif y in (1, height):
                index = {0:7, 1:13, 2:11, width+3:11, width+4:13, width+5:10}.get(x, 9)
                flip = (1024 if x in (width+3, width+4) else 0) | (2048 if y == height and index != 9 else 0)
            else:
                index = {0:7, 1:8, 2:12, width+3:12, width+4:8, width+5:10}.get(x, 9)
                flip = 1024 if x in (width+3, width+4) else 0
            entries.append(index | flip)
    tilemap = np.zeros((32, 32), dtype='<u2')
    tilemap[14:20, 1:29] = np.array(entries).reshape(6, 28)
    return tilemap_indices(tiles, tilemap.tobytes())[:160, :240], rom['data'][pal:pal+32]


def inspect_standard_frames(rom, image):
    """Find complete style-1 windows at the game's tile grid, using ROM corners."""
    style = standard_style(rom)
    _, palette = palette555(style['palette'])
    a = np.asarray(image).astype(np.int16)
    # Return candidates only; no layout label is consulted. This approximate
    # capture transform is for discovery, not a validated runtime threshold.
    expected = np.rint(palette.astype(float) * 0.984).astype(np.int16)
    cells = a.reshape(20, 8, 30, 8, 3).transpose(0, 2, 1, 3, 4)
    corners = []
    for index in (0, 2, 6, 8):
        tile = style['tiles'][index]
        mask = tile != 0
        diff = np.max(np.abs(cells - expected[tile][None, None]), axis=-1)
        score = (diff[:, :, mask] <= 4).mean(axis=-1)
        corners.append([(int(x), int(y), float(score[y, x])) for y, x in zip(*np.where(score >= .95))])
    tl, tr, bl, br = corners
    brset = {(x,y) for x,y,_ in br}
    result = []
    for x,y,_ in tl:
        for rx,ry,_ in tr:
            if ry != y or rx <= x:
                continue
            for bx,by,_ in bl:
                if bx == x and by > y and (rx,by) in brset:
                    rect = [x,y,rx,by]
                    frame, coverage = standard_frame(style, rect)
                    band = np.zeros((160,240), dtype=bool)
                    band[y*8:(y+1)*8, x*8:(rx+1)*8] = True
                    band[by*8:(by+1)*8, x*8:(rx+1)*8] = True
                    band[y*8:(by+1)*8, x*8:(x+1)*8] = True
                    band[y*8:(by+1)*8, rx*8:(rx+1)*8] = True
                    mask = band & coverage
                    score = (np.max(np.abs(a[mask]-expected[frame[mask]]),axis=1)<=4).mean()
                    if score >= .95:
                        result.append(rect)
    return result


def static_families(rom):
    definitions = {
        'bag_female': (0x7F2134,0x7F27E0,0x7F27A8,0),
        'bag_male': (0x7F2134,0x7F27E0,0x7F2770,0),
        'shop': (0x7F2934,0x7F2A58,0x7F2A30,0),
        'summary_info': (0x7EF81C,0x7F0288,0x7F01E8,0),
        'summary_skills': (0x7EF81C,0x7F0444,0x7F01E8,0),
        'summary_battle': (0x7EF81C,0x7F05A8,0x7F01E8,0),
        'summary_contest': (0x7EF81C,0x7F071C,0x7F01E8,0),
        'battle_message': (0x67D000,0x67D530,0x67D4EC,0),
        'pokeblock': (0x7F2C18,0x7F3178,0x7F2E20,0),
        'condition': (0x3B5908,0x3B608C,-0x3B58A8,640),
        'berry': (0x7F34F4,0x7F39B8,0x7F3910,0),
    }
    result = {}
    for name,(gfx,map_,pal,offset) in definitions.items():
        tiles = rom['streams'][gfx][0]
        tilemap = rom['streams'][map_][0]
        palette = rom['streams'][pal][0] if pal>0 else rom['data'][-pal:-pal+32]
        if name=='condition':
            palette = bytes(64)+palette
        indices=tilemap_indices(decode_tiles(tiles),tilemap[:2048],tile_offset=offset)
        if name=='condition':
            # Feeding/condition viewer scrolls both BG2 and BG3 upwards by 6px.
            indices=np.roll(indices,-6,axis=0)
        indices=indices[:160,:240]
        result[name]=dict(indices=indices,palette=palette,
                          offsets=dict(gfx=gfx,tilemap=map_,palette=abs(pal)))
    base=np.zeros((32,32),dtype='<u2')
    raw=rom['streams'][0x3B608C][0]
    base[:20]=np.frombuffer(raw,dtype='<u2').reshape(20,32)
    base[13:17,:11]=np.frombuffer(rom['data'][0x3B626C:0x3B626C+88],dtype='<u2').reshape(4,11)
    a=tilemap_indices(decode_tiles(rom['streams'][0x3B5908][0]),base.tobytes(),tile_offset=640)
    result['condition_hint']=dict(indices=np.roll(a,-6,axis=0)[:160,:240],
        palette=result['condition']['palette'], offsets=dict(gfx=0x3B5908,tilemap=0x3B608C,palette=0x3B58A8,patch=0x3B626C))
    header=decode_tiles(rom['streams'][0x3BA2DC][0])
    a=np.zeros((160,240),dtype=np.uint16)
    a[1:33,:64]=header[:32].reshape(4,8,8,8).transpose(0,2,1,3).reshape(32,64)
    a[1:33,64:96]=header[32:48].reshape(4,4,8,8).transpose(0,2,1,3).reshape(32,32)
    result['condition_title']=dict(indices=a,palette=rom['data'][0x3BA168:0x3BA188],
        offsets=dict(gfx=0x3BA2DC,palette=0x3BA168))
    for name,bank in [('party_cancel',1),('party_cancel_selected',2)]:
        m=np.zeros((20,32),dtype='<u2')
        m[18:20,24:30]=np.frombuffer(rom['data'][0x35082C:0x35082C+24],dtype='<u2').reshape(2,6)|(bank<<12)
        a=tilemap_indices(decode_tiles(rom['streams'][0x7EE038][0]),m.tobytes())[:160,:240]
        result[name]=dict(indices=a,palette=rom['streams'][0x7EE3AC][0],
            offsets=dict(gfx=0x7EE038,palette=0x7EE3AC,tilemap=0x35082C))
    return result
