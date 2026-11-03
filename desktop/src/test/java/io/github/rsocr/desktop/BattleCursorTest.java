package io.github.rsocr.desktop;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.github.rsocr.OcrEngine;
import io.github.rsocr.desktop.capture.*;
import org.junit.jupiter.api.Test;
import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.util.*;
import java.util.concurrent.atomic.AtomicLong;
import static org.junit.jupiter.api.Assertions.*;

class BattleCursorTest {
    private final ObjectMapper json=new ObjectMapper();
    private final OcrEngine engine=new OcrEngine(json);
    private final LiveLayout layout=new LiveLayout(json);
    private final Presentation presentation=new Presentation(json);
    private static final String MOVES="あさのひざし すいとる\nかぜおこし しびれごな";
    BattleCursorTest() throws Exception {}
    private BufferedImage source() throws Exception {try(var in=getClass().getResourceAsStream("/battle-right-cursor.png")){return ImageIO.read(in);}}
    private BufferedImage copy(BufferedImage input) {var image=new BufferedImage(240,160,BufferedImage.TYPE_INT_RGB);image.setRGB(0,0,240,160,input.getRGB(0,0,240,160,null,0,240),0,240);return image;}
    private OcrEngine.Region moves(List<OcrEngine.Region> regions) {return regions.stream().filter(r->r.typeCandidates().contains("battle_moves")).findFirst().orElseThrow();}
    @Test void reportedRightColumnCursorIsSeparatedBeforeReadingAndSourceIsUntouched() throws Exception {
        var input=source();int[] original=input.getRGB(0,0,240,160,null,0,240);
        assertTrue(moves(engine.recognize(input)).characters().stream().anyMatch(c->c.x()==72&&c.y()==120&&c.raw().equals("�")),"Reproduce the reported cursor-as-text error.");
        var text=layout.textImage(input,layout.locate(input));var regions=engine.recognize(text);var moves=moves(regions);
        assertEquals(MOVES,moves.rawOcr());assertEquals("recognized",moves.status());
        var panel=presentation.panels(regions,input).stream().filter(p->p.key().equals("battle_moves")).findFirst().orElseThrow();
        assertEquals(List.of(new Presentation.Pointer(72,120)),panel.pointers());
        assertFalse(panel.runs().stream().anyMatch(r->r.x()==72&&r.y()==120));
        assertArrayEquals(original,input.getRGB(0,0,240,160,null,0,240));
    }
    @Test void fourMovePositionsUpdateThePointerWithoutChangingTextOrRestartingOcr() throws Exception {
        var input=source();var base=layout.textImage(input,layout.locate(input));
        var mask=json.readTree(BattleCursor.class.getResourceAsStream("/cursors.json")).get("battle_arrow");
        var clock=new AtomicLong();var state=new LiveState(layout,clock::get);state.newSession(1);String previous=null;
        for(int[] position:List.of(new int[]{8,120},new int[]{72,120},new int[]{8,136},new int[]{72,136})) {
            var frame=copy(base);for(int y=0;y<16;y++)for(int x=0;x<8;x++)if((mask.get(y).asInt()&(1<<(7-x)))!=0)frame.setRGB(position[0]+x,position[1]+y,0xff494151);
            state.observe(frame,.984,System.nanoTime());
            if(previous==null){assertNull(state.job());clock.addAndGet(LiveState.STABILITY_NANOS);var job=state.job();assertNotNull(job);state.complete(job,engine.recognize(job.image(),job.gain()));}
            else assertNull(state.job(),"Only the cursor changed; the Japanese text remains current.");
            assertEquals(MOVES,moves(state.snapshot().regions()).rawOcr());previous=MOVES;
            var panel=presentation.panels(state.snapshot().regions(),frame).stream().filter(p->p.key().equals("battle_moves")).findFirst().orElseThrow();
            assertEquals(List.of(new Presentation.Pointer(position[0],position[1])),panel.pointers());assertTrue(panel.runs().stream().noneMatch(Presentation.Run::unknown));
        }
    }
    @Test void anActualUnknownCharacterRemainsVisibleAndUnverifiedShapesAreNotErased() throws Exception {
        var input=source();for(int y=120;y<136;y++)for(int x=96;x<104;x++)input.setRGB(x,y,0xff111111);
        var regions=engine.recognize(layout.textImage(input,layout.locate(input)));
        assertTrue(moves(regions).characters().stream().anyMatch(c->c.x()==96&&c.y()==120&&c.raw().equals("�")));
        var badCursor=source();badCursor.setRGB(72,120,0xff111111);
        assertSame(badCursor,layout.textImage(badCursor,layout.locate(badCursor)),"A near-match is not a confirmed native cursor.");
    }
}
