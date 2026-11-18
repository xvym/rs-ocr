package io.github.rsocr.desktop;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.github.rsocr.*;
import io.github.rsocr.desktop.capture.*;
import java.awt.image.BufferedImage;
import java.util.*;
import java.util.concurrent.atomic.AtomicLong;
import javax.imageio.ImageIO;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class SummaryMoveSelectionTest {
    private final ObjectMapper json=new ObjectMapper();
    private final LiveLayout layout=new LiveLayout(json);
    private final OcrEngine engine=new OcrEngine(json);
    private final Presentation presentation=new Presentation(json);
    SummaryMoveSelectionTest() throws Exception {}
    private BufferedImage source(String state) throws Exception {
        try(var in=getClass().getResourceAsStream("/summary-outline-"+state+".png")) {return ImageIO.read(in);}
    }
    private OcrEngine.Region moves(List<OcrEngine.Region> regions) {
        return regions.stream().filter(r->r.typeCandidates().contains("summary_battle_moves")).findFirst().orElseThrow();
    }
    private boolean red(int rgb) {int r=(rgb>>16)&255,g=(rgb>>8)&255,b=rgb&255;return r>100 && r>g*1.4 && r>b*1.3;}
    // Replay the reported native outline over identical content to isolate animation from capture resampling.
    BufferedImage outlined(BufferedImage base,int row) throws Exception {
        var mask=source("visible");var image=new BufferedImage(240,160,BufferedImage.TYPE_INT_RGB);
        image.setRGB(0,0,240,160,base.getRGB(0,0,240,160,null,0,240),0,240);
        for(int y=96;y<112;y++)for(int x=85;x<235;x++)if(red(mask.getRGB(x,y))) {
            int targetY=y-96+32+row*16,rgb=base.getRGB(x,targetY);
            // The native outline is behind the white move-name glyphs (including dakuten).
            if(x>=120 && x<176 && Math.min((rgb>>16)&255,Math.min((rgb>>8)&255,rgb&255))>180)continue;
            image.setRGB(x,targetY,mask.getRGB(x,y));
        }
        return image;
    }
    @Test void reportedReturnOutlineNoLongerMakesTheWholeMovePanelDisappear() throws Exception {
        var input=source("visible");int[] original=input.getRGB(0,0,240,160,null,0,240);
        assertTrue(engine.recognize(input).isEmpty(),"Reproduce the frozen detector missing the outlined panel.");
        var located=layout.locate(input);var region=moves(located);assertArrayEquals(new int[]{80,24,160,88},region.logicalBox());
        var text=layout.textImage(input,located);assertFalse(moves(engine.recognize(text)).rawOcr().isEmpty());
        assertEquals(List.of(new Presentation.Box(85,96,150,16)),presentation.panels(located,input).getFirst().selections());
        assertArrayEquals(original,input.getRGB(0,0,240,160,null,0,240));
    }
    @Test void allFiveRowsCanBlinkAndMoveWithoutInvalidatingTextOrTheInFlightJob() throws Exception {
        var base=source("hidden");var clock=new AtomicLong();var state=new LiveState(layout,clock::get);state.newSession(1);
        state.observe(base,.984,1);clock.addAndGet(LiveState.STABILITY_NANOS);var job=state.job();assertNotNull(job);
        var expected=moves(engine.recognize(job.image())).rawOcr();
        for(int row=0;row<5;row++) {
            var frame=outlined(base,row);state.observe(frame,.984,2+row);
            assertNotNull(state.job(),"Outline row "+row+" must not restart text stability.");
            assertEquals(job.keys(),state.job().keys(),"Outline row "+row+" must not create another content generation.");
            var regions=layout.locate(frame);assertArrayEquals(new int[]{80,24,160,88},moves(regions).logicalBox());
            assertEquals(expected,moves(engine.recognize(layout.textImage(frame,regions))).rawOcr(),"Outline row "+row+" must not alter OCR.");
            assertEquals(List.of(new Presentation.Box(85,32+row*16,150,16)),presentation.panels(regions,frame).getFirst().selections());
            state.observe(base,.984,10+row);assertEquals(job.keys(),state.job().keys());
        }
        assertTrue(state.complete(job,engine.recognize(job.image())));
        for(int row=0;row<5;row++) {
            state.observe(outlined(base,row),.984,20+row);assertEquals(0,state.snapshot().pending());assertNull(state.job());
        }
        var changed=outlined(base,0);int pixel=changed.getRGB(130,40);
        changed.setRGB(130,40,Math.min((pixel>>16)&255,Math.min((pixel>>8)&255,pixel&255))>180?0x000000:0xffffff);state.observe(changed,.984,30);
        assertTrue(state.snapshot().pending()>0,"Actual glyph changes must still invalidate text.");
    }
    @Test void nativeGbaAndNgcMoveNamesAndPpStayRecognizedWhenEachRowBlinks() throws Exception {
        for(String file:List.of("gba_testcase/Screenshot 2026-11-01 20-59-31.png","ngc_testcase/Screenshot 2026-11-01 21-18-45.png")) {
            var path=java.nio.file.Path.of("..",file);
            var input=ImageIO.read(path.toFile());boolean gba=input.getWidth()==1200;double gain=gba?.984:.82;
            var base=Normalizer.normalize(input,Normalizer.preset(gba?"gba-5x":"ngc-capture",input));
            var original=moves(engine.recognize(base,gain));assertEquals("recognized",original.status());
            for(int row=0;row<5;row++) {
                var frame=outlined(base,row);var regions=layout.locate(frame,gain);
                var actual=moves(engine.recognize(layout.textImage(frame,regions,gain),gain));
                assertEquals(original.rawOcr(),actual.rawOcr(),file+" row "+row);
                assertArrayEquals(layout.fingerprint(moves(layout.locate(base,gain)),layout.locate(base,gain),base,gain),
                        layout.fingerprint(moves(regions),regions,layout.textImage(frame,regions,gain),gain),file+" row "+row);
            }
        }
    }
}
