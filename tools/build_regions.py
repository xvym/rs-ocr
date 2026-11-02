"""Compile audited ROM geometry to runtime data, excluding testcase identities."""
from pathlib import Path
import hashlib
import json
import copy

ROOT=Path(__file__).resolve().parents[1]


def main():
    path=ROOT/'reports/textbox-features/features.json'
    data=json.loads(path.read_text(encoding='utf-8'))
    # [x, y, right-exclusive, row count, row spacing, font, advance, color].
    # Positions are development layout measurements, never test text.
    lines={
        'field_dialog': [[32,120,224,2,16,3,8,'dark']],
        'battle_message': [[16,120,224,2,16,3,8,'light']],
        'battle_prompt': [[16,120,128,2,16,3,8,'light']],
        'pc_connect_menu': [[16,8,80,4,16,3,8,'dark']],
        'pc_pokemon_menu': [[16,8,104,4,16,3,8,'dark']],
        'pc_item_menu': [[16,8,80,3,16,3,8,'dark']],
        'shop_menu': [[16,8,80,3,16,3,8,'dark']],
        'pc_store_menu': [[16,8,88,4,16,3,8,'dark']],
        'pc_item_heading': [[8,8,80,1,16,3,8,'dark']],
        'pc_item_list': [[128,16,232,8,16,3,8,'dark']],
        'pc_item_description': [[8,104,104,3,16,3,8,'dark']],
        'bag_list': [[120,16,232,8,16,3,8,'dark']],
        'bag_description': [[8,104,104,3,16,3,8,'dark']],
        'bag_prompt': [[8,104,104,3,16,3,8,'dark']],
        'bag_action': [[16,64,104,2,16,3,8,'dark']],
        'shop_list': [[120,16,232,8,16,3,8,'dark']],
        'shop_description': [[8,104,104,3,16,3,8,'dark']],
        'party_prompt': [[8,136,184,1,16,3,8,'dark']],
        'party_short_prompt': [[8,136,152,1,16,3,8,'dark']],
        'party_field_action': [[176,72,232,5,16,3,8,'dark']],
        'party_battle_action': [[176,104,232,3,16,3,8,'dark']],
        'party_recovery': [[32,120,208,2,16,3,8,'dark']],
        'battle_action': [[152,120,232,2,16,3,8,'dark']],
        'blender_message': [[8,120,232,2,16,3,8,'dark']],
        'condition_message': [[8,136,232,1,16,3,8,'dark']],
        'boot_dialog': [[24,120,216,2,16,3,8,'dark']],
        'save_summary': [[8,8,104,5,16,3,8,'dark']],
        'battle_moves': [[16,120,136,2,16,3,8,'dark']],
        'battle_move_meta': [[152,120,232,2,16,3,8,'dark']],
        'berry_tag_description': [[32,112,208,2,16,3,8,'dark']],
        'block_title': [[24,8,88,1,16,3,8,'dark']],
        'block_list': [[128,8,224,6,16,3,8,'dark']],
        'block_flavors': [[16,104,104,3,16,3,8,'dark']],
        'condition_hint': [[0,106,80,1,16,3,8,'dark']],
        'condition_identity': [[104,2,208,1,16,3,8,'mixed']],
    }
    def grid(x,y,right,color='dark',join=' '):
        return dict(x=x,y=y,right=right,font=3,advance=8,color=color,join=join)

    def label(id_,join=' '):return dict(label=id_,join=join)
    def sprite(group,x,y,join=' '):return dict(sprite=group,x=x,y=y,join=join)

    custom={
        'party_cancel':[[label('cancel')]],
        'bag_category':[[sprite('bag',32,80)]],
        'block_flavors':[[grid(16,104,104)],[grid(16,120,104)],[grid(16,136,48),label('smoothness'),grid(88,136,104,join='')]],
        'condition_identity':[[grid(104,2,144),grid(152,2,160,'gender'),grid(160,2,208,join='')]],
        'condition_graph':[[label('condition_cool')],[label('condition_tough'),label('condition_beauty')],
            [label('condition_smart'),label('condition_cute')],[dict(x=218,y=116,right=234,font=4,advance=4,color='light',join=' ')]],
        'condition_title':[[label('condition_title')]],
        'summary_personal':[[label('personal')],[grid(88,32,112,'light'),grid(112,32,152,'name',join=''),grid(160,32,232,'light')],[grid(88,48,120),sprite('types',120,48,join=''),sprite('types',160,48)]],
        'summary_ability':[[label('ability')],[grid(88,72,232,'light')],[grid(88,88,232)]],
        'summary_memo':[[label('memo')],[grid(88,112,232,'mixed')],[grid(88,128,232,'mixed')]],
        'summary_item':[[label('item')],[grid(88,32,160)]],
        'summary_ribbon':[[label('ribbon')],[grid(168,32,232)]],
        'summary_stats':[[label('stats')]]+[[grid(88,y,120,'light'),grid(120,y,144),grid(144,y,152,join=''),grid(152,y,176,join=''),grid(176,y,208,'light'),grid(208,y,232)] if y==56 else [grid(88,y,120,'light'),grid(120,y,144),grid(176,y,208,'light'),grid(208,y,232)] for y in (56,72,88)],
        'summary_experience':[[label('experience')],[grid(88,112,168,'light'),grid(184,112,232)],[grid(88,128,152,'light'),grid(168,128,184),grid(192,128,232)],[label('exp')]],
        'summary_move_description':[[label('description_battle')],[grid(88,120,232)],[grid(88,136,232)]],
        'summary_contest_description':[[label('description_contest')],[grid(88,120,232)],[grid(88,136,232)]],
        'summary_battle_moves':[[label('moves_battle')]]+[[sprite('types',87,y),grid(120,y,176,'light'),dict(**grid(184,y,232),compact=True)] for y in (32,48,64,80)]+[[grid(120,96,176,'light')]],
        'summary_contest_moves':[[label('moves_contest')]]+[[sprite('types',87,y),grid(120,y,176,'light'),dict(**grid(184,y,232),compact=True)] for y in (32,48,64,80)]+[[grid(120,96,176,'light')]],
        'summary_contest_effect':[[label('effect')],[grid(16,120,48,'light')],[grid(16,136,48,'light')]],
    }
    profiles=[]
    for p in data['profiles']:
        rows=[]
        for x,y,right,count,dy,font,advance,color in lines.get(p['key'],[]):
            rows.extend([dict(x=x,y=y+i*dy,right=right,font=font,advance=advance,color=color,join=' ')] for i in range(count))
        variants=[{k:v[k] for k in ('id','detection_roi','window_allocation_box','palette','fixed_runs')} for v in p['variants']]
        if p['key']=='summary_battle_moves':
            # The move-selection highlight repaints the y=32 top edge.
            # Keep the ROM side/bottom features; do not match that dynamic row.
            variant=copy.deepcopy(variants[1]);variant['id']='summary_battle_expanded_selection'
            variant['fixed_runs']=[run for run in variant['fixed_runs'] if run[0]!=32]
            variants.append(variant)
        profile=dict(key=p['key'],variants=variants,rows=custom.get(p['key'],rows))
        if p['key'].startswith('summary_') and profile['rows'][0][0].get('label'):
            profile['required_label']=profile['rows'][0][0]['label']
        if p['key']=='berry_tag_description':profile['required_context']='berry_header'
        profiles.append(profile)
    resource=dict(schema_version=1, source_sha256=hashlib.sha256(path.read_bytes()).hexdigest(), profiles=profiles)
    out=ROOT/'src/main/resources/ocr/regions.json'
    out.parent.mkdir(parents=True,exist_ok=True)
    out.write_text(json.dumps(resource,ensure_ascii=False,separators=(',',':'))+'\n',encoding='utf-8')
    print(f'{len(profiles)} profiles; {len(set(lines)|set(custom))} text layouts')


if __name__=='__main__':main()
