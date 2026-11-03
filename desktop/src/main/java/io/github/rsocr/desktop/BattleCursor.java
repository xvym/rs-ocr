package io.github.rsocr.desktop;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.github.rsocr.OcrEngine.Region;
import java.awt.image.BufferedImage;
import java.io.IOException;
import java.util.*;

/** A native battle cursor occupies a reserved menu cell, separate from the move/action text. */
public final class BattleCursor {
    private final int[] rows=new int[16];
    public BattleCursor(ObjectMapper mapper) throws IOException {
        try(var in=BattleCursor.class.getResourceAsStream("/cursors.json")) {
            var mask=mapper.readTree(in).get("battle_arrow");for(int y=0;y<16;y++)rows[y]=mask.get(y).asInt();
        }
    }
    public BufferedImage textImage(BufferedImage source,List<Region> regions) {
        var cells=new ArrayList<int[]>();
        for(var region:regions) {
            int[] columns=switch(region.typeCandidates().getFirst()) {
                case "battle_moves"->new int[]{8,72};
                case "battle_action"->new int[]{144,200};
                default->new int[0];
            };
            for(int y:new int[]{120,136})for(int x:columns)if(matches(source,x,y))cells.add(new int[]{x,y});
        }
        if(cells.isEmpty())return source;
        var text=new BufferedImage(240,160,BufferedImage.TYPE_INT_RGB);
        text.setRGB(0,0,240,160,source.getRGB(0,0,240,160,null,0,240),0,240);
        for(var cell:cells) {
            // The verified cursor's top-left pixel is background, outside its native foreground mask.
            int background=source.getRGB(cell[0],cell[1]);
            for(int y=0;y<16;y++)for(int x=0;x<8;x++)text.setRGB(cell[0]+x,cell[1]+y,background);
        }
        return text;
    }
    private boolean matches(BufferedImage image,int x,int y) {
        for(int dy=0;dy<16;dy++)for(int dx=0;dx<8;dx++) {
            int rgb=image.getRGB(x+dx,y+dy);boolean foreground=((rgb>>16)&255)<130&&((rgb>>8)&255)<130&&(rgb&255)<130;
            if(foreground!=((rows[dy]&(1<<(7-dx)))!=0))return false;
        }
        return true;
    }
}
