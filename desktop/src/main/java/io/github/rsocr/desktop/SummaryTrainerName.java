package io.github.rsocr.desktop;

import com.fasterxml.jackson.databind.*;
import io.github.rsocr.OcrEngine.Region;
import io.github.rsocr.PixelFont;
import java.awt.image.BufferedImage;
import java.io.IOException;
import java.util.*;

/** Separate the summary's pink name ink from its red shadow using exact ROM glyphs. */
public final class SummaryTrainerName {
    private final PixelFont font;
    public SummaryTrainerName(ObjectMapper mapper) throws IOException {font=new PixelFont(mapper);}
    private static boolean legacy(int rgb) {
        int r=(rgb>>16)&255,g=(rgb>>8)&255,b=rgb&255;
        return g>200 && b>200 && r<130 || r>190 && g>110 && g<190 && b<195;
    }
    private static boolean ink(int rgb,double gain) {
        int r=(rgb>>16)&255,g=(rgb>>8)&255,b=rgb&255;
        return g>200 && b>200 && r<130 ||
            r>230*gain && g>140*gain && g<200*gain && b<210*gain && r-g>40*gain && r-b>40*gain;
    }
    public BufferedImage textImage(BufferedImage source,List<Region> regions,JsonNode profiles,double gain) {
        if(regions.stream().noneMatch(r->r.typeCandidates().contains("summary_personal")))return source;
        BufferedImage text=source;
        for(var profile:profiles)if(profile.path("key").asText().equals("summary_personal"))
            for(var row:profile.get("rows"))for(var block:row)if(block.path("color").asText().equals("name")) {
                int advance=block.get("advance").asInt(),top=block.get("y").asInt(),fontId=block.get("font").asInt();
                for(int left=block.get("x").asInt();left+advance<=block.get("right").asInt();left+=advance) {
                    int[] old=new int[16],candidate=new int[16];int on=0;
                    for(int y=0;y<16;y++)for(int x=0;x<advance;x++) {
                        int rgb=source.getRGB(left+x,top+y),bit=1<<(7-x);
                        if(legacy(rgb))old[y]|=bit;
                        if(ink(rgb,gain)){candidate[y]|=bit;on++;}
                    }
                    // Keep supported inputs and unknown shapes unchanged. No name or word lookup.
                    if(on==0 || Arrays.equals(old,candidate) || font.match(fontId,old,advance).distance()==0 ||
                            font.match(fontId,candidate,advance).distance()!=0)continue;
                    if(text==source) {
                        text=new BufferedImage(source.getWidth(),source.getHeight(),BufferedImage.TYPE_INT_RGB);
                        text.setRGB(0,0,source.getWidth(),source.getHeight(),source.getRGB(0,0,source.getWidth(),source.getHeight(),null,0,source.getWidth()),0,source.getWidth());
                    }
                    int background=source.getRGB(left,top);if(legacy(background))background=0;
                    for(int y=0;y<16;y++)for(int x=0;x<advance;x++)
                        text.setRGB(left+x,top+y,(candidate[y]&(1<<(7-x)))!=0?0x00ffff:background);
                }
            }
        return text;
    }
}
