package io.github.rsocr.desktop;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.github.rsocr.*;
import io.github.rsocr.desktop.capture.*;
import javafx.application.Platform;
import javafx.scene.Scene;
import javafx.scene.layout.StackPane;
import javax.imageio.ImageIO;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicLong;
/** Standalone JavaFX pixel comparison for summary selection blinking and real movement. */
public class SummarySelectionRenderCheck {
    public static void main(String[] args) throws Exception {
        var done=new CompletableFuture<Void>();Platform.startup(()->{try {
            var json=new ObjectMapper();var layout=new LiveLayout(json);var engine=new OcrEngine(json);var presentation=new Presentation(json);
            var test=new SummaryMoveSelectionTest();var input=ImageIO.read(Path.of("gba_testcase/Screenshot 2026-11-01 20-59-31.png").toFile());
            var base=Normalizer.normalize(input,Normalizer.preset("gba-5x",input));var visible=test.outlined(base,4);
            var clock=new AtomicLong();var state=new LiveState(layout,clock::get);var display=new LivePresentation(clock::get);state.newSession(1);
            state.observe(visible,.984,0);clock.set(LiveState.STABILITY_NANOS);var job=state.job();state.complete(job,engine.recognize(job.image()));
            StabilityRenderCheck.out=Path.of("reports/summary-selection");Files.createDirectories(StabilityRenderCheck.out);
            StabilityRenderCheck.board=new ResultCanvas(false);StabilityRenderCheck.root=new StackPane(StabilityRenderCheck.board);
            new Scene(StabilityRenderCheck.root,960,640);StabilityRenderCheck.root.resize(960,640);
            var first=StabilityRenderCheck.render("return-selected",display.stabilize(presentation.panels(state.snapshot().regions(),visible)));
            clock.set(2_000_000_000L);state.observe(base,.984,1);
            var dark=StabilityRenderCheck.render("return-blink-held",display.stabilize(presentation.panels(state.snapshot().regions(),base)));
            if(!StabilityRenderCheck.same(first,dark))throw new AssertionError("Blink changes result pixels");
            var moved=test.outlined(base,0);clock.set(3_000_000_000L);state.observe(moved,.984,2);
            display.stabilize(presentation.panels(state.snapshot().regions(),moved));clock.addAndGet(60_000_000L);
            var next=StabilityRenderCheck.render("first-move-selected",display.stabilize(presentation.panels(state.snapshot().regions(),moved)));
            if(StabilityRenderCheck.same(first,next))throw new AssertionError("Selection movement not visible");
            if(state.snapshot().pending()!=0 || state.job()!=null)throw new AssertionError("Blink restarted OCR");
            json.writerWithDefaultPrettyPrinter().writeValue(StabilityRenderCheck.out.resolve("render-checks.json").toFile(),Map.of("passed",true,"blinkResultPixelsIdentical",true,"realMoveChangesResultPixels",true,"blinkDoesNotRestartOcr",true,"size",List.of(960,640),"physicalDeviceRetested",false));
            done.complete(null);
        }catch(Throwable error){done.completeExceptionally(error);}});
        try{done.get(45,TimeUnit.SECONDS);}finally{Platform.exit();}
        System.out.println("Summary selection render checks passed.");
    }
}
