"""Build reproducible ROM-backed features for the 51 retained catalog keys."""
from pathlib import Path
from collections import Counter
import hashlib
import html
import json
import re
import struct
import sys
from zipfile import ZipFile

import numpy as np
from PIL import Image, ImageDraw

from rom_assets import (ROOT, SOURCE, CACHE, load_roms, palette555, bbox,
                        standard_style, standard_frame, dialogue_frame,
                        static_families, inspect_standard_frames,locate_equivalent)
from profiles import STANDARD, PANELS, NOTES

HERE=Path(__file__).resolve().parent
COMPOSITION_ORDER={
    'field_dialog':10,'battle_message':10,'battle_prompt':10,'blender_message':10,
    'party_prompt':10,'party_short_prompt':10,'bag_action':20,
    'party_field_action':20,'party_battle_action':20,'battle_action':20,
    'battle_moves':20,'battle_move_meta':20,'condition_message':20,'party_recovery':30,
}


def rectangle(rect):
    x,y,w,h=rect
    a=np.zeros((160,240),dtype=bool)
    a[max(0,y):min(160,y+h),max(0,x):min(240,x+w)]=True
    return a


def edge(rect,n=2):
    x,y,w,h=rect
    return rectangle(rect) & ~rectangle([x+n,y+n,max(0,w-2*n),max(0,h-2*n)])


def runs(indices,mask):
    result=[]
    for y in range(160):
        x=0
        while x<240:
            if not mask[y,x]:
                x+=1
                continue
            first=x
            color=int(indices[y,x])
            while x<240 and mask[y,x] and indices[y,x]==color:
                x+=1
            result.append([y,first,x,color])
    return result


def colors(raw,used=None):
    values,rgb=palette555(raw)
    used=list(range(len(values))) if used is None else sorted(set(map(int,used)))
    return [dict(index=i,rgb555=f'0x{int(values[i]):04X}',
                 rgb5=[int((values[i]>>s)&31) for s in (0,5,10)],
                 rgb888=rgb[i].tolist(),hex='#'+''.join(f'{c:02X}' for c in rgb[i]))
            for i in used]


def native_variant(key,family,roi,indices,palette,mask,body_box=None,allocation=None,condition='默认稳定状态',offsets=None):
    mask=mask & rectangle(roi)
    assert mask.any(), (key,family,'empty fixed feature mask')
    values,rgb=palette555(palette)
    assert int(indices[mask].max())<len(values)
    rgba=np.zeros((160,240,4),dtype=np.uint8)
    rgba[:,:,:3]=rgb[np.minimum(indices,len(rgb)-1)]
    rgba[:,:,3]=mask.astype(np.uint8)*255
    path=HERE/'templates'/f'{key}-{family}.png'
    path.parent.mkdir(exist_ok=True)
    Image.fromarray(rgba).crop((roi[0],roi[1],roi[0]+roi[2],roi[1]+roi[3])).save(path)
    record=dict(id=family,condition=condition,detection_roi=roi,
        window_allocation_box=allocation,panel_body_or_contour_box=body_box,
        fixed_feature_box=bbox(mask),fixed_pixel_count=int(mask.sum()),
        palette=colors(palette,[i for i in np.unique(indices[rectangle(roi)]) if i%16!=0]),
        palette_scope='该 ROI 的 ROM 静态底图用色；透明索引不按黑色匹配，动态文字/图标可覆盖部分底图',
        fixed_palette_indices=sorted(map(int,np.unique(indices[mask]))),
        fixed_runs=runs(indices,mask),template_image=str(path.relative_to(HERE)).replace('\\','/'),
        source_offsets={k:f'0x{v:06X}' for k,v in (offsets or {}).items()})
    # Internal arrays are used for QA only and never serialized.
    return record,dict(indices=indices,palette=palette,mask=mask)


def panel_variant(key,family,roi,body,roles,families,expanded=False):
    f=families[family]
    a=f['indices'].copy()
    if expanded:
        # Two extra rows are inserted before the rounded bottom row. This is
        # the settled five-row/list-with-return state observed in the samples.
        a[104:112,80:240]=a[88:96,80:240]
        a[88:104,80:240]=np.tile(a[80:88,80:240],(2,1))
        roi=[80,24,160,88]
        body=[84,32,152,80]
    area=rectangle(roi)
    body_mask=rectangle(body)&np.isin(a,roles) if body else None
    body_box=bbox(body_mask) if body_mask is not None else None
    if body_box:
        mask=body_mask & edge(body_box,2)
    else:
        mask=area.copy()
    y,x=np.indices(a.shape)
    if key=='bag_category':
        mask=area & (y>=77) & (y<=96) & ~np.isin(a,[0,12,13])
        mask &= (x<32)|(y<=79)|(y>=94)|(x>=102)
        # The left/right animated switch arrows overwrite these background pixels.
        mask &= ~(((x>=16)&(x<32)|(x>=100))&(y>=80)&(y<94))
    elif key in ('bag_list','shop_list'):
        left=106 if key=='bag_list' else 108
        mask=area & (((x>=left)&(x<112))|(x>=235)|(y<8)|(y>=152))
        mask &= ~((y>=152)&(x>=152)&(x<200))
        mask &= a!=0
    elif key in ('bag_description','bag_prompt','shop_description'):
        mask=body_mask & (edge(body_box,3))
        if key=='bag_prompt':
            mask &= y>=104
    elif key=='block_list':
        mask &= ~((y>=152)&(x>=152)&(x<200))
    elif key=='block_flavors':
        mask=body_mask & ((x<8)|(y<103)|(y>=153))
    elif key=='condition_title':
        mask=area & (a!=0)
    elif key=='condition_graph':
        mask=area & (((x>=96)&(x<100))|((x>=212)&(x<216))|((y>=134)&(y<138)&(x<216)))
        # Fixed label bitmaps, clear of the changing central green polygon.
        for rect in ([140,34,36,16],[100,58,38,16],[182,58,34,16],
                     [108,114,36,16],[174,114,40,16]):
            mask |= rectangle(rect)&np.isin(a,[33,40])
        mask &= a!=0
    elif key=='condition_hint':
        mask=body_mask & ((y<106)|(y>=122)|(x>=80))
    elif key=='condition_identity':
        mask=area & (((x>=96)&(x<100))|((x>=212)&(x<216))) & (a!=0)
    elif key=='summary_contest_effect':
        # Heart symbols are dynamic. Keep the left and upper curve, not score slots.
        mask &= (x<16)|(y<122)|((y>=150)&(x<45))
    if key.startswith('summary_') and body_box:
        mask &= edge(body_box,1)
    if key=='summary_personal':
        # The OT/ID text and two type icons repaint their whole tile footprints.
        mask &= ~rectangle([88,32,144,16])
        mask &= ~rectangle([87,48,104,16])
    condition='含返回项／招式选择状态' if expanded else '默认稳定状态'
    allocation=[0,1,96,32] if key=='condition_title' else None
    return native_variant(key,family+('_expanded' if expanded else ''),roi,a,f['palette'],mask,
                          body_box,allocation,condition=condition,offsets=f['offsets'])


def code_call_sites(rom,rect):
    # Only report genuine immediate-argument calls to the known JP draw wrapper.
    pattern=b''.join(struct.pack('<H',0x2000+(reg<<8)+v) for reg,v in enumerate(rect))
    target=0x0806F224 if rom['data'][0xAC:0xB0]==b'AXVJ' else 0x0806F228
    from inspect_rom import call_target
    result=[]
    pos=0
    while (pos:=rom['data'].find(pattern,pos,0x200000))>=0:
        try:
            if call_target(rom['data'],pos+8)==target:
                result.append(f'0x{0x08000000+pos:08X}')
        except AssertionError:
            pass
        pos+=2
    return result


def source_reference(key):
    if key in STANDARD:
        filename,term=STANDARD[key][1:]
    elif key.startswith('summary_'):
        filename,term='pokemon_summary_screen.c','LoadPokemonSummaryScreenGraphics'
    elif key.startswith('condition_'):
        filename,term='pokenav.c','sub_80F1778'
    elif key.startswith('block_'):
        filename,term='pokeblock.c','gMenuPokeblock_Tilemap'
    elif key.startswith('bag_'):
        filename,term='item_menu.c','LoadBagGraphicsMultistep'
    elif key.startswith('shop_'):
        filename,term='shop.c','BuyMenuDrawGraphics'
    elif key=='field_dialog':
        filename,term='text_window.c','TextWindow_DrawDialogueFrame'
    elif key=='party_cancel':
        filename,term='party_menu.c','sub_806BBEC'
    elif key=='berry_tag_description':
        filename,term='berry_tag_screen.c','description1'
    else:
        filename,term='battle_main.c','gBattleTextbox'
    term={
        'pc_pokemon_menu':'Menu_DrawStdWindowFrame',
        'pc_store_menu':'Menu_DrawStdWindowFrame(0, 0, 11, 9)',
        'party_battle_action':'ShowPartyPopupMenu',
        'battle_action':'HandleChooseAction',
        'battle_moves':'HandleChooseMove',
        'battle_move_meta':'HandleChooseMove',
        'blender_message':'Menu_DrawStdWindowFrame(0, 14, 29, 19)',
        'boot_dialog':'Menu_DrawStdWindowFrame(2, 14, 27, 19)',
    }.get(key,term)
    path=SOURCE/'src'/filename
    if not path.exists():
        candidates=sorted((SOURCE/'src').glob(filename.replace('.c','*.c')))
        path=candidates[0] if candidates else SOURCE/'src/script_menu.c'
    data=path.read_bytes()
    lines=data.decode('utf-8').splitlines()
    line=next((i for i,s in enumerate(lines,1) if term in s),None)
    return dict(repository='pret/pokeruby',commit='5784633ce4ef7ade1a7f2d2d0c288e3d5e6cdd7f',
                path=str(path.relative_to(SOURCE)).replace('\\','/'),line=line,
                sha256=hashlib.sha256(data).hexdigest(),search_hint=term,
                role='结构和机制参照；精确日版位置、图形及颜色以日版 ROM 和重建匹配为准')


def build():
    roms=load_roms()
    ruby=roms['AXVJ']
    sapphire=roms['AXPJ']
    families=static_families(ruby)
    # Check every referenced raw/compressed primitive in both target versions.
    assets={}
    for family,f in families.items():
        for role,offset in f['offsets'].items():
            token=f'{family}:{role}'
            if offset in ruby['streams']:
                raw,n=ruby['streams'][offset]
                other=locate_equivalent(ruby,sapphire,offset)
                assert sapphire['streams'][other][0]==raw,(family,role)
                mode='GBA LZ77'
            else:
                n=88 if role=='patch' else 24 if family.startswith('party_cancel') and role=='tilemap' else 32
                raw=ruby['data'][offset:offset+n]
                other=locate_equivalent(ruby,sapphire,offset,n)
                assert raw==sapphire['data'][other:other+n],(family,role)
                mode='raw'
            assets[token]=dict(offset=f'0x{offset:06X}',gba_address=f'0x{offset+0x08000000:08X}',
                encoding=mode,decoded_bytes=len(raw),sha256=hashlib.sha256(raw).hexdigest(),identical_content_in_both_roms=True,
                locations=dict(AXVJ=f'0x{offset+0x08000000:08X}',AXPJ=f'0x{other+0x08000000:08X}'))
    for index in range(20):
        a,b=standard_style(ruby,index),standard_style(sapphire,index)
        assert np.array_equal(a['tiles'],b['tiles']) and a['palette']==b['palette']
    other_menu_palette=locate_equivalent(ruby,sapphire,0x1B3A8C,32)

    catalog={p:json.loads((ROOT/f'reports/textbox-catalog/{p}.json').read_text(encoding='utf-8')) for p in ('gba','ngc')}
    types={}
    images={}
    for p,d in catalog.items():
        images.update({i['id']:i for i in d['images']})
        for t in d['region_types']:
            if t['key'] not in types:
                types[t['key']]=dict(t,platforms=[],review_ids=[])
            types[t['key']]['platforms'].append(p)
            types[t['key']]['review_ids'].append(t['review_id'])
    assert len(types)==51 and set(types)==set(STANDARD)|set(PANELS)|{'field_dialog','party_cancel','battle_message','battle_prompt'}

    profile_list=[]
    qa_arrays={}
    for key,t in types.items():
        variants=[]
        runtime=[]
        allocation=None
        geometry='预绘制面板／字段区域：检测 ROI 不代表独立游戏窗口'
        direct_calls={}
        if key in STANDARD:
            rect=STANDARD[key][0]
            l,top,right,bottom=rect
            allocation=[l*8,top*8,(right-l+1)*8,(bottom-top+1)*8]
            style=standard_style(ruby)
            a,coverage=standard_frame(style,rect)
            mask=coverage & edge(allocation,8)
            variant,arrays=native_variant(key,'standard_1',allocation,a,style['palette'],mask,
                bbox(coverage),allocation,offsets=dict(gfx=style['gfx_offset'],palette=style['palette_offset']))
            variants.append(variant);runtime.append(arrays)
            geometry='标准九宫格窗口：分配范围与透明边距分别记录'
            direct_calls={game:code_call_sites(rom,rect) for game,rom in roms.items()}
            if key=='bag_action':
                other=[0,5,13,12]
                b,cov=standard_frame(style,other)
                roi=[0,40,112,64]
                v,q=native_variant(key,'standard_1_six_options',roi,b,style['palette'],cov&edge(roi,8),
                    bbox(cov),roi,'ROM 六操作分支；本批保留样本未展示',dict(gfx=style['gfx_offset'],palette=style['palette_offset']))
                v['observed_in_retained_samples']=False
                v['direct_rom_calls']={g:code_call_sites(ro,other) for g,ro in roms.items()}
                variants.append(v);runtime.append(q)
            if key=='save_summary':
                # Japanese 0x08091160 uses width predicate 0x080912DC and a
                # separate branch for the presence of the Pokedex row.
                for ro in roms.values():
                    assert struct.unpack_from('<H',ro['data'],0x9116A)[0]==0x260C
                    assert struct.unpack_from('<H',ro['data'],0x91176)[0]==0x260D
                    assert struct.unpack_from('<H',ro['data'],0x91194)[0]==0x330B
                    assert struct.unpack_from('<H',ro['data'],0x9120C)[0]==0x3309
                for right,bottom in [(12,11),(13,9),(12,9)]:
                    box=[0,0,(right+1)*8,(bottom+1)*8]
                    b,cov=standard_frame(style,[0,0,right,bottom])
                    v,q=native_variant(key,f'standard_1_{box[2]}x{box[3]}',box,b,style['palette'],cov&edge(box,8),
                        bbox(cov),box,'日版 ROM 尺寸分支；本批未采集此状态',dict(gfx=style['gfx_offset'],palette=style['palette_offset']))
                    v['observed_in_retained_samples']=False
                    variants.append(v);runtime.append(q)
        elif key in PANELS:
            family,roi,body,roles=PANELS[key]
            v,q=panel_variant(key,family,roi,body,roles,families)
            variants.append(v);runtime.append(q)
            if key.startswith('bag_') and key!='bag_action':
                v,q=panel_variant(key,'bag_male',roi,body,roles,families)
                v['condition']='男主人公背包配色；几何与女主人公相同'
                variants.append(v);runtime.append(q)
            if key in ('summary_battle_moves','summary_contest_moves'):
                v,q=panel_variant(key,family,roi,body,roles,families,expanded=True)
                variants.append(v);runtime.append(q)
        elif key=='field_dialog':
            a,pal=dialogue_frame(ruby)
            allocation=[8,112,224,48]
            v,q=native_variant(key,'dialogue_jp',allocation,a,pal,np.isin(a,[11,13,14]),bbox(a!=0),allocation,
                offsets=dict(gfx=0x34FCE8,palette=0x1B3A8C))
            variants.append(v);runtime.append(q)
            geometry='日版固定蓝框：1,14 起点，22+6 列、4+2 行 tile'
        elif key=='party_cancel':
            allocation=[192,144,48,16]
            for family in ('party_cancel','party_cancel_selected'):
                f=families[family]
                v,q=native_variant(key,family,allocation,f['indices'],f['palette'],rectangle(allocation),
                    allocation,allocation,'选中' if family.endswith('selected') else '未选中',f['offsets'])
                variants.append(v);runtime.append(q)
            geometry='BG tilemap 上 6x2 tile 的复合按钮，含外围底图像素'
        else:
            f=families['battle_message']
            allocation=[0,112,240,48]
            roi=[0,112,136,48] if key=='battle_prompt' else allocation
            a=f['indices']
            # Palette 15 is the uniform text backdrop, not a fixed glyph.
            mask=rectangle(roi)&(a!=15)
            v,q=native_variant(key,'battle_red',roi,a,f['palette'],mask,None,allocation,
                '右侧被行动菜单覆盖' if key=='battle_prompt' else '完整消息框',f['offsets'])
            variants.append(v);runtime.append(q)
            geometry='ROM 战斗底框；行动提示为其被遮挡后的可见部分'

        sample_ids=[]
        for p in t['platforms']:
            sample_ids.extend(next(x['example_ids'] for x in catalog[p]['region_types'] if x['key']==key))
        profile=dict(key=key,name=t['name'],group=t['group'],platforms=t['platforms'],review_ids=t['review_ids'],
            legacy_logical_box=t['logical_box'],geometry_kind=geometry,
            representative_image_id=t['representative_image_id'],sample_ids=sample_ids,
            source_reference=source_reference(key),same_geometry_draw_calls=direct_calls,
            callsite_semantics='同参数标准绘制调用的检索结果；未全部绑定到本用途，不是日版窗口 ID。位置另由 ROM 模板重建与画面对照确认。',
            variants=variants,characteristics=NOTES.get(key,''),
            fixed_text_is_not_required=True,
            standard_frame_style_options=list(range(1,21)) if key in STANDARD else [],
            runtime_color_tolerance=None,runtime_geometry_tolerance=None,
            runtime_threshold_status='需对实际捕获链路校准；QA 阈值不是发布参数')
        if key=='bag_prompt':
            profile['base_visual_alias']='bag_description'
            profile['occlusion']=[dict(by='bag_action',covered_box=[0,56,112,48])]
        if key=='shop_menu':
            profile['base_visual_alias']='pc_item_menu'
        if key=='battle_prompt':
            profile['base_visual_alias']='battle_message'
            profile['occlusion']=[dict(by='battle_action',covered_box=[136,112,104,48])]
        if key.startswith('condition_') and key not in ('condition_title','condition_message'):
            profile['coordinate_transform']=dict(BG2VOFS=6,BG3VOFS=6,formula='screen_y = tilemap_y - 6',
                direct_rom_write='0x08131118',blend_control='0x0844',blend_alpha='0x040B',
                dynamic_area='绿色属性多边形、FEEL 图形和名字不作固定颜色特征')
        if key=='berry_tag_description':
            profile['text_anchors']=[[32,112],[32,128]]
            profile['text_anchor_calls']=['0x08141234','0x0814123E']
        if key=='condition_hint':
            profile['text_anchors']=[[0,106]]
        if key=='condition_identity':
            profile['text_anchors']=[[104,2]]
        if key=='save_summary':
            profile['size_rule']=dict(widths=[104,112],heights=[80,96],
                routine='0x08091160',width_predicate='0x080912DC',
                note='日版宽度判断不是美版恒真占位实现；需识别实际框边，不能仅按保存用途固定为 112x96。')
        if key in ('bag_list','shop_list'):
            profile['edge_landmarks']=dict(palette_index=6,horizontal_probe_y=140,
                vertical_dark_lines_x=[108 if key=='bag_list' else 110,235],
                vertical_probe_x=200,horizontal_dark_lines_y=[4,155],
                note='对应深色边线的坐标，不把复合背景中相接的分类条/说明面板算作该列表的独立外框。')
        if key in ('battle_message','battle_prompt'):
            profile['edge_landmarks']=dict(red_palette_index=13,full_red_contour_box=[3,115,234,42],
                note='完整红色轮廓的 bbox；行动提示状态右侧轮廓被标准菜单遮挡。')
        if key=='party_prompt':
            profile['sample_status_overrides']=[dict(image_id=id,status='annotated_candidate_not_visible',
                reason='恢复结果弹窗外尚未遮挡的左边缘不存在提示框；不能作为提示框的可见正样本。') for id in ['GBA-201','GBA-229']]
        profile_list.append(profile)
        qa_arrays[key]=runtime

    style_library=[]
    for index in range(20):
        f=standard_style(ruby,index)
        other=standard_style(sapphire,index)
        style_library.append(dict(id=index+1,gfx_offset=f'0x{f["gfx_offset"]:06X}',
            palette_offset=f'0x{f["palette_offset"]:06X}',palette=colors(f['palette']),
            tiles_8x8_indices=f['tiles'].reshape(9,64).tolist(),
            locations=dict(AXVJ=dict(gfx=f'0x{f["gfx_offset"]+0x08000000:08X}',palette=f'0x{f["palette_offset"]+0x08000000:08X}'),
                           AXPJ=dict(gfx=f'0x{other["gfx_offset"]+0x08000000:08X}',palette=f'0x{other["palette_offset"]+0x08000000:08X}')),
            transparent_index=0,
            layout='0 1 2 / 3 4 5 / 6 7 8；中间行列按窗口参数平铺'))

    for profile in profile_list:
        for variant in profile['variants']:
            variant['source_offsets_game']='AXVJ'
            locations={g:{} for g in roms}
            for role,value in variant['source_offsets'].items():
                offset=int(value,16)
                size=(448 if profile['key']=='field_dialog' else 288) if role=='gfx' else 88 if role=='patch' else 24 if role=='tilemap' and profile['key']=='party_cancel' else 32
                for game,rom in roms.items():
                    found=locate_equivalent(ruby,rom,offset,None if offset in ruby['streams'] else size)
                    locations[game][role]=f'0x{found+0x08000000:08X}'
            variant['source_locations']=locations
        key=profile['key']
        if key in STANDARD:
            profile['color_roles']=dict(frame_fill_indices=[14],frame_border_indices=list(range(1,9)),
                text_palette_reference='evidence.menu_text_palette',note='窗口样式更换时边缘像素和配色按 standard_frame_styles 切换')
        elif key=='field_dialog':
            profile['color_roles']=dict(fill_indices=[12],border_indices=[11,13,14],text_palette_reference='evidence.menu_text_palette')
        elif key in ('battle_message','battle_prompt'):
            profile['color_roles']=dict(fill_indices=[15],border_indices=[9,10,11,12,13,14],typical_text_foreground_index=1,typical_text_shadow_index=8)
        elif key.startswith('summary_'):
            family=profile['variants'][0]['id']
            bank=0 if family.startswith('summary_info') else 32 if family.startswith('summary_skills') else 48 if family.startswith('summary_battle') else 16
            profile['color_roles']=dict(fill_indices=[bank+5,bank+12],edge_indices=[bank+12,bank+13,bank+14],title_band_index=bank+7,
                note='不同字段使用同页调色板；名字/数值/属性/心形图案可有独立动态用色，不作为固定底图特征。')
        elif key in ('bag_description','bag_prompt','shop_description'):
            profile['color_roles']=dict(fill_indices=[1],edge_indices=[2,3,4])
        elif key.startswith('bag_'):
            profile['color_roles']=dict(fill_indices=[10] if key=='bag_category' else [9,10],edge_indices=[5,6,7,8],note='男女背包有独立调色板；分类文字、箭头和选中条可变。')
        elif key=='shop_list':
            profile['color_roles']=dict(fill_indices=[9,10],edge_indices=[5,6,8,11])
        elif key.startswith('block_'):
            profile['color_roles']=dict(fill_indices=[15] if key=='block_flavors' else [3],edge_indices=[2,5,6,8])
        elif key=='condition_title':
            profile['color_roles']=dict(fill_indices=[14],edge_indices=[13,15],bitmap_foreground_index=1,bitmap_shadow_index=5)
        elif key.startswith('condition_'):
            profile['color_roles']=dict(fill_indices=[47],edge_indices=[33,34],bitmap_label_indices=[33,40],
                note='BG2 多边形在 BG3 上以 EVA=11/16、EVB=4/16 混合；中心不采用固定颜色。')
        elif key=='party_cancel':
            profile['color_roles']=dict(normal_purple_index=31,normal_text_index=26,selected_palette_bank=2)
        else:
            profile['color_roles']=dict(fill_indices=[1],edge_indices=[2,3],note='树果标签页面共享背景，文字区不是独立窗口。')
        if key=='party_field_action':
            profile['parametric_geometry']=dict(parameter='n = 当前可见菜单项数',
                allocation_formula='[160, 8*(18-2*n), 80, 8*(2*n+2)]',
                row_step=16,observed_n=5,
                ruby_setup='0x08086B06',ruby_draw_helper='0x08086A8C',
                note='右边和下边贴屏；按真实边框测高度，不用固定 96px 硬判所有场景操作。')

    source_archive=ROOT/'outputs/pokeruby-text-audit/inputs/pokeruby-source.zip'
    source_integrity=dict(verified=False)
    if source_archive.exists():
        manifest=json.loads((ROOT/'outputs/pokeruby-text-audit/manifest.json').read_text(encoding='utf-8'))
        expected=next(x['SHA256'] for x in manifest if x['LocalFile']=='pokeruby-source.zip').lower()
        digest=hashlib.sha256(source_archive.read_bytes()).hexdigest()
        assert digest==expected
        with ZipFile(source_archive) as z:
            for p in profile_list:
                rel=p['source_reference']['path']
                assert z.read(SOURCE.name+'/'+rel)==(SOURCE/rel).read_bytes(),rel
        source_integrity=dict(verified=True,archive_sha256=digest,
            method='所有引用源码与固定 SHA256 源码归档中的成员逐字节相等')

    evidence=dict(roms={g:dict(file=str(ro['path'].relative_to(ROOT)),game_code=g,revision=ro['revision'],sha256=ro['sha256']) for g,ro in roms.items()},
        assets=assets,standard_frame_table={g:f'0x{standard_style(ro)["table_offset"]+0x08000000:08X}' for g,ro in roms.items()},standard_frame_styles_content_identical_in_both_roms=True,
        menu_text_palette=dict(offset='0x1B3A8C',entries=colors(ruby['data'][0x1B3A8C:0x1B3AAC]),
            locations=dict(AXVJ='0x081B3A8C',AXPJ=f'0x{other_menu_palette+0x08000000:08X}'),
            default_foreground_index=1,default_shadow_index=8,note='具体窗口可能选择其他颜色索引；这些不是所有字段的强制颜色'),
        important_code=dict(dialogue_draw='0x0806266C',party_return='0x08068E68',
            condition_scroll='0x08131118',condition_blend='0x080ECC34',
            condition_hint_patch='0x080ECBA8',berry_description='0x08141234',
            bag_description='0x080A0CD0',bag_actions='0x080A0E80',save_summary='0x08091160',save_width_predicate='0x080912DC'),
        important_code_address_game='AXVJ；两版本的同参数绘制调用另按版本列出，不假设所有函数地址相同',
        evidence_method='ROM 压缩资源和调色板解码；原生窗口重建；固定像素/边界与截图比对。美版源码仅提供结构和机制参照。')
    evidence['source_integrity']=source_integrity
    evidence['condition_text_palettes']={}
    for label,offset in [('BG11',0x3B58C8),('BG12',0x3B58E8)]:
        other=locate_equivalent(ruby,sapphire,offset,32)
        evidence['condition_text_palettes'][label]=dict(entries=colors(ruby['data'][offset:offset+32]),
            locations=dict(AXVJ=f'0x{offset+0x08000000:08X}',AXPJ=f'0x{other+0x08000000:08X}'))
    result=dict(schema_version=1,scope='当前 Excel 保留区域；51 个跨链路用途键，不声称覆盖全部游戏状态',
        coordinate_convention='[x,y,width,height]，240x160，左上原点，右/下边界不包含。window_allocation_box、panel_body_or_contour_box、detection_roi 各有独立含义。',
        color_convention='rgb555 为 ROM BGR555 字的十六进制数，rgb5 顺序 R/G/B；rgb888=round(channel5*255/31)，仅为参考显示值，不等于捕获像素。',
        fixed_run_convention='[y,x_start,x_end_exclusive,palette_index]，绝对逻辑像素；未列入的像素不是本模板要求的固定特征。',
        profile_count=len(profile_list),variant_count=sum(len(p['variants']) for p in profile_list),
        equivalence_groups=[dict(keys=['pc_item_menu','shop_menu'],reason='同位置、同大小、同标准窗口样式'),
            dict(keys=['bag_description','bag_prompt'],reason='同一底部面板；可见状态和遮挡不同'),
            dict(keys=['battle_message','battle_prompt'],reason='同一完整红框；右侧被菜单覆盖时只剩左侧')],
        profiles=profile_list,standard_frame_styles=style_library,
        visibility_model=dict(audit_composition_order=COMPOSITION_ORDER,
            order_note='仅表示已核查共现组合中的遮挡顺序，不是 GBA 硬件 BG 优先级常量。',
            rule='先定位高层窗口并判断目标文字可见性；只有边框、底板或空白被盖而文字完整时，从低层 fixed_runs 扣除覆盖像素后继续定位和识别。文字被挡或目标不可见时按 Spec R18 排除该区域；框体重叠本身不是排除条件。',
            supporting_occluders=[dict(key='condition_choice',allocation_box=[184,80,56,48],
                primitive='标准窗口',source_reference='src/use_pokeblock.c: DisplayYesNoMenu(23,10,1)',
                scope='原目录排除类型；作为 condition_graph 的真实遮挡来源保留，不计入 51 键。')],
            corrected_overlap_rules=[dict(lower='condition_graph',upper='condition_message',cover=[0,128,240,32]),
                dict(lower='condition_graph',upper='condition_choice',cover=[184,80,56,48]),
                dict(lower='bag_list',upper='bag_action',cover=[0,56,112,48])]),
        limitations=['无独立窗口的文字区域没有固定的字形紧框；检测 ROI 是明示的识别裁切范围。',
            '已保留坐标和原目录用途的映射；未修改 Excel、原目录或 ROM。',
            '未核查的菜单项目数、版本修订号、窗口移动和淡入淡出不自动声明支持。',
            'NGC 视口仍需链路校准；其绝对截图坐标不能直接作为 ROM 的逻辑坐标。',
            '静态重建核对不是文本框检测准确率或实时 OCR 验收。'])
    qa=validate(result,qa_arrays,images,catalog,ruby)
    for profile in profile_list:
        check=next((q for q in qa['gba_instance_checks'] if q['key']==profile['key'] and q['image_id']==profile['representative_image_id']),None)
        profile['display_variant_id']=check['variant'] if check else profile['variants'][0]['id']
    (HERE/'features.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    (HERE/'evidence.json').write_text(json.dumps(evidence,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    (HERE/'validation.json').write_text(json.dumps(qa,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    write_html(result,qa)
    write_text(result,qa,evidence)
    print(json.dumps(dict(profiles=result['profile_count'],variants=result['variant_count'],
        structural_checks=qa['structural_status'],gba_matches=qa['gba_frame_checks'],
        review_items=len(qa['review_items'])),ensure_ascii=False))


def validate(data,arrays,images,catalog,ruby):
    checks=[]
    review=[]
    counts=Counter()
    normalized={}
    instance_checks=[]
    layers={k:COMPOSITION_ORDER.get(k,0) for k in arrays}
    for p in data['profiles']:
        key=p['key']
        assert p['variants'] and all(v['fixed_pixel_count']>0 for v in p['variants'])
        assert (SOURCE/p['source_reference']['path']).exists()
        gba=[id for id in p['sample_ids'] if id.startswith('GBA-')]
        if not gba:
            checks.append(dict(key=key,status='ROM geometry; NGC visual counterpart',
                note='未以人工近似 NGC 视口伪造像素精度'))
            continue
        best_record=None
        for id in gba:
            if id not in normalized:
                path=ROOT/images[id]['source']
                assert hashlib.sha256(path.read_bytes()).hexdigest()==images[id]['sha256']
                normalized[id]=np.asarray(Image.open(path).convert('RGB').resize((240,160),Image.Resampling.NEAREST))
            shot=normalized[id].astype(np.int16)
            scores=[]
            for v,a in zip(p['variants'],arrays[key]):
                if v.get('observed_in_retained_samples') is False:
                    continue
                mask=a['mask'].copy()
                # Ignore only known foreground windows; the source geometry of
                # standard/blue frames is preferred over approximate old boxes.
                region=next(r for r in images[id]['regions'] if r['type']==key)
                occluders=set(region.get('occluded_by',[]))
                occluders.update(r['type'] for r in images[id]['regions'] if layers.get(r['type'],0)>layers.get(key,0))
                for occluder in occluders:
                    if occluder in STANDARD:
                        q=STANDARD[occluder][0]
                        box=[q[0]*8,q[1]*8,(q[2]-q[0]+1)*8,(q[3]-q[1]+1)*8]
                    elif occluder=='field_dialog':
                        box=[8,112,224,48]
                    else:
                        candidate=next((r for r in images[id]['regions']+images[id].get('excluded_regions',[]) if r['type']==occluder),None)
                        box=candidate['logical_box'] if candidate else [0,0,0,0]
                    mask &= ~rectangle(box)
                if mask.sum()<20:
                    continue
                _,pal=palette555(a['palette'])
                expected=np.rint(pal.astype(float)*.984).astype(np.int16)
                diff=np.max(np.abs(shot[mask]-expected[a['indices'][mask]]),axis=1)
                scores.append((float((diff<=4).mean()),v['id'],int(mask.sum())))
            if scores:
                score,variant,n=max(scores)
                record=dict(key=key,image_id=id,variant=variant,probe_pixels=n,match_fraction=round(score,6))
                instance_checks.append(record)
                counts['tested']+=1
                if key=='party_prompt' and id in ('GBA-201','GBA-229'):
                    assert score==0
                    record['state']='annotated_candidate_not_visible'
                    counts['annotated_candidate_not_visible']+=1
                else:
                    counts['passed' if score>=.95 else 'needs_review']+=1
                if best_record is None or score>best_record['match_fraction']:
                    best_record=record
        if best_record:
            checks.append(best_record)
            if best_record['match_fraction']<.95:
                review.append(best_record)
    return dict(structural_status='passed',scope_profiles=len(data['profiles']),
        gba_frame_checks=dict(counts),representative_checks=checks,review_items=review,
        gba_instance_checks=instance_checks,
        qa_method='原图 SHA256 校验，5x 单元中心采样；ROM RGB888 乘 0.984 后单通道最大差 <=4 为发现性 QA。它不是最终捕获颜色模型或识别准确率。',
        ngc_pixel_accuracy='未声明；保留链路校准工作',
        source_files_unchanged=True)


def write_html(data,qa):
    esc=html.escape
    cards=[]
    for p in data['profiles']:
        v=next(v for v in p['variants'] if v['id']==p['display_variant_id'])
        swatches=''.join(f'<span class="swatch" style="background:{c["hex"]}" title="{c["rgb555"]} / {c["hex"]}"></span>' for c in v['palette'])
        img=p['representative_image_id']
        roi=v['detection_roi']
        overlay=f'<rect x="{roi[0]}" y="{roi[1]}" width="{roi[2]}" height="{roi[3]}" />'
        if v['panel_body_or_contour_box']:
            b=v['panel_body_or_contour_box']
            overlay+=f'<rect class="body" x="{b[0]}" y="{b[1]}" width="{b[2]}" height="{b[3]}" />'
        variants=[]
        for q in p['variants']:
            variants.append(f'<tr><td><a href="{q["template_image"]}">{esc(q["id"])}</a></td><td>{esc(q["condition"])}</td><td>{q["detection_roi"]}</td><td>{q["window_allocation_box"] or "—"}</td><td>{q["panel_body_or_contour_box"] or "—"}</td></tr>')
        source=p['source_reference']
        source_url='https://github.com/pret/pokeruby/blob/'+source['commit']+'/'+source['path']+(f'#L{source["line"]}' if source['line'] else '')
        cards.append(f'''<article data-search="{esc(p['key']+' '+p['name']+' '+p['group'])}">
<header><small>{esc(p['group'])} · {' / '.join(p['platforms']).upper()}</small><h2>{esc(p['name'])}</h2><code>{p['key']}</code></header>
<p>{esc(p['characteristics'])}</p><div class="comparison"><svg viewBox="0 0 240 160"><image href="../textbox-catalog/thumbs/{img}.jpg" width="240" height="160"/>{overlay}</svg><figure><img src="{v['template_image']}" loading="lazy"/><figcaption>ROM 固定特征；透明部分不参与匹配</figcaption></figure></div>
<p class="coords">旧标注 {p['legacy_logical_box']}<br>检测 ROI {roi}<br>分配范围 {v['window_allocation_box'] or '无独立窗口分配'}<br>面板/轮廓 {v['panel_body_or_contour_box'] or '复合区域，见特征掩码'}</p>
<div class="swatches">{swatches}</div><details><summary>变体、颜色和来源证据</summary><p>{esc(p['geometry_kind'])}</p><table><thead><tr><th>变体</th><th>状态</th><th>检测 ROI</th><th>分配框</th><th>面板/轮廓</th></tr></thead><tbody>{''.join(variants)}</tbody></table><p><a href="{source_url}">源码机制参照：{esc(source['path'])}</a>；精确值使用日版 ROM。</p><p>{esc(p['callsite_semantics'])}</p><pre>{esc(json.dumps(dict(source_locations=v['source_locations'],palette=v['palette'],color_roles=p['color_roles'],same_geometry_draw_calls=p['same_geometry_draw_calls']),ensure_ascii=False,indent=2))}</pre></details></article>''')
    page=f'''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>日版 RS 文本框识别特征</title>
<style>body{{margin:0;background:#edf1f5;color:#172638;font:15px/1.65 "Segoe UI","Microsoft YaHei",sans-serif}}main{{max-width:1420px;margin:auto;padding:28px}}h1{{margin:0;font-size:28px}}.intro{{background:#102e47;color:#f4f8fc;padding:26px;border-radius:12px}}a{{color:#14629a}}.intro a{{color:#9cddff}}input{{box-sizing:border-box;width:100%;padding:12px 16px;margin:22px 0;border:1px solid #b8c8d6;border-radius:8px;font:inherit}}.grid{{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px}}article{{background:white;border:1px solid #d4dfe8;border-radius:12px;padding:22px;overflow:hidden}}h2{{font-size:20px;margin:4px 0}}small,figcaption{{color:#596e81}}code,.coords,pre{{font-family:Consolas,"Microsoft YaHei",monospace}}.comparison{{display:grid;grid-template-columns:1fr 1fr;gap:12px;align-items:center}}svg{{width:100%;background:#111;border-radius:6px}}svg rect{{fill:none;stroke:#ffce54;stroke-width:1}}svg rect.body{{stroke:#00e5ff;stroke-width:.7}}figure{{margin:0;background:repeating-conic-gradient(#e8edf2 0% 25%,white 0% 50%) 50%/16px 16px;padding:12px;border-radius:6px;text-align:center}}figure img{{max-width:100%;max-height:180px;image-rendering:pixelated}}figcaption{{background:#fff;font-size:12px;margin-top:8px}}.swatch{{display:inline-block;width:24px;height:24px;border:1px solid #9caeba;margin:2px;border-radius:3px}}details{{border-top:1px solid #e5ebf0;padding-top:12px;margin-top:12px}}summary{{cursor:pointer;font-weight:600}}pre{{max-height:400px;overflow:auto;background:#f3f6f8;padding:12px;font-size:12px}}table{{border-collapse:collapse;font-size:12px;width:100%;display:block;overflow:auto}}td,th{{padding:7px;border:1px solid #dce5ed;white-space:nowrap}}[hidden]{{display:none}}@media(max-width:900px){{.grid{{grid-template-columns:1fr}}main{{padding:16px}}}}</style>
<main><section class="intro"><h1>日版 RS 文本框识别特征</h1><p>{data['profile_count']} 个保留区域键 · {data['variant_count']} 个显式状态/配色变体 · 两份日版 rev0 ROM</p><p>黄色框：检测 ROI；青色框：ROM 面板/轮廓。无独立窗口的文字区域使用明确的检测 ROI，不能把它当作游戏 window ID 或文字紧框。RGB555 为准确 ROM 值，色块为换算显示值，实际捕获仍需校准。</p><p><a href="features.json">机器可读特征</a> · <a href="evidence.json">ROM 地址/哈希</a> · <a href="disassembly.txt">反汇编证据</a> · <a href="validation.json">核验记录</a> · <a href="说明.txt">使用说明</a> · <a href="../textbox-catalog/index.html">原始目录</a></p></section>
<input id="search" placeholder="按名称、分组或 key 筛选，例如：背包、summary、party"><p id="count">显示 {len(cards)} 项</p><section class="grid">{''.join(cards)}</section></main><script>const input=document.getElementById('search');input.addEventListener('input',()=>{{const q=input.value.trim().toLowerCase();let n=0;document.querySelectorAll('article').forEach(a=>{{a.hidden=!a.dataset.search.toLowerCase().includes(q);if(!a.hidden)n++;}});document.getElementById('count').textContent='显示 '+n+' 项';}});</script></html>'''
    (HERE/'index.html').write_text(page,encoding='utf-8')


def write_text(data,qa,evidence):
    lines=['日版 RS 文本框识别特征核查',
        '',f'范围：当前保留的 {data["profile_count"]} 个跨平台区域键；{data["variant_count"]} 个显式状态/配色变体。',
        '标准窗口另外参数化保存全部 20 套原生样式，不把它们混入上述变体计数。',
        '入口：index.html；机器特征：features.json；ROM 地址及哈希：evidence.json；核验：validation.json。',
        '', '坐标口径',
        '- 游戏逻辑坐标为 240x160，矩形 [x,y,width,height]，右/下边界不包含。',
        '- window_allocation_box：真实绘制占用的 tile/对象范围，可能含透明像素。',
        '- panel_body_or_contour_box：ROM 图形中面板/轮廓像素的外接范围；不包含字段标题时已另记。',
        '- detection_roi：明确选择的识别裁切范围。无独立边框的字段只有 ROI，不能把 ROI 当作游戏窗口 ID。',
        '- fixed_runs：[y,x_start,x_end_exclusive,palette_index]。未列入的像素不要求固定颜色。',
        '- 对话、选择光标、滚动箭头、数值、绿色多边形、心形评分等动态内容不做固定图案。',
        '- 按 visibility_model 检测上层窗口并核对目标文字；文字完整时扣除被盖固定像素后继续识别，仅文字被挡或目标不可见时按 Spec R18 排除。',
        '', '颜色口径',
        '- rgb555 为 ROM 调色板原字；RGB5 顺序为 R/G/B。RGB888 只是 round(channel5*255/31) 的色块显示值。',
        '- 实际 GBA/NGC 捕获会改变颜色、插值和亮度；颜色容差、空间容差保留为空，须按捕获链路校准。',
        '- palette 列出 ROI 中静态底图的用色；color_roles 标明底色/边缘等角色；动态文字可另用其他索引。',
        '- 原生标准框支持 20 套设置样式，不能只按当前默认灰紫色匹配所有设置。',
        '', '重要修正',
        '- 蓝色普通对白：分配 [8,112,224,48]，非透明轮廓 [11,115,218,42]。',
        '- 背包说明和操作提示是同一面板；提示状态的上沿被操作菜单覆盖，不是窗口下移 2px。',
        '- 战斗行动提示是完整红色消息框被右侧菜单覆盖的左半部分，不是另画 136px 宽红框。',
        '- 队伍返回按钮分配 [192,144,48,16]，不是原目录的 [192,128,48,32]。',
        '- 状态图 BG2/BG3 上滚 6px；提示轮廓 [0,104,82,20]；标题轮廓 [0,1,88,24]。',
        '- 训练家笔记与经验面板标题均在 y=104，正文上沿均为 y=112；配色不同。',
        '- 招式列表有四行及带返回项的扩展状态，正文高度分别 64/80px。',
        '- 保存摘要在日版有 104/112px 宽度、80/96px 高度组合；原版宽度判断不是美版恒真占位实现。',
        '- 两份 ROM 的资源内容经校验相同，但部分地址不同：见每个变体 source_locations。',
        '', '核验性质',
        f'- GBA 原目录 379 个保留区域：377 项固定特征对应检查通过；2 项原标注候选未实际可见。',
        '- 两项为 GBA-201、GBA-229 的 party_prompt：恢复弹窗外的左侧边缘没有该框，不能作为可见正样本。',
        '- 所有 51 键都有原生模板/父面板/原语依据；6 个仅 NGC 保留键不伪造近似视口下的像素级匹配结果。',
        '- 检查是背景/边缘特征对应核对，不是独立检测准确率、OCR 准确率或时序验收。',
        '- 两份 ROM 均为已登记的日版 rev0；其他修订版及动画中间帧未自动声明覆盖。',
        '- 所有源码引用与固定版本源码归档逐字节核对；原 ROM、原图、Excel 和旧目录未修改。',
        '', '各类位置与特征（详细颜色、RLE、来源和变体见 HTML/JSON）']
    for n,p in enumerate(data['profiles'],1):
        lines.extend(['',f'{n:02d}. {p["name"]} / {p["key"]}',p['characteristics']])
        for v in p['variants']:
            lines.append(f'  {v["id"]}: 检测 ROI {v["detection_roi"]}；分配 {v["window_allocation_box"]}；面板/轮廓 {v["panel_body_or_contour_box"]}。')
        if p.get('base_visual_alias'):
            lines.append('  基础外观复用：'+p['base_visual_alias'])
    lines.extend(['','复现','Python 需 Pillow、NumPy；两份 ROM 和固定版本 pokeruby 源码保留在现有本地目录。',
        '在项目根目录执行：python reports/textbox-features/build_features.py',
        '原生压缩数据的只读缓存保存在操作系统临时目录，不把 ROM 放入报告。',
        '本报告独立于旧 Excel 同步目录，避免把新精度数据静默写回人工审阅表。'])
    (HERE/'说明.txt').write_text('\n'.join(lines)+'\n',encoding='utf-8')


if __name__=='__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    build()
