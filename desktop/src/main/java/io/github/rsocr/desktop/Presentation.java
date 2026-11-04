package io.github.rsocr.desktop;

import com.fasterxml.jackson.databind.*;
import io.github.rsocr.OcrEngine;
import java.awt.image.BufferedImage;
import java.io.IOException;
import java.util.*;

/** Presentation metadata is geometry only; recognized characters supply all displayed text. */
public final class Presentation {
    public record Box(double x,double y,double width,double height) {
        public boolean contains(double px,double py) { return px>=x && px<x+width && py>=y && py<y+height; }
    }
    public record Run(double x,double y,double width,double height,String raw,boolean unknown) {}
    public record Pointer(double x,double y) {}
    public record TextBlock(Box box,String text) {}
    public record Panel(String key,String name,Box clip,Box frame,int order,String raw,String status,List<Run> runs,List<Pointer> pointers,List<Box> selections,List<TextBlock> translations) {
        public Panel(String key,String name,Box clip,Box frame,int order,String raw,String status,List<Run> runs,List<Pointer> pointers,List<Box> selections) {
            this(key,name,clip,frame,order,raw,status,runs,pointers,selections,List.of());
        }
        public Panel(String key,String name,Box clip,Box frame,int order,String raw,String status,List<Run> runs,List<Pointer> pointers) {
            this(key,name,clip,frame,order,raw,status,runs,pointers,List.of());
        }
    }
    public record Fit(double scale,double x,double y,double width,double height) {
        public static Fit inside(double width,double height) {
            double scale=Math.max(0,Math.min(width/240,height/160));
            return new Fit(scale,(width-240*scale)/2,(height-160*scale)/2,240*scale,160*scale);
        }
    }
    private final Map<String,JsonNode> profiles=new HashMap<>(),layouts=new HashMap<>(),sprites=new HashMap<>();
    private final List<JsonNode> labels=new ArrayList<>();
    private final CursorPixels cursors;

    public Presentation(ObjectMapper mapper) throws IOException {
        cursors=new CursorPixels(mapper);
        for(var p:resource(mapper,"/presentation.json").get("profiles"))profiles.put(p.get("key").asText(),p);
        for(var p:resource(mapper,"/ocr/regions.json").get("profiles"))layouts.put(p.get("key").asText(),p);
        resource(mapper,"/ocr/labels.json").get("labels").forEach(labels::add);
        for(var s:resource(mapper,"/ocr/sprites.json").get("groups"))sprites.put(s.get("id").asText(),s);
    }
    private static JsonNode resource(ObjectMapper mapper,String path) throws IOException {
        try(var stream=Presentation.class.getResourceAsStream(path)) { if(stream==null)throw new IOException("缺少显示资源："+path);return mapper.readTree(stream); }
    }
    private static Box box(JsonNode node) { return node==null || node.isNull()?null:new Box(node.get(0).asDouble(),node.get(1).asDouble(),node.get(2).asDouble(),node.get(3).asDouble()); }
    public List<Panel> panels(List<OcrEngine.Region> regions,BufferedImage image) {
        var panels=new ArrayList<Panel>();
        for(var region:regions) {
            String key=region.typeCandidates().getFirst();var profile=profiles.get(key);var layout=layouts.get(key);
            if(profile==null)throw new IllegalArgumentException("未知显示区域："+key);
            JsonNode variant=null;for(var v:profile.get("variants"))if(v.get("id").asText().equals(region.variant()))variant=v;
            if(variant==null)throw new IllegalArgumentException("未知框体变体："+region.variant());
            int[] b=region.logicalBox();Box clip=new Box(b[0],b[1],b[2],b[3]);
            // ROI bounds own/clamp text; only audited native allocation/contour bounds draw a frame.
            Box frame=box(variant.get("window_allocation_box"));
            if(frame==null)frame=box(variant.get("panel_body_or_contour_box"));
            var runs=new ArrayList<Run>();
            for(var c:region.characters()) {
                double width=8,height=16;
                if(c.font()==-1)for(var label:labels)if(label.get("box").get(0).asInt()==c.x() && label.get("box").get(1).asInt()==c.y()
                        && (label.get("text").asText().equals(c.raw()) || c.candidates().contains(label.get("text").asText()))) {
                    width=label.get("box").get(2).asInt();height=label.get("box").get(3).asInt();break;
                }
                if(c.font()==-2) {
                    boolean found=false;
                    for(var row:layout.get("rows"))for(var s:row)if(s.has("sprite") && s.get("x").asInt()==c.x() && s.get("y").asInt()==c.y()) {
                        var mask=sprites.get(s.get("sprite").asText()).get("templates").get(0).get("mask");
                        height=mask.size();width=mask.get(0).asText().length();found=true;
                    }
                    if(!found && c.candidates().contains("SEL")) { width=8;height=7; }
                }
                runs.add(new Run(c.x(),c.y(),width,height,c.raw(),c.raw().contains("�")));
            }
            var pointers=new ArrayList<Pointer>();
            if(image!=null) {
                var ys=new TreeSet<Integer>();
                for(var row:layout.get("rows"))for(var s:row)if(s.has("font") && s.get("font").asInt()==3)ys.add(s.get("y").asInt());
                for(int y:ys)for(int x=0;x<=232;x+=8)if(clip.contains(x+4,y+8) && cursors.arrow(image,x,y))pointers.add(new Pointer(x,y));
            }
            var selections=image!=null && key.startsWith("summary_") && key.contains("moves")?selectionOutlines(image,clip):List.<Box>of();
            panels.add(new Panel(key,profile.get("name").asText(),clip,frame,profile.get("order").asInt(),region.rawOcr(),region.status(),List.copyOf(runs),List.copyOf(pointers),selections));
        }
        panels.sort(Comparator.comparingInt(Panel::order));return List.copyOf(panels);
    }
    private static boolean red(int rgb) {
        int r=(rgb>>16)&255,g=(rgb>>8)&255,b=rgb&255;return r>100 && r>g*1.4 && r>b*1.3;
    }
    // Observe the native red outline, never infer a selected move from its text or filename.
    private static List<Box> selectionOutlines(BufferedImage image,Box clip) {
        var lines=new ArrayList<int[]>();
        for(int y=Math.max(0,(int)clip.y()-2);y<Math.min(160,clip.y()+clip.height());y++) {
            int left=-1;
            for(int x=Math.max(0,(int)clip.x()-3);x<Math.min(240,clip.x()+clip.width());x++) {
                if(red(image.getRGB(x,y))) {if(left<0)left=x;}
                else if(left>=0) {if(x-left>clip.width()*.8)lines.add(new int[]{left,y,x-left});left=-1;}
            }
            if(left>=0 && clip.x()+clip.width()-left>clip.width()*.8)lines.add(new int[]{left,y,(int)(clip.x()+clip.width()-left)});
        }
        var boxes=new ArrayList<Box>();
        for(var top:lines)for(var bottom:lines)if(bottom[1]-top[1]>=10 && bottom[1]-top[1]<=18 && Math.abs(top[0]-bottom[0])<=2 && Math.abs(top[2]-bottom[2])<=2) {
            var candidate=new Box(top[0],top[1],top[2],bottom[1]-top[1]+1);
            if(boxes.stream().noneMatch(b->Math.abs(b.y()-candidate.y())<=2))boxes.add(candidate);
        }
        return List.copyOf(boxes);
    }
}
