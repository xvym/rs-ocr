package io.github.rsocr.desktop.translation;

import java.util.*;
import java.util.regex.*;

/** Layout parsing uses only current OCR text and detected layout, never fixture IDs. */
public final class VisibleUnits {
    public record Field(String role,String raw) {}
    public record Unit(String raw,int start,int end,String searchText,String kind,List<Field> fields) {}
    private static final Set<String> ROWS=Set.of("pc_connect_menu","pc_pokemon_menu","pc_item_menu","pc_store_menu","pc_item_list","bag_list","shop_menu","shop_list","party_field_action","party_battle_action","block_list");
    private static final Set<String> GRID=Set.of("battle_action","battle_moves","bag_action");
    private static Matcher match(String regex,String text) {return Pattern.compile(regex).matcher(text);}
    private record Line(String text,int start,int end) {}
    private static void add(List<Unit> out,String raw,int a,int b,String search,String kind,Field... fields) {out.add(new Unit(raw.substring(a,b),a,b,search,kind,List.of(fields)));}
    private static void line(List<Unit> out,String raw,Line l) {add(out,raw,l.start,l.end,l.text,null);}
    public static List<Unit> split(String raw,List<String> types) {
        if(raw.isBlank())return List.of();String type=types.size()==1?types.getFirst():"";
        var out=new ArrayList<Unit>();var lines=new ArrayList<Line>();var lm=match("[^\\n]+",raw);
        while(lm.find())lines.add(new Line(lm.group(),lm.start(),lm.end()));
        boolean composite=true;
        switch(type) {
            case "summary_ability" -> {
                line(out,raw,lines.getFirst());if(lines.size()>1){var l=lines.get(1);add(out,raw,l.start,l.end,l.text,"ability");}
                if(lines.size()>2){var l=lines.get(2);add(out,raw,l.start,raw.length(),raw.substring(l.start),"ability_description");}
            }
            case "summary_stats" -> {
                line(out,raw,lines.getFirst());
                for(var l:lines.subList(1,lines.size())) {
                    String regex="(HP|こうげき|ぼうぎょ|とくこう|とくぼう|すばやさ)[ 　]+([0-9０-９]+(?:[ 　]*/[ 　]*[0-9０-９]+)?)";var m=match(regex,l.text);
                    if(!m.find()||!l.text.replaceAll(regex,"").isBlank()){line(out,raw,l);continue;}m.reset();
                    while(m.find())add(out,raw,l.start+m.start(),l.start+m.end(),m.group(1),null,new Field("current_stat",m.group(2)));
                }
            }
            case "summary_experience" -> {
                for(var l:lines){var m=match("^(げんざいのけいけんち|レベルアップまで)[ 　]+(?:(あと)[ 　]+)?([0-9０-９]+)$",l.text);
                    if(!m.matches()){line(out,raw,l);continue;}
                    if(m.group(2)!=null){add(out,raw,l.start,l.start+m.group(1).length(),m.group(1),null);int at=l.start+m.start(2);add(out,raw,at,l.end,m.group(2),null,new Field("current_experience_remaining",m.group(3)));}
                    else add(out,raw,l.start,l.end,m.group(1),null,new Field("current_experience",m.group(3)));
                }
            }
            case "summary_personal" -> {
                for(var l:lines){var owner=match("^(おや/)(.+?)[ 　]+IDNo([0-9０-９]+)$",l.text);var t=match("^(タイプ/)(.+)$",l.text);
                    if(owner.matches())add(out,raw,l.start,l.end,owner.group(1),null,new Field("visible_original_trainer",owner.group(2)),new Field("visible_trainer_id",owner.group(3)));
                    else if(t.matches()){add(out,raw,l.start,l.start+t.group(1).length(),t.group(1),null);var w=match("[^ 　]+",t.group(2));while(w.find())add(out,raw,l.start+t.start(2)+w.start(),l.start+t.start(2)+w.end(),w.group(),"type");}
                    else line(out,raw,l);
                }
            }
            case "summary_memo" -> {
                for(var l:lines){var m=match("^(.+?)(なせいかく)[ 　]+Lv([0-9０-９]+)(のとき)$",l.text);
                    if(!m.matches()){line(out,raw,l);continue;}
                    add(out,raw,l.start,l.start+m.end(1),m.group(1),"nature");add(out,raw,l.start+m.end(1),l.start+m.end(2),"せいかく",null,new Field("grammatical_connector","な"));
                    add(out,raw,l.start+l.text.indexOf("Lv"),l.end,m.group(4),null,new Field("visible_met_level",m.group(3)));
                }
            }
            case "summary_item","summary_ribbon","summary_contest_effect","berry_tag_description" -> {for(var l:lines)line(out,raw,l);}
            case "save_summary" -> {
                for(var l:lines){var m=match("^(しゅじんこう|もっているバッジ|ポケモンずかん|プレイじかん)[ 　]+(.+)$",l.text);
                    if(m.matches())add(out,raw,l.start,l.end,m.group(1),null,new Field(m.group(1).equals("しゅじんこう")?"visible_player_name":"visible_save_value",m.group(2)));
                    else line(out,raw,l);
                }
            }
            case "battle_move_meta" -> {
                for(var l:lines){var pp=match("^PP[ 　]*([0-9０-９]+)[ 　]*/[ 　]*([0-9０-９]+)$",l.text);var t=match("^(わざタイプ/)(.+)$",l.text);
                    if(pp.matches())add(out,raw,l.start,l.end,"PP",null,new Field("current_pp",l.text.substring(2)));
                    else if(t.matches()){add(out,raw,l.start,l.start+t.end(1),"タイプ/",null,new Field("field_qualifier","わざ"));add(out,raw,l.start+t.start(2),l.end,t.group(2),"type");}
                    else line(out,raw,l);
                }
            }
            default -> composite=false;
        }
        if(!composite) {
            String mode=types.stream().map(t->ROWS.contains(t)?"rows":GRID.contains(t)?"grid":"whole").distinct().count()==1 && !types.isEmpty()?(ROWS.contains(types.getFirst())?"rows":GRID.contains(types.getFirst())?"grid":"whole"):"whole";
            if(mode.equals("whole"))add(out,raw,0,raw.length(),raw,null);
            else for(var l:lines) {
                if(mode.equals("grid")){var m=match("[^ 　]+",l.text);while(m.find())add(out,raw,l.start+m.start(),l.start+m.end(),m.group(),type.equals("battle_moves")?"move":null);continue;}
                String search=l.text,kind=null;var fields=new ArrayList<Field>();
                if(Set.of("pc_item_list","bag_list","shop_list","block_list").contains(type)) {
                    var m=match(type.equals("shop_list")?"\\s+([0-9０-９]+)円$":type.equals("block_list")?"\\s+Lv([0-9０-９]+)$":"\\s+×\\s*([0-9０-９]+)$|\\s+(SEL)$",search);boolean suffix=m.find();
                    if(suffix){fields.add(new Field("suffix",m.group()));search=search.substring(0,m.start());}
                    var prefix=match("^No([0-9０-９]+)(?=[^0-9０-９])",search);boolean numbered=prefix.find();
                    if(numbered){fields.add(new Field("display_number",prefix.group()));search=search.substring(prefix.end());}
                    if(!numbered&&suffix&&!type.equals("block_list"))kind="item";
                }
                out.add(new Unit(l.text,l.start,l.end,search,kind,List.copyOf(fields)));
            }
        }
        // Never silently drop a non-whitespace character.
        var covered=new BitSet(raw.length());for(var u:out)covered.set(u.start,u.end);
        for(int i=0;i<raw.length();i++)if(!" 　\r\n".contains(raw.substring(i,i+1))&&!covered.get(i))throw new IllegalArgumentException("Incomplete layout parsing");
        return List.copyOf(out);
    }
}
