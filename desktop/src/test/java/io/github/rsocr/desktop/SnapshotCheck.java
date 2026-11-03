package io.github.rsocr.desktop;

import com.fasterxml.jackson.databind.*;
import io.github.rsocr.*;
import javafx.application.Platform;
import javafx.scene.Scene;
import javafx.scene.SnapshotParameters;
import javafx.scene.image.WritableImage;
import javafx.scene.layout.*;
import javafx.scene.control.Label;
import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.*;

/** Real fixed-image layout sweep plus explicitly constructed display states. */
public final class SnapshotCheck {
    private static final ObjectMapper JSON=new ObjectMapper();
    private static final Map<String,List<Presentation.Panel>> fixtures=new LinkedHashMap<>();
    private static final Map<String,BufferedImage> images=new HashMap<>();
    public static void main(String[] args) throws Exception {
        var root=Path.of(args[0]).toAbsolutePath();var out=root.resolve("reports/s4-window");Files.createDirectories(out);
        var reference=JSON.readTree(root.resolve("reports/s3-acceptance/reference.json").toFile());
        var engine=new OcrEngine(JSON);var presentation=new Presentation(JSON);
        var samples=Map.ofEntries(Map.entry("GBA-001","dialogue"),Map.entry("GBA-027","list-dialogue"),Map.entry("GBA-090","battle-menu"),
            Map.entry("GBA-278","list-action"),Map.entry("GBA-305","stats"),Map.entry("GBA-304","personal"),
            Map.entry("NGC-096","condition"),Map.entry("NGC-097","condition-covered"),Map.entry("NGC-124","ngc-stats"),Map.entry("NGC-126","moves"));
        int frameCount=0,panelCount=0,runCount=0,pointerCount=0,selectionCount=0;
        var trace=new ArrayList<Map<String,Object>>();
        for(var im:reference.get("images")) {
            var path=root.resolve(im.get("source").asText());var source=ImageIO.read(path.toFile());String profile=DesktopApplication.autoProfile(source.getWidth(),source.getHeight());
            var normalized=Normalizer.normalize(source,Normalizer.preset(profile,source));var regions=engine.recognize(normalized,profile.equals("ngc-capture")?.82:.984);
            var panels=presentation.panels(regions,normalized);
            if(panels.size()!=regions.size())throw new AssertionError("Lost a display region: "+path);
            for(var panel:panels) {
                var original=regions.stream().filter(r->r.typeCandidates().getFirst().equals(panel.key())).findFirst().orElseThrow();
                if(!panel.raw().equals(original.rawOcr()))throw new AssertionError("Display rewrote raw OCR");
                for(var run:panel.runs()) {
                    if(run.x()<panel.clip().x() || run.y()<panel.clip().y() || run.x()+run.width()>panel.clip().x()+panel.clip().width() || run.y()+run.height()>panel.clip().y()+panel.clip().height())throw new AssertionError("Text bounds leave region: "+path+" "+panel.key()+" "+run);
                    runCount++;
                }
                pointerCount+=panel.pointers().size();selectionCount+=panel.selections().size();panelCount++;
            }
            String id=im.get("id").asText();if(samples.containsKey(id)){fixtures.put(samples.get(id),panels);images.put(samples.get(id),normalized);}
            trace.add(Map.of("source",im.get("source").asText(),"sourceSha256",im.get("sha256").asText(),"regions",panels.size()));frameCount++;
        }
        var done=new CompletableFuture<Void>();
        Platform.startup(()->{
            try {
                for(var entry:fixtures.entrySet()) {
                    savePair(out.resolve(entry.getKey()+".png"),entry.getValue(),images.get(entry.getKey()));
                    saveResult(out.resolve(entry.getKey()+"-tall.png"),entry.getValue(),640,700,"");
                }
                var ready=fixtures.get("dialogue").getFirst();
                var pending=new Presentation.Panel(ready.key(),ready.name(),ready.clip(),ready.frame(),ready.order(),"","pending",List.of(),List.of());
                var empty=new Presentation.Panel(ready.key(),ready.name(),ready.clip(),ready.frame(),ready.order(),"","recognized",List.of(),List.of());
                saveResult(out.resolve("state-pending.png"),List.of(pending),960,640,"");
                saveResult(out.resolve("state-empty.png"),List.of(empty),960,640,"");
                saveResult(out.resolve("state-removed.png"),List.of(),960,640,"已停止，结果已清除");
                done.complete(null);
            } catch(Throwable e){done.completeExceptionally(e);}
        });
        try {done.get(60,TimeUnit.SECONDS);}finally{Platform.exit();}
        var report=new LinkedHashMap<String,Object>();report.put("evidenceKind","real_static_image_layout_sweep_and_constructed_state_snapshots");
        report.put("images",frameCount);report.put("panels",panelCount);report.put("textRuns",runCount);report.put("pointers",pointerCount);
        report.put("selectionOutlines",selectionCount);
        report.put("rawTextUnchanged",true);report.put("allTextWithinOwnedRegion",true);report.put("representativePairs",fixtures.size());report.put("snapshots",fixtures.size()*2+3);
        report.put("constructedStates",List.of("pending with observed geometry","observable empty panel","removed/stopped"));
        report.put("captureTimingVerified",false);report.put("frames",trace);
        Files.writeString(out.resolve("layout-checks.json"),JSON.writerWithDefaultPrettyPrinter().writeValueAsString(report)+"\n");
        System.out.println("Layout sweep passed: "+frameCount+" images, "+panelCount+" panels, "+runCount+" text runs, "+pointerCount+" pointers.");
    }
    private static void savePair(Path path,List<Presentation.Panel> panels,BufferedImage image) throws Exception {
        var left=new ResultCanvas(true);left.show(ResultCanvas.image(image),List.of(),"");left.setPrefSize(720,480);
        var right=new ResultCanvas(false);right.show(null,panels,"");right.setPrefSize(720,480);
        var first=new VBox(8,new Label("实机画面"),left);var second=new VBox(8,new Label("原始日文"),right);
        var root=new HBox(16,first,second);root.setStyle("-fx-background-color:#f4f7fc;-fx-padding:16;-fx-font-family:'Microsoft YaHei';");
        new Scene(root,1488,540);root.resize(1488,540);root.applyCss();root.layout();write(path,root.snapshot(new SnapshotParameters(),null));
    }
    private static void saveResult(Path path,List<Presentation.Panel> panels,int width,int height,String message) throws Exception {
        var board=new ResultCanvas(false);board.show(null,panels,message);var root=new StackPane(board);new Scene(root,width,height);
        root.resize(width,height);root.applyCss();root.layout();write(path,root.snapshot(new SnapshotParameters(),null));
    }
    private static void write(Path path,WritableImage image) throws Exception {
        int w=(int)image.getWidth(),h=(int)image.getHeight();var copy=new BufferedImage(w,h,BufferedImage.TYPE_INT_ARGB);
        for(int y=0;y<h;y++)for(int x=0;x<w;x++)copy.setRGB(x,y,image.getPixelReader().getArgb(x,y));ImageIO.write(copy,"png",path.toFile());
    }
}
