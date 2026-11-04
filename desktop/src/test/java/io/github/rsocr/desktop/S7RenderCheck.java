package io.github.rsocr.desktop;

import com.fasterxml.jackson.databind.*;
import io.github.rsocr.*;
import io.github.rsocr.desktop.translation.*;
import io.github.rsocr.desktop.capture.LiveLayout;
import javafx.application.Platform;
import javafx.scene.*;
import javafx.scene.layout.*;
import javafx.scene.control.Label;
import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.*;

/** Draw every current screenshot through production Java OCR, translation and canvas. */
public final class S7RenderCheck {
    private static final ObjectMapper JSON=new ObjectMapper();
    public static void main(String[] args) throws Exception {
        Path root=Path.of(args[0]).toAbsolutePath(),out=root.resolve("reports/s7-integration");Files.createDirectories(out);
        var reference=JSON.readTree(root.resolve("reports/s3-acceptance/reference.json").toFile());var engine=new OcrEngine(JSON);var translation=new TranslationEngine(JSON);var session=new TranslationSession(translation);var presentation=new Presentation(JSON);var painter=new TranslationPresentation();var layout=new LiveLayout(JSON);
        var all=new LinkedHashMap<String,List<Presentation.Panel>>();var images=new HashMap<String,BufferedImage>();var samples=Set.of("GBA-001","GBA-019","GBA-027","GBA-090","GBA-129","GBA-304","GBA-305","NGC-029","NGC-053","NGC-124");
        int panels=0,translated=0,blocks=0;var trace=new ArrayList<Map<String,Object>>();
        for(var im:reference.path("images")) {
            var input=ImageIO.read(root.resolve(im.path("source").asText()).toFile());String profile=DesktopApplication.autoProfile(input.getWidth(),input.getHeight());double gain=profile.equals("ngc-capture")?.82:.984;
            var normalized=Normalizer.normalize(input,Normalizer.preset(profile,input));var regions=engine.recognize(layout.textImage(normalized,layout.locate(normalized,gain)),gain);var frame=session.translate(regions);var raw=presentation.panels(regions,normalized);var shown=painter.apply(raw,frame);
            int expected=frame.regions().stream().flatMap(r->r.units().stream()).mapToInt(r->r.translated()?1:0).sum(),actual=shown.stream().mapToInt(p->p.translations().size()).sum();
            if(expected!=actual){JSON.writeValue(root.resolve(".tools/s7-first-render-failure.json").toFile(),Map.of("frame",frame,"raw",raw,"shown",shown));throw new AssertionError(im.path("id")+" lost translated text allocations: "+actual+"/"+expected);}
            for(int i=0;i<shown.size();i++)if(!raw.get(i).raw().equals(shown.get(i).raw())||!raw.get(i).clip().equals(shown.get(i).clip())||!Objects.equals(raw.get(i).frame(),shown.get(i).frame())||!raw.get(i).pointers().equals(shown.get(i).pointers())||!raw.get(i).selections().equals(shown.get(i).selections()))throw new AssertionError("Changed native layout or raw OCR");
            String id=im.path("id").asText();all.put(id,shown);if(samples.contains(id))images.put(id,normalized);translated+=expected;blocks+=actual;panels+=shown.size();trace.add(Map.of("image",id,"regions",shown.size(),"translatedUnits",expected));
        }
        var complete=new CompletableFuture<Void>();var smallest=new double[]{12};
        Platform.startup(()->{try{
            for(var entry:all.entrySet()) {
                for(var p:entry.getValue())for(var b:p.translations()) {
                    var text=ResultCanvas.textLayout(b.text(),b.box().width(),b.box().height());smallest[0]=Math.min(smallest[0],text.fontSize());
                    if(!String.join("",text.lines()).equals(b.text().replace("\n","")))throw new AssertionError("Lost Chinese characters in wrapping");
                }
                var canvas=new ResultCanvas(false);canvas.show(null,entry.getValue(),"");var pane=new StackPane(canvas);new Scene(pane,960,640);pane.resize(960,640);pane.applyCss();pane.layout();pane.snapshot(null,null);
                if(samples.contains(entry.getKey()))save(out.resolve(entry.getKey()+".png"),entry.getValue(),images.get(entry.getKey()));
            }
            complete.complete(null);
        }catch(Throwable error){complete.completeExceptionally(error);}});
        try{complete.get(60,TimeUnit.SECONDS);}finally{Platform.exit();}
        JSON.writerWithDefaultPrettyPrinter().writeValue(out.resolve("render-checks.json").toFile(),Map.of("passed",true,"images",all.size(),"panels",panels,"translatedUnits",translated,"renderedBlocks",blocks,"minimumLogicalFontSize",smallest[0],"rawAndNativeLayoutPreserved",true,"allCharactersFit",true,"evidenceKind","all existing static screenshots rendered with JavaFX; no hardware gameplay acceptance","frames",trace));
        System.out.println("S7 rendering passed: "+all.size()+" images, "+panels+" regions, "+blocks+" original Chinese/format blocks.");
    }
    private static void save(Path path,List<Presentation.Panel> panels,BufferedImage source) throws Exception {
        var left=new ResultCanvas(true);left.show(ResultCanvas.image(source),List.of(),"");left.setPrefSize(720,480);var right=new ResultCanvas(false);right.show(null,panels,"");right.setPrefSize(720,480);
        var pane=new HBox(16,new VBox(8,new Label("实机画面"),left),new VBox(8,new Label("原汉化中文"),right));pane.setStyle("-fx-padding:16;-fx-background-color:#f4f7fc;-fx-font-family:'Microsoft YaHei';");new Scene(pane,1488,540);pane.resize(1488,540);pane.applyCss();pane.layout();var image=pane.snapshot(null,null);var copy=new BufferedImage((int)image.getWidth(),(int)image.getHeight(),BufferedImage.TYPE_INT_ARGB);
        int[] pixels=new int[copy.getWidth()*copy.getHeight()];image.getPixelReader().getPixels(0,0,copy.getWidth(),copy.getHeight(),javafx.scene.image.PixelFormat.getIntArgbInstance(),pixels,0,copy.getWidth());copy.setRGB(0,0,copy.getWidth(),copy.getHeight(),pixels,0,copy.getWidth());ImageIO.write(copy,"png",path.toFile());
    }
}
