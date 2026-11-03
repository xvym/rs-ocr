package io.github.rsocr.desktop.capture;

import io.github.rsocr.OcrEngine.*;
import io.github.rsocr.OcrEngine;
import io.github.rsocr.desktop.CursorPixels;
import io.github.rsocr.desktop.BattleCursor;

import com.fasterxml.jackson.databind.*;
import java.awt.image.BufferedImage;
import java.io.IOException;
import java.io.ByteArrayOutputStream;
import java.util.*;

/** Geometry-only companion to the frozen detector; full-set differential checks guard compatibility. */
public final class LiveLayout {
    private record Detected(JsonNode profile,JsonNode variant,double score) {}
    private final JsonNode profiles;
    private final CursorPixels cursors;
    private final BattleCursor cursor;
    private final Map<String,JsonNode> labels=new HashMap<>();
    private final Map<String,JsonNode> sprites=new HashMap<>();
    private final Map<String,JsonNode> contexts=new HashMap<>();

    public LiveLayout(ObjectMapper mapper) throws IOException {
        cursors=new CursorPixels(mapper);
        cursor=new BattleCursor(mapper);
        try(var in=OcrEngine.class.getResourceAsStream("/ocr/regions.json")) {
            profiles=mapper.readTree(in).get("profiles");
        }
        try(var in=OcrEngine.class.getResourceAsStream("/ocr/labels.json")) {
            var resource=mapper.readTree(in);
            for(var label:resource.get("labels")) labels.put(label.get("id").asText(),label);
            for(var context:resource.get("contexts")) contexts.put(context.get("id").asText(),context);
        }
        try(var in=OcrEngine.class.getResourceAsStream("/ocr/sprites.json")) {
            for(var group:mapper.readTree(in).get("groups")) sprites.put(group.get("id").asText(),group);
        }
    }

    public BufferedImage textImage(BufferedImage image,List<Region> regions) {return cursor.textImage(image,regions);}

    private static int[] box(JsonNode n) {
        return new int[]{n.get(0).asInt(),n.get(1).asInt(),n.get(2).asInt(),n.get(3).asInt()};
    }
    private static int channel(int rgb,int shift) { return (rgb>>shift)&255; }

    private double score(BufferedImage image,JsonNode variant,double gain) { return score(image,variant,gain,List.of()); }

    private double score(BufferedImage image,JsonNode variant,double gain,List<int[]> covered) {
        var palette=new HashMap<Integer,int[]>();
        for(var p:variant.get("palette")) palette.put(p.get("index").asInt(),boxRgb(p.get("rgb888")));
        int good=0,total=0;
        int[] cornerGood=new int[4],cornerTotal=new int[4],rect=box(variant.get("detection_roi"));
        for(var run:variant.get("fixed_runs")) {
            int y=run.get(0).asInt();int[] color=palette.get(run.get(3).asInt());
            for(int x=run.get(1).asInt();x<run.get(2).asInt();x++) {
                boolean hidden=false;
                for(var cover:covered) if(x>=cover[0] && x<cover[0]+cover[2] && y>=cover[1] && y<cover[1]+cover[3]) { hidden=true;break; }
                if(hidden)continue;
                int rgb=image.getRGB(x,y);int distance=0;
                for(int c=0;c<3;c++) distance=Math.max(distance,Math.abs(channel(rgb,16-c*8)-(int)Math.round(color[c]*gain)));
                boolean matches=distance<=(gain<.9?48:12);
                if(matches) good++;
                int col=x<rect[0]+8?0:x>=rect[0]+rect[2]-8?1:-1;
                int row=y<rect[1]+8?0:y>=rect[1]+rect[3]-8?1:-1;
                if(col>=0 && row>=0) { int corner=row*2+col;cornerTotal[corner]++;if(matches)cornerGood[corner]++; }
                total++;
            }
        }
        if(variant.get("id").asText().startsWith("standard_"))
            for(int i=0;i<4;i++) if(cornerTotal[i]>0 && (double)cornerGood[i]/cornerTotal[i]<.8)return 0;
        return total<32?0:(double)good/total;
    }
    private static int[] boxRgb(JsonNode n) { return new int[]{n.get(0).asInt(),n.get(1).asInt(),n.get(2).asInt()}; }

    public List<Region> locate(BufferedImage image) { return locate(image,.984); }

    public List<Region> locate(BufferedImage image,double gain) {
        if(image.getWidth()!=240 || image.getHeight()!=160) throw new IllegalArgumentException("识别器输入必须是 240×160。");
        var detected=new ArrayList<Detected>();
        for(var p:profiles) {
            if(p.has("required_label")) {
                String id=p.get("required_label").asText();
                if(!readLabel(image,id,new ArrayList<>(),gain).equals(labels.get(id).get("text").asText()))continue;
            }
            if(p.has("required_context") && score(image,contexts.get(p.get("required_context").asText()),gain)<.92)continue;
            JsonNode best=null;double bestScore=0;
            for(var v:p.get("variants")) {
                double s=score(image,v,gain);
                if(s>bestScore) { best=v;bestScore=s; }
            }
            if(bestScore>=.92) detected.add(new Detected(p,best,bestScore));
        }
        // Upper windows can cover a border without covering the list text.
        // Recheck only audited combinations, excluding those fixed pixels.
        for(var p:profiles) {
            String key=p.get("key").asText();
            if(!Set.of("bag_list","block_list").contains(key) || detected.stream().anyMatch(d->d.profile()==p))continue;
            var covered=new ArrayList<int[]>();
            for(var d:detected) if(Set.of("field_dialog","bag_action").contains(d.profile().get("key").asText()))covered.add(box(d.variant().get("detection_roi")));
            if(covered.isEmpty())continue;
            JsonNode best=null;double bestScore=0;
            for(var v:p.get("variants")) { double s=score(image,v,gain,covered);if(s>bestScore) {best=v;bestScore=s;} }
            if(bestScore>=.92)detected.add(new Detected(p,best,bestScore));
        }
        // Shared physical panels retain all valid purpose candidates.
        var results=new ArrayList<Region>();
        var used=new HashSet<String>();
        for(var d:detected) {
            String key=d.profile().get("key").asText();
            if(used.contains(key)) continue;
            if(key.equals("blender_message") && detected.stream().anyMatch(v->v.profile().get("key").asText().equals("battle_moves")) &&
                    detected.stream().anyMatch(v->v.profile().get("key").asText().equals("battle_move_meta")))continue;
            if(key.equals("block_flavors") && detected.stream().noneMatch(v->v.profile().get("key").asText().equals("block_title")))continue;
            if(Set.of("bag_description","bag_prompt").contains(key) && detected.stream().noneMatch(v->Set.of("bag_category","bag_list").contains(v.profile().get("key").asText())))continue;
            var types=new ArrayList<String>();types.add(key);
            if(key.equals("pc_pokemon_menu")) for(var other:detected)
                if(other.profile().get("key").asText().equals("save_summary") && Arrays.equals(box(d.variant().get("detection_roi")),box(other.variant().get("detection_roi")))) {
                    types.add("save_summary");used.add("save_summary");
                }
            if(key.equals("pc_item_menu") || key.equals("shop_menu")) {
                types.clear();types.add("pc_item_menu");types.add("shop_menu");used.addAll(types);
            }
            if(key.equals("battle_message") && detected.stream().anyMatch(v->v.profile().get("key").asText().equals("battle_prompt"))) used.add("battle_prompt");
            if(key.equals("bag_description") && detected.stream().anyMatch(v->v.profile().get("key").asText().equals("bag_prompt"))) used.add("bag_prompt");
            results.add(new Region(List.copyOf(types),d.variant().get("id").asText(),box(d.variant().get("detection_roi")),d.score(),"","pending",List.of()));
        }
        return List.copyOf(results);
    }

    private static boolean coveredRow(JsonNode segment,JsonNode profile,List<Detected> detected) {
        if(!profile.has("row_occluders") || !segment.has("right"))return false;
        int left=segment.get("x").asInt(),top=segment.get("y").asInt(),right=segment.get("right").asInt();
        for(var other:detected) for(var type:profile.get("row_occluders")) {
            if(!type.asText().equals(other.profile().get("key").asText()))continue;
            int[] cover=box(other.variant().get("detection_roi"));
            if(left>=cover[0] && right<=cover[0]+cover[2] && top>=cover[1] && top+16<=cover[1]+cover[3])return true;
        }
        return false;
    }

    private static boolean foreground(int rgb,String mode) {
        int r=channel(rgb,16),g=channel(rgb,8),b=channel(rgb,0);
        return switch(mode) {
            case "light" -> Math.min(r,Math.min(g,b))>180;
            case "cyan" -> g>200 && b>200 && r<130;
            case "name" -> g>200 && b>200 && r<130 || r>190 && g>110 && g<190 && b<195;
            case "gender" -> r<100 && g>130 && b>150;
            case "gender_gba" -> r<140 && g>150 && b>180;
            case "orange" -> r>140 && g>100 && b<100;
            case "mixed" -> Math.max(r,Math.max(g,b))<130 || r>g+30 && r>b+30 && g<140 && b<140 || b>r+60 && b>g+60;
            default -> Math.max(r,Math.max(g,b))<130;
        };
    }

    public byte[] fingerprint(Region region,List<Region> visible,BufferedImage image,double gain) {
        JsonNode profile=null;String key=region.typeCandidates().getFirst();
        for(var p:profiles)if(p.get("key").asText().equals(key))profile=p;
        var bytes=new ByteArrayOutputStream();
        bytes.writeBytes((region.variant()+":"+region.typeCandidates()).getBytes(java.nio.charset.StandardCharsets.UTF_8));
        for(var segment:profile.get("rows"))for(var block:segment) {
            int left,top,width,height;String mode;String labelId=null,spriteId=null;
            if(block.has("font")) {
                left=block.get("x").asInt();top=block.get("y").asInt();width=block.get("right").asInt()-left;height=16;
                boolean covered=false;
                if(profile.has("row_occluders"))for(var other:visible)for(var type:profile.get("row_occluders"))if(other.typeCandidates().contains(type.asText())) {
                    int[] b=other.logicalBox();if(left>=b[0] && left+width<=b[0]+b[2] && top>=b[1] && top+height<=b[1]+b[3])covered=true;
                }
                if(covered)continue;
                mode=block.get("color").asText();if(mode.equals("gender") && gain>=.9)mode="gender_gba";
            } else if(block.has("label")) {
                labelId=block.get("label").asText();var label=labels.get(labelId);int[] b=box(label.get("box"));
                left=b[0];top=b[1];width=b[2];height=b[3];mode=label.get("color").asText();
            } else {
                spriteId=block.get("sprite").asText();var group=sprites.get(spriteId);var mask=group.get("templates").get(0).get("mask");
                left=block.get("x").asInt();top=block.get("y").asInt();width=mask.get(0).asText().length();height=mask.size();mode=group.get("color").asText();
            }
            var ignored=new BitSet(width);
            if(block.has("font") && block.get("font").asInt()==3) {
                int advance=block.get("advance").asInt();
                boolean dialogue=key.equals("field_dialog") || key.startsWith("battle_") || key.equals("blender_message");
                for(int x=left;x+advance<=left+width;x+=advance)
                    if(advance==8 && cursors.arrow(image,x,top) || dialogue && cursors.waitArrow(image,x,top,advance))ignored.set(x-left,x-left+advance);
            }
            for(int y=top;y<top+height;y++)for(int x=left;x<left+width;x++) {
                if(ignored.get(x-left)) {bytes.write(0);continue;}
                int rgb=image.getRGB(x,y);boolean on;
                if(gain<.9 && "exp".equals(labelId))on=channel(rgb,16)>110 && channel(rgb,8)>80 && channel(rgb,0)<130;
                else if(gain<.9 && labelId!=null && mode.equals("light"))on=Math.min(channel(rgb,16),Math.min(channel(rgb,8),channel(rgb,0)))>(labelId.equals("experience")?110:135);
                else if("types".equals(spriteId))on=gain<.9?channel(rgb,16)>180 && channel(rgb,8)>180 && channel(rgb,0)>140:Math.min(channel(rgb,16),Math.min(channel(rgb,8),channel(rgb,0)))>230;
                else on=foreground(rgb,mode);
                bytes.write(on?1:0);
            }
        }
        return bytes.toByteArray();
    }

    private String readLabel(BufferedImage image,String id,List<CharacterResult> chars,double gain) {
        var label=labels.get(id);int[] rect=box(label.get("box"));
        int distance=0,on=0;
        for(int y=0;y<rect[3];y++) for(int x=0;x<rect[2];x++) {
            int rgb=image.getRGB(rect[0]+x,rect[1]+y);
            boolean actual;
            if(gain<.9 && id.equals("exp"))actual=channel(rgb,16)>110 && channel(rgb,8)>80 && channel(rgb,0)<130;
            else if(gain<.9 && label.get("color").asText().equals("light"))actual=
                    Math.min(channel(rgb,16),Math.min(channel(rgb,8),channel(rgb,0)))>(id.equals("experience")?110:135);
            else actual=foreground(rgb,label.get("color").asText());
            boolean expected=label.get("mask").get(y).asText().charAt(x)=='1';
            if(actual)on++;
            if(actual!=expected)distance++;
        }
        // A cleared caption is an observable empty field, not historical text.
        if(on==0)return "";
        String raw=distance<=(gain<.9?2:0)?label.get("text").asText():"�";
        chars.add(new CharacterResult(rect[0],rect[1],-1,raw,List.of(label.get("text").asText()),distance,-1));
        return raw;
    }

}
