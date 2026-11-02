package io.github.rsocr;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.util.*;

/** Raw bitmap candidates. No corpus matching or linguistic disambiguation. */
public final class PixelFont {
    public record Glyph(int font, int code, String text, int[] rows) {}
    public record Match(List<String> candidates, int distance, int runnerUpDistance) {}
    private final List<Glyph> glyphs;

    public PixelFont(ObjectMapper mapper) throws IOException {
        try(var in=PixelFont.class.getResourceAsStream("/ocr/fonts.json")) {
            glyphs=List.of(mapper.treeToValue(mapper.readTree(in).get("glyphs"),Glyph[].class));
        }
    }

    public Match match(int font, int[] rows, int width) {
        int best=129,second=129;
        var candidates=new ArrayList<String>();
        int mask=(255 << (8-width)) & 255;
        for(var g:glyphs) if(g.font()==font) {
            int distance=0;
            for(int y=0;y<16;y++) distance+=Integer.bitCount((rows[y]^g.rows()[y]) & mask);
            if(distance<best) { second=best;best=distance;candidates.clear();candidates.add(g.text()); }
            else if(distance==best) { if(!candidates.contains(g.text())) candidates.add(g.text()); }
            else second=Math.min(second,distance);
        }
        return new Match(List.copyOf(candidates),best,second);
    }
}
