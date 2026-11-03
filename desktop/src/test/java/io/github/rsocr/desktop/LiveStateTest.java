package io.github.rsocr.desktop;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.github.rsocr.*;
import io.github.rsocr.desktop.capture.*;
import java.awt.image.BufferedImage;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.atomic.AtomicLong;
import javax.imageio.ImageIO;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class LiveStateTest {
    private final AtomicLong clock=new AtomicLong();
    private LiveState state() {return new LiveState(layout,clock::get);}
    private LiveState.Job stableJob(LiveState state) {clock.addAndGet(LiveState.STABILITY_NANOS);return state.job();}
    private final ObjectMapper json=new ObjectMapper();
    private final LiveLayout layout=new LiveLayout(json);
    private final OcrEngine engine=new OcrEngine(json);
    LiveStateTest() throws Exception {}
    private BufferedImage image(String source) throws Exception {
        var im=ImageIO.read(Path.of("..",source).toFile());return Normalizer.normalize(im,Normalizer.preset(DesktopApplication.autoProfile(im.getWidth(),im.getHeight()),im));
    }
    private BufferedImage dialogue() throws Exception {return image("gba_testcase/Screenshot 2026-10-31 15-38-28.png");}
    private BufferedImage copy(BufferedImage im) {var out=new BufferedImage(240,160,BufferedImage.TYPE_INT_RGB);out.setRGB(0,0,240,160,im.getRGB(0,0,240,160,null,0,240),0,240);return out;}
    @Test void geometryMatchesTheFrozenDetectorOnAll456ExistingImages() throws Exception {
        var ref=json.readTree(Path.of("../reports/s3-acceptance/reference.json").toFile());int panels=0;
        for(var entry:ref.get("images")) {
            var im=image(entry.get("source").asText());double gain=entry.get("id").asText().startsWith("NGC")?.82:.984;
            var expected=engine.recognize(im,gain);var actual=layout.locate(im,gain);
            var cursorSeparated=engine.recognize(layout.textImage(im,actual),gain);
            assertEquals(expected.stream().map(r->r.typeCandidates()+":"+r.rawOcr()).toList(),cursorSeparated.stream().map(r->r.typeCandidates()+":"+r.rawOcr()).toList(),"Frozen screenshot results must stay unchanged: "+entry.get("id").asText());
            assertEquals(expected.size(),actual.size(),entry.get("id").asText());
            for(int i=0;i<expected.size();i++) {
                assertEquals(expected.get(i).typeCandidates(),actual.get(i).typeCandidates());assertEquals(expected.get(i).variant(),actual.get(i).variant());
                assertArrayEquals(expected.get(i).logicalBox(),actual.get(i).logicalBox());assertEquals("pending",actual.get(i).status());
                assertTrue(actual.get(i).characters().isEmpty());assertEquals("",actual.get(i).rawOcr());
            }
            panels+=actual.size();
        }
        assertEquals(579,panels);
        Files.createDirectories(Path.of("../reports/s5-live"));
        json.writerWithDefaultPrettyPrinter().writeValue(Path.of("../reports/s5-live/layout-compatibility.json").toFile(),Map.of("images",456,"regions",panels,"geometryIndependentOfOcrSuccess",true,"frozenDetectorEquivalent",true));
    }
    @Test void changedTextRejectsLateCompletionWhileBackgroundAnimationDoesNotStarveIt() throws Exception {
        var state=state();state.newSession(1);var first=dialogue();state.observe(first,.984,10);var job=stableJob(state);assertNotNull(job);
        var animated=copy(first);animated.setRGB(0,0,first.getRGB(0,0)^0x00ffffff);state.observe(animated,.984,11);
        assertTrue(state.complete(job,engine.recognize(first)));assertEquals(0,state.snapshot().pending());
        var next=image("gba_testcase/Screenshot 2026-10-31 15-38-35.png");state.observe(next,.984,20);
        assertTrue(state.snapshot().regions().stream().allMatch(r->r.rawOcr().isEmpty()));
        assertFalse(state.complete(job,engine.recognize(first)));assertTrue(state.snapshot().pending()>0);
    }
    @Test void clearingTextKeepsItsObservablePanelAndDisappearanceRemovesIt() throws Exception {
        var state=state();state.newSession(1);var first=dialogue();state.observe(first,.984,10);var job=stableJob(state);state.complete(job,engine.recognize(first));
        var empty=copy(first);for(int y=120;y<152;y++)for(int x=32;x<224;x++) {
            int rgb=first.getRGB(x,y);if(((rgb>>16)&255)<130 && ((rgb>>8)&255)<130 && (rgb&255)<130)empty.setRGB(x,y,first.getRGB(32,120));
        }
        state.observe(empty,.984,20);var emptyJob=stableJob(state);assertNotNull(emptyJob);state.complete(emptyJob,engine.recognize(empty));
        assertEquals(1,state.snapshot().regions().size());assertEquals("",state.snapshot().regions().getFirst().rawOcr());
        state.observe(new BufferedImage(240,160,BufferedImage.TYPE_INT_RGB),.984,30);assertTrue(state.snapshot().regions().isEmpty());
        assertFalse(state.complete(job,engine.recognize(first)));
    }
    @Test void sourceMappingAndRestartInvalidateIdenticalOldPixels() throws Exception {
        var state=state();var image=dialogue();state.newSession(1);state.observe(image,.984,10);var old=stableJob(state);
        state.reset(1,2);state.observe(image,.984,20);assertFalse(state.complete(old,engine.recognize(image)));
        var mapped=stableJob(state);state.newSession(2);state.observe(image,.984,30);assertFalse(state.complete(mapped,engine.recognize(image)));
        assertTrue(state.complete(stableJob(state),engine.recognize(image)));assertEquals(0,state.snapshot().pending());
    }
    @Test void manualMappingRejectsSizeAndDpiChanges() {
        var map=new LiveMapping(new Normalizer.Viewport(8,31,1200,800),.984,1216,839,96,true);
        assertTrue(map.matches(poll(1216,839,96)));assertFalse(map.matches(poll(1216,839,144)));assertFalse(map.matches(poll(1232,839,96)));
    }
    @Test void printingDefersOcrUntilTheLastTextChangeHasBeenStableFor150ms() throws Exception {
        var state=state();state.newSession(1);var first=dialogue();state.observe(first,.984,10);
        assertNull(state.job());clock.set(149_000_000L);assertNull(state.job());
        var next=copy(first);next.setRGB(32,120,0x222222);state.observe(next,.984,20);
        clock.set(298_000_000L);assertNull(state.job(),"Each new glyph restarts the wait");
        clock.set(299_000_000L);var job=state.job();assertNotNull(job);
        assertSame(next,job.image());assertTrue(state.complete(job,engine.recognize(next)));
        assertNull(state.job(),"An unchanged stable page is recognized once");
        assertEquals(20,state.snapshot().ready().getFirst().firstObservedNanos(),"Measurement includes the stability wait");
    }
    @Test void waitingArrowAndBackgroundAnimationDoNotResetTextStabilityOrClearResults() throws Exception {
        var state=state();state.newSession(1);var first=dialogue();
        // Use an observed empty cell, so this simulates an arrow blinking in a gap,
        // rather than drawing over a letter that really changed.
        for(int y=136;y<152;y++)for(int x=208;x<224;x++)first.setRGB(x,y,0xfff8f8f8);
        state.observe(first,.984,10);
        var blinking=copy(first);for(int y=141;y<147;y++)for(int x=218;x<222;x++)blinking.setRGB(x,y,0xffe00000);
        blinking.setRGB(0,0,0xff00ff00);clock.set(100_000_000L);state.observe(blinking,.984,20);
        clock.set(150_000_000L);var job=state.job();assertNotNull(job,"Cursor animation must not restart the wait");
        assertTrue(state.complete(job,engine.recognize(blinking)));
        var key=state.snapshot().ready().getFirst().key();
        clock.set(200_000_000L);state.observe(first,.984,30);
        assertEquals(key,state.snapshot().ready().getFirst().key());assertNull(state.job());
    }
    @Test void wholeFrameOcrWaitsForPrintingPanelsButRetainsOtherStableResults() throws Exception {
        var state=state();state.newSession(1);
        var first=image("gba_testcase/Screenshot 2026-10-31 16-07-07.png");state.observe(first,.984,10);
        var job=stableJob(state);assertNotNull(job);state.complete(job,engine.recognize(first));
        var next=copy(first);next.setRGB(120,16,0x222222);state.observe(next,.984,20);
        assertNull(state.job());assertTrue(state.snapshot().pending()>0);
        assertFalse(state.snapshot().ready().isEmpty(),"Other panels keep their recognized text");
        assertNotNull(stableJob(state));
    }
    private WindowCapture.Poll poll(int w,int h,int dpi) {return new WindowCapture.Poll(WindowCapture.Status.RUNNING,"",1,1,1,2,2,new BufferedImage(w,h,BufferedImage.TYPE_INT_RGB),List.of(),dpi);}
}

