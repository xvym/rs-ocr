package io.github.rsocr.desktop;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.github.rsocr.OcrEngine;
import java.awt.image.BufferedImage;
import java.io.IOException;
import java.util.*;

/** Native cursor shapes shared by text-change detection and selection display. */
public final class CursorPixels {
    private final List<int[]> arrows=new ArrayList<>();
    public CursorPixels(ObjectMapper mapper) throws IOException {
        try(var in=OcrEngine.class.getResourceAsStream("/ocr/fonts.json")) {
            for(var glyph:mapper.readTree(in).get("glyphs"))if(glyph.get("font").asInt()==3 && glyph.get("text").asText().equals("▶")) {
                int[] rows=new int[16];for(int i=0;i<16;i++)rows[i]=glyph.get("rows").get(i).asInt();arrows.add(rows);
            }
        }
        try(var in=CursorPixels.class.getResourceAsStream("/cursors.json")) {
            var glyph=mapper.readTree(in).get("battle_arrow");
            int[] rows=new int[16];for(int i=0;i<16;i++)rows[i]=glyph.get(i).asInt();arrows.add(rows);
        }
    }
    public boolean arrow(BufferedImage image,int x,int y) {
        if(x<0 || y<0 || x+8>image.getWidth() || y+16>image.getHeight())return false;
        for(var rows:arrows)if(matches(image,x,y,false,rows)||matches(image,x,y,true,rows))return true;
        return false;
    }
    private boolean matches(BufferedImage image,int x,int y,boolean light,int[] rows) {
        for(int dy=0;dy<16;dy++)for(int dx=0;dx<8;dx++) {
            int rgb=image.getRGB(x+dx,y+dy),r=(rgb>>16)&255,g=(rgb>>8)&255,b=rgb&255;
            boolean on=light?Math.min(r,Math.min(g,b))>180:Math.max(r,Math.max(g,b))<130;
            if(on!=((rows[dy] & (1<<(7-dx)))!=0))return false;
        }
        return true;
    }
    // Same observable red-arrow rule as the OCR reader, without recognizing text.
    public boolean waitArrow(BufferedImage image,int x,int y,int width) {
        int red=0;
        for(int dy=0;dy<16;dy++)for(int dx=0;dx<width;dx++) {
            int rgb=image.getRGB(x+dx,y+dy);
            if(((rgb>>16)&255)>140 && ((rgb>>8)&255)<80 && (rgb&255)<80)red++;
        }
        return red>3;
    }
}
