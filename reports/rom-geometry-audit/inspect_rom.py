"""Read-only inspection of the user-provided Japanese RS ROMs.

Only hashes, offsets and analysis are written to the report. Decoded ROM data
is cached in the OS temporary directory, never in the repository.
"""
from pathlib import Path
import hashlib
import json
import pickle
import struct
import sys
import tempfile

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / 'outputs/pokeruby-text-audit/source/pokeruby-5784633ce4ef7ade1a7f2d2d0c288e3d5e6cdd7f'
CACHE = Path(tempfile.gettempdir()) / 'rs-ocr-rom-geometry'
HERE = Path(__file__).resolve().parent
EXPECTED_HASHES = {
    'AXVJ': 'e911caa1ffbf8704cd45bbe064ade40e24efa50dfdce82adf4b2899b5f733852',
    'AXPJ': '6a5ff7656531ab41d1ea9cd8f2d045ab6228405b43f3ee09ea3ff5077c0f60c9',
}
ASSETS = {
    'bag_tiles': 0x7F2134,
    'bag_palette_male': 0x7F2770,
    'bag_palette_female': 0x7F27A8,
    'bag_tilemap': 0x7F27E0,
    'shop_tiles': 0x7F2934,
    'shop_palette': 0x7F2A30,
    'shop_tilemap': 0x7F2A58,
    'summary_tiles': 0x7EF81C,
    'summary_palette': 0x7F01E8,
    'summary_info_tilemap': 0x7F0288,
    'summary_skills_tilemap': 0x7F0444,
    'summary_battle_moves_tilemap': 0x7F05A8,
    'summary_contest_moves_tilemap': 0x7F071C,
}


def lz77(data, offset):
    if data[offset] != 0x10:
        raise ValueError('Not a GBA LZ77 stream')
    size = int.from_bytes(data[offset + 1:offset + 4], 'little')
    out = bytearray()
    pos = offset + 4
    while len(out) < size:
        flags = data[pos]
        pos += 1
        for bit in range(7, -1, -1):
            if len(out) >= size:
                break
            if flags & (1 << bit):
                a, b = data[pos:pos + 2]
                pos += 2
                count = (a >> 4) + 3
                back = ((a & 15) << 8 | b) + 1
                if back > len(out):
                    raise ValueError('Invalid back reference')
                for _ in range(min(count, size - len(out))):
                    out.append(out[-back])
            else:
                out.append(data[pos])
                pos += 1
    return bytes(out), pos - offset


def scan_streams(data):
    streams = {}
    pos = 0
    while True:
        pos = data.find(b'\x10', pos)
        if pos < 0 or pos + 4 > len(data):
            break
        offset = pos
        pos += 1
        if offset % 4:
            continue
        size = int.from_bytes(data[offset + 1:offset + 4], 'little')
        if not (32 <= size <= 65536 and size % 32 == 0):
            continue
        try:
            decoded, consumed = lz77(data, offset)
        except (ValueError, IndexError):
            continue
        streams[offset] = (decoded, consumed)
    return streams


def load_roms():
    CACHE.mkdir(exist_ok=True)
    result = {}
    for path in sorted((ROOT / 'rom-resource').glob('*.gba')):
        data = path.read_bytes()
        game = data[0xAC:0xB0].decode('ascii')
        digest = hashlib.sha256(data).hexdigest()
        if EXPECTED_HASHES.get(game) != digest:
            raise ValueError(f'Unexpected ROM identity: {game} {digest}')
        cache = CACHE / (digest + '.pickle')
        if cache.exists():
            streams = pickle.loads(cache.read_bytes())
        else:
            streams = scan_streams(data)
            cache.write_bytes(pickle.dumps(streams))
        result[game] = dict(path=path, data=data, streams=streams,
                            sha256=digest, revision=data[0xBC])
    return result


def encode_tiles(path):
    image = Image.open(path)
    out = bytearray()
    for ty in range(image.height // 8):
        for tx in range(image.width // 8):
            for y in range(8):
                for x in range(0, 8, 2):
                    a = image.getpixel((tx * 8 + x, ty * 8 + y))
                    b = image.getpixel((tx * 8 + x + 1, ty * 8 + y))
                    if image.mode == 'L':
                        a, b = 15 - a // 17, 15 - b // 17
                    out.append(a | b << 4)
    return bytes(out)


def matching_tiles(reference, candidate):
    a = {reference[i:i + 32] for i in range(0, len(reference), 32)}
    b = {candidate[i:i + 32] for i in range(0, len(candidate), 32)}
    # Discard solid fill tiles, which are common to unrelated interfaces.
    a = {tile for tile in a if len(set(tile)) > 2}
    return len(a & b), len(a)


def render_tilemap(tiles, tilemap, palette):
    """Decode GBA 4bpp background tiles with flip and palette-bank bits."""
    colors = []
    for (value,) in struct.iter_unpack('<H', palette):
        colors.append(tuple(round(((value >> shift) & 31) * 255 / 31)
                            for shift in (0, 5, 10)))
    result = Image.new('RGB', (256, 256))
    for index, (entry,) in enumerate(struct.iter_unpack('<H', tilemap)):
        tile = entry & 1023
        bank = entry >> 12
        for y in range(8):
            for x in range(8):
                sx = 7 - x if entry & 1024 else x
                sy = 7 - y if entry & 2048 else y
                offset = tile * 32 + sy * 4 + sx // 2
                if offset >= len(tiles):
                    continue
                value = (tiles[offset] >> ((sx & 1) * 4)) & 15
                color_index = bank * 16 + value
                if color_index < len(colors):
                    result.putpixel((index % 32 * 8 + x,
                                     index // 32 * 8 + y), colors[color_index])
    return result.crop((0, 0, 240, 160))


def call_target(data, offset):
    first, second = struct.unpack_from('<HH', data, offset)
    assert first & 0xF800 == 0xF000 and second & 0xF800 == 0xF800
    relative = ((first & 0x7FF) << 12) | ((second & 0x7FF) << 1)
    if relative & (1 << 22):
        relative -= 1 << 23
    return 0x08000000 + offset + 4 + relative


def asset_record(rom, offset):
    decoded, consumed = rom['streams'][offset]
    pointer = struct.pack('<I', 0x08000000 + offset)
    refs, pos = [], 0
    while (pos := rom['data'].find(pointer, pos)) >= 0:
        refs.append(f'0x{0x08000000 + pos:08X}')
        pos += 1
    return dict(file_offset=f'0x{offset:06X}', gba_address=f'0x{0x08000000 + offset:08X}',
                compressed_bytes=consumed, decoded_bytes=len(decoded),
                decoded_sha256=hashlib.sha256(decoded).hexdigest(), pointer_locations=refs)


def build_report(roms):
    # Capstone is only used to format the evidence; geometry comes from the ROM.
    sys.path.insert(0, str(ROOT / 'outputs/pokeruby-text-audit/source/rom-geometry-deps'))
    from capstone import Cs, CS_ARCH_ARM, CS_MODE_THUMB
    import capstone

    ruby, sapphire = roms['AXVJ'], roms['AXPJ']
    for name, offset in ASSETS.items():
        a, size = ruby['streams'][offset]
        b, other_size = sapphire['streams'][offset]
        assert a == b and size == other_size
        assert ruby['data'][offset:offset + size] == sapphire['data'][offset:offset + size]

    images = {}
    for name, gfx, tilemap, palette in [
        ('bag', 'bag_tiles', 'bag_tilemap', 'bag_palette_female'),
        ('shop', 'shop_tiles', 'shop_tilemap', 'shop_palette'),
        ('info', 'summary_tiles', 'summary_info_tilemap', 'summary_palette'),
        ('skills', 'summary_tiles', 'summary_skills_tilemap', 'summary_palette'),
        ('battle_moves', 'summary_tiles', 'summary_battle_moves_tilemap', 'summary_palette'),
        ('contest_moves', 'summary_tiles', 'summary_contest_moves_tilemap', 'summary_palette'),
    ]:
        images[name] = render_tilemap(*(ruby['streams'][ASSETS[key]][0]
                                       for key in (gfx, tilemap, palette)))
        images[name].resize((720, 480), Image.Resampling.NEAREST).save(CACHE / (name + '-jp.png'))

    # Dark vertical border colour: palette entry 6 in each interface palette.
    def dark_border_x(name):
        palette_key = 'bag_palette_female' if name == 'bag' else 'shop_palette'
        value = struct.unpack_from('<H', ruby['streams'][ASSETS[palette_key]][0], 12)[0]
        color = tuple(round(((value >> shift) & 31) * 255 / 31) for shift in (0, 5, 10))
        found = [x for x in range(100, 116) if images[name].getpixel((x, 140)) == color]
        assert len(found) == 1
        return found[0]
    assert dark_border_x('bag') == 108 and dark_border_x('shop') == 110

    catalog = json.loads((ROOT / 'reports/textbox-catalog/gba.json').read_text(encoding='utf-8'))
    source_images = {im['id']: im for im in catalog['images']}
    normalized = {}
    for id in ['GBA-018', 'GBA-019', 'GBA-035', 'GBA-278', 'GBA-304', 'GBA-305', 'GBA-306', 'GBA-308']:
        path = ROOT / source_images[id]['source']
        assert hashlib.sha256(path.read_bytes()).hexdigest() == source_images[id]['sha256']
        original = Image.open(path).convert('RGB')
        assert original.size == (1200, 800)
        # Sample the centre of each 5x5 screenshot cell; do not filter pixels.
        normalized[id] = original.resize((240, 160), Image.Resampling.NEAREST)
    border_points = ([(x, y) for x in (4, 5, 6, 7, 104, 105) for y in range(105, 150)]
                     + [(x, y) for x in range(4, 106) for y in range(150, 155)])
    mismatch = sum(normalized['GBA-019'].getpixel(p) != normalized['GBA-278'].getpixel(p)
                   for p in border_points)
    assert mismatch == 0

    # Check geometrical locations by matching ROM colour runs to screenshot
    # colour runs. This allows capture colour conversion, never spatial shifts.
    def run_shape(colors):
        start, previous = [], None
        for index, color in enumerate(colors):
            if color != previous:
                start.append(index)
                previous = color
        return start
    for key, id in [('bag', 'GBA-019'), ('shop', 'GBA-035')]:
        assert run_shape([images[key].getpixel((x, 140)) for x in range(100, 116)]) == run_shape(
            [normalized[id].getpixel((x, 140)) for x in range(100, 116)])
    for key, id in [('info', 'GBA-304'), ('skills', 'GBA-305'),
                    ('battle_moves', 'GBA-306'), ('contest_moves', 'GBA-308')]:
        # The vertical contour is clear of text at x=86, below y=112.
        # Above it the runtime move-list panel can expand over the base map.
        assert run_shape([images[key].getpixel((86, y)) for y in range(112, 156)]) == run_shape(
            [normalized[id].getpixel((86, y)) for y in range(112, 156)])

    code_ranges = [
        ('bag graphics load', 0x9FAF0, 0x9FAFA),
        ('bag tilemap load', 0x9FB04, 0x9FB0E),
        ('shop graphics and tilemap load', 0xAEA5A, 0xAEA74),
        ('summary info tilemap load', 0x9A878, 0x9A882),
        ('summary skills tilemap load', 0x9A8A0, 0x9A8AA),
        ('summary battle tilemap load', 0x9A8B4, 0x9A8BE),
        ('summary contest tilemap load', 0x9A8C8, 0x9A8D2),
        ('bag description clear', 0xA0CD6, 0xA0CE2),
        ('bag description print', 0xA0D30, 0xA0D3E),
        ('bag action clear and four-option frame', 0xA0E86, 0xA0EA6),
        ('bag six-option frame', 0xA0F30, 0xA0F3C),
        ('bag prompt print', 0xA0FB6, 0xA0FC0),
        ('PC list and description frame coordinates', 0x135AC4, 0x135AE8),
    ]
    assembly = []
    for game, rom in roms.items():
        data = rom['data']
        adjustment = 0 if game == 'AXVJ' else 4
        assert data[0xA0CD6:0xA0CDE] == bytes.fromhex('00200d210d221423')
        assert data[0xA0E86:0xA0E8E] == bytes.fromhex('00200d210d221423')
        assert data[0xA0D36:0xA0D3A] == bytes.fromhex('01210d22')
        assert data[0xA0FB8:0xA0FBC] == bytes.fromhex('01210d22')
        assert call_target(data, 0xA0CDE) == 0x0806F1A0 + adjustment
        assert call_target(data, 0xA0E8E) == 0x0806F1A0 + adjustment
        assert call_target(data, 0xA0D3A) == 0x0806F16C + adjustment
        assert call_target(data, 0xA0FBC) == 0x0806F16C + adjustment
        assert data[0x135AD0:0x135AD8] == bytes.fromhex('00200c210d221323')
        assert call_target(data, 0x135AD8) == 0x0806F224 + adjustment
        assembly.append(f'{game} SHA256 {rom["sha256"]}')
        decoder = Cs(CS_ARCH_ARM, CS_MODE_THUMB)
        for label, start, end in code_ranges:
            assembly.append('\n' + label)
            for instruction in decoder.disasm(data[start:end], 0x08000000 + start):
                comment = ''
                if instruction.mnemonic == 'ldr' and '[pc,' in instruction.op_str:
                    relative = int(instruction.op_str.split('#')[1].split(']')[0], 0)
                    literal = ((instruction.address + 4) & ~3) + relative - 0x08000000
                    value = int.from_bytes(data[literal:literal + 4], 'little')
                    comment = f' ; [0x{literal + 0x08000000:08X}] = 0x{value:08X}'
                assembly.append(f'{instruction.address:08X}: {instruction.mnemonic:8} {instruction.op_str}{comment}')
        assembly.append('\n')

    findings = [
        dict(pair=['bag_description', 'bag_prompt'], result='同一基础面板，操作菜单遮住上沿；不是窗口向下移动 2 像素',
             clear_tile_rect_both=[0, 13, 13, 20], text_anchor_tiles_both=[1, 13],
             action_frame_inclusive_tiles=[0, 7, 13, 12], action_frame_pixel_cover=[0, 56, 112, 48],
             same_unoccluded_screenshot_border_pixels=len(border_points), differing_border_pixels=mismatch),
        dict(pair=['summary_memo', 'summary_experience'], result='标注的 4 像素高差不是真实布局差；颜色和内部面板样式仍不同',
             title_band_y_both=104, body_top_border_y_both=112, body_bottom_border_y_both=143),
        dict(pair=['summary_experience', 'summary_move_description', 'summary_contest_description'],
             result='真实竖直位移为 8 像素，目录中的 6 像素差来自框选口径',
             title_band_y=[104, 112, 112], body_top_border_y=[112, 120, 120],
             body_bottom_border_y=[143, 151, 151]),
        dict(pair=['bag_list', 'shop_list'], result='真实横向差 2 像素，原标注的 4 像素差不精确',
             sampled_same_dark_border_at_y=140, dark_border_x=[108, 110]),
        dict(pair=['pc_item_description', 'bag_description', 'shop_description'],
             result='PC 为动态标准窗口；背包和商店为预绘制面板，不能因粗略样式描述相同而合并',
             pc_frame_inclusive_tiles=[0, 12, 13, 19], pc_frame_tile_allocation_pixels=[0, 96, 112, 64],
             note='tile 分配框含透明边距，不等于可见轮廓的紧框；背包和商店右侧接缝也有真实差异'),
    ]
    report = dict(
        status='passed', method='直接解析两份日版 rev0 ROM 的压缩资源、tilemap、调色板及 Thumb 指令，再与日版 GBA 原图核验',
        address_convention='GBA 地址 = 文件偏移 + 0x08000000；像素坐标以 240x160 游戏画面为基准；窗口参数采用包含右下边界的 tile 坐标',
        tools=dict(capstone=capstone.__version__),
        roms={game: dict(file=str(rom['path'].relative_to(ROOT)), sha256=rom['sha256'], revision=rom['revision'],
                        assets={name: asset_record(rom, offset) for name, offset in ASSETS.items()})
              for game, rom in roms.items()},
        checked_assets_identical_between_ruby_and_sapphire=True,
        screenshot_checks=dict(samples=list(normalized),
            border_run_checks='列表横向边界、四种摘要面板纵向轮廓的颜色分段位置与 ROM 重建结果一致，未应用空间平移',
            screenshots={id: dict(source=source_images[id]['source'], sha256=source_images[id]['sha256']) for id in normalized}),
        findings=findings,
        limitations=['属于指定 rev0 ROM 的静态资源和指定代码路径核对，并非全部窗口布局审计。',
                     'testcase 与两份 ROM 的实际采集来源没有逐图版本登记；本次证明画面几何相符，不据此认定每张截图的版本。',
                     'NGC 视口仍为人工近似映射，本次精确截图像素核验使用 GBA 原图。',
                     '未修改已有目录、Excel、原图或 ROM；此前 50 种仍不是全量像素校准后的最终框型数。'])
    (HERE / 'findings.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    (HERE / 'disassembly.txt').write_text('\n'.join(assembly), encoding='utf-8')
    print(json.dumps(dict(status='passed', roms=list(roms), checked_assets=len(ASSETS),
                          findings=len(findings), report=str((HERE / 'findings.json').relative_to(ROOT))), ensure_ascii=False))


def main():
    sys.stdout.reconfigure(encoding='utf-8')
    roms = load_roms()
    if '--discover' not in sys.argv:
        build_report(roms)
        return
    for game, rom in roms.items():
        print(game, 'revision', rom['revision'], 'sha256', rom['sha256'],
              'valid aligned candidate streams', len(rom['streams']))
        for name in ('bag_screen', 'mart_frame', 'status_screen'):
            ref = encode_tiles(SOURCE / 'graphics/interface' / (name + '.png'))
            scored = []
            for offset, (decoded, consumed) in rom['streams'].items():
                if 256 <= len(decoded) <= 16384:
                    match, total = matching_tiles(ref, decoded)
                    if match:
                        scored.append((match, offset, len(decoded), total))
            print(name, [(m, hex(o), n, t) for m, o, n, t in sorted(scored, reverse=True)[:5]])


if __name__ == '__main__':
    main()
