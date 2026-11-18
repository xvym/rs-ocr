package io.github.rsocr.desktop;

import com.fasterxml.jackson.databind.JsonNode;
import io.github.rsocr.desktop.Presentation.Box;
import java.awt.image.BufferedImage;
import java.util.*;

/** Observe the summary's native outline separately from its panel border and text. */
public final class SummaryMoveSelection {
    private SummaryMoveSelection() {}
    private static boolean red(int rgb) {
        int r=(rgb>>16)&255,g=(rgb>>8)&255,b=rgb&255;return r>100 && r>g*1.4 && r>b*1.3;
    }
    public static boolean isMoveList(String key) {return key.equals("summary_battle_moves") || key.equals("summary_contest_moves");}
    public static List<Box> outlines(BufferedImage image,Box clip) {
        var boxes=new ArrayList<Box>();
        // Each native row has a 16-pixel outline; require both long edges and sides.
        for(int top=32;top<=96;top+=16) {
            if(top>=clip.y()+clip.height())continue;
            int horizontal=0,sides=0;
            for(int x=88;x<232;x++)if(red(image.getRGB(x,top)) && red(image.getRGB(x,top+15)))horizontal++;
            for(int y=top+2;y<top+14;y++)if((red(image.getRGB(85,y)) || red(image.getRGB(86,y))) &&
                    (red(image.getRGB(233,y)) || red(image.getRGB(234,y))))sides++;
            if(horizontal>=138 && sides>=10)boxes.add(new Box(85,top,150,16));
        }
        return List.copyOf(boxes);
    }
    /** Restore only verified outline pixels that obscure the detector's fixed border. */
    public static BufferedImage detectorImage(BufferedImage source,JsonNode profiles,double gain) {
        var outlines=outlines(source,new Box(80,24,160,88));if(outlines.isEmpty())return source;
        JsonNode best=null;double bestScore=0,rawBest=0;
        for(var profile:profiles)if(isMoveList(profile.get("key").asText()))for(var variant:profile.get("variants")) {
            var palette=new HashMap<Integer,int[]>();
            for(var color:variant.get("palette")) {
                var rgb=color.get("rgb888");palette.put(color.get("index").asInt(),new int[]{rgb.get(0).asInt(),rgb.get(1).asInt(),rgb.get(2).asInt()});
            }
            int total=0,good=0,visible=0,visibleGood=0;
            for(var run:variant.get("fixed_runs"))for(int x=run.get(1).asInt();x<run.get(2).asInt();x++) {
                int y=run.get(0).asInt(),rgb=source.getRGB(x,y);var expected=palette.get(run.get(3).asInt());int distance=0;
                for(int c=0;c<3;c++)distance=Math.max(distance,Math.abs(((rgb>>(16-8*c))&255)-(int)Math.round(expected[c]*gain)));
                boolean matches=distance<=(gain<.9?48:12);total++;if(matches)good++;
                if(!outlinePixel(source,x,y,outlines)) {visible++;if(matches)visibleGood++;}
            }
            rawBest=Math.max(rawBest,(double)good/total);
            double score=visible<32?0:(double)visibleGood/visible;
            if(score>bestScore) {best=variant;bestScore=score;}
        }
        // Preserve all already supported frozen-detector inputs byte for byte.
        if(rawBest>=.92 || bestScore<.92)return source;
        var palette=new HashMap<Integer,Integer>();
        for(var color:best.get("palette")) {
            var rgb=color.get("rgb888");int value=0;
            for(int c=0;c<3;c++)value|=(int)Math.round(rgb.get(c).asInt()*gain)<<(16-8*c);
            palette.put(color.get("index").asInt(),value);
        }
        var text=new BufferedImage(240,160,BufferedImage.TYPE_INT_RGB);
        text.setRGB(0,0,240,160,source.getRGB(0,0,240,160,null,0,240),0,240);
        for(var run:best.get("fixed_runs"))for(int x=run.get(1).asInt();x<run.get(2).asInt();x++) {
            int y=run.get(0).asInt();if(outlinePixel(source,x,y,outlines))text.setRGB(x,y,palette.get(run.get(3).asInt()));
        }
        return text;
    }
    private static boolean outlinePixel(BufferedImage image,int x,int y,List<Box> outlines) {
        return red(image.getRGB(x,y)) && outlines.stream().anyMatch(b->b.contains(x,y));
    }
}
