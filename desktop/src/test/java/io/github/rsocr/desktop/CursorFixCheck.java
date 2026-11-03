package io.github.rsocr.desktop;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.github.rsocr.OcrEngine;
import io.github.rsocr.desktop.capture.*;
import javafx.application.Platform;
import javafx.scene.Scene;
import javafx.scene.SnapshotParameters;
import javafx.scene.layout.HBox;
import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.*;

/** Render the reported source through the original and corrected desktop paths. */
public final class CursorFixCheck {
    public static void main(String[] args) throws Exception {
        var root=Path.of(args[0]);var out=root.resolve("reports/cursor-fix");var json=new ObjectMapper();var engine=new OcrEngine(json);
        BufferedImage input;try(var in=CursorFixCheck.class.getResourceAsStream("/battle-right-cursor.png")){input=ImageIO.read(in);}
        var before=engine.recognize(input);var state=new LiveState(new LiveLayout(json));state.newSession(1);state.observe(input,.984,System.nanoTime());
        var job=state.job();state.complete(job,engine.recognize(job.image(),job.gain()));var after=state.snapshot().regions();var presentation=new Presentation(json);
        var done=new CompletableFuture<Void>();
        Platform.startup(()->{try {save(out.resolve("before.png"),input,presentation.panels(before,input));save(out.resolve("after.png"),input,presentation.panels(after,input));done.complete(null);}catch(Exception e){done.completeExceptionally(e);}});
        try {done.get(30,TimeUnit.SECONDS);}finally{Platform.exit();}
        var report=new LinkedHashMap<String,Object>();report.put("source","user-reported screenshot; see input.json");
        report.put("before",before);report.put("after",after);report.put("displayPanels",presentation.panels(after,input));
        report.put("cursorPositionsTested",List.of(List.of(8,120),List.of(72,120),List.of(8,136),List.of(72,136)));
        report.put("evidenceKind","reported static screenshot plus explicitly constructed four-position state checks");
        json.writerWithDefaultPrettyPrinter().writeValue(out.resolve("checks.json").toFile(),report);
        System.out.println("Reported screenshot rendered before/after; corrected text and selection recorded.");
    }
    private static void save(Path path,BufferedImage input,List<Presentation.Panel> panels) throws Exception {
        var source=new ResultCanvas(true);source.show(ResultCanvas.image(input),List.of(),"");source.setPrefSize(720,480);
        var result=new ResultCanvas(false);result.show(null,panels,"");result.setPrefSize(720,480);
        var pair=new HBox(16,source,result);pair.setStyle("-fx-background-color:#f4f7fc;-fx-padding:16;");new Scene(pair,1488,512);
        pair.resize(1488,512);pair.applyCss();pair.layout();var snapshot=pair.snapshot(new SnapshotParameters(),null);
        int w=(int)snapshot.getWidth(),h=(int)snapshot.getHeight();var image=new BufferedImage(w,h,BufferedImage.TYPE_INT_ARGB);
        int[] pixels=new int[w*h];snapshot.getPixelReader().getPixels(0,0,w,h,javafx.scene.image.PixelFormat.getIntArgbInstance(),pixels,0,w);image.setRGB(0,0,w,h,pixels,0,w);ImageIO.write(image,"png",path.toFile());
    }
}
