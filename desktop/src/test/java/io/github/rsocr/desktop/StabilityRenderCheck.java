package io.github.rsocr.desktop;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.github.rsocr.*;
import io.github.rsocr.desktop.*;
import io.github.rsocr.desktop.capture.*;
import javafx.application.Platform;
import javafx.scene.*;
import javafx.scene.image.WritableImage;
import javafx.scene.layout.StackPane;
import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicLong;

public class StabilityRenderCheck {
    static Path out=Path.of("reports/s5-live/stability");
    static ResultCanvas board;
    static StackPane root;
    static BufferedImage render(String name,List<Presentation.Panel> panels) throws Exception {
        board.show(null,panels,"实时识别中");root.applyCss();root.layout();
        WritableImage shot=root.snapshot(new SnapshotParameters(),null);
        var image=new BufferedImage((int)shot.getWidth(),(int)shot.getHeight(),BufferedImage.TYPE_INT_ARGB);
        for(int y=0;y<image.getHeight();y++)for(int x=0;x<image.getWidth();x++)image.setRGB(x,y,shot.getPixelReader().getArgb(x,y));
        ImageIO.write(image,"png",out.resolve(name+".png").toFile());return image;
    }
    static boolean same(BufferedImage a,BufferedImage b) {
        return Arrays.equals(a.getRGB(0,0,a.getWidth(),a.getHeight(),null,0,a.getWidth()),b.getRGB(0,0,b.getWidth(),b.getHeight(),null,0,b.getWidth()));
    }
    public static void main(String[] args) throws Exception {
        Files.createDirectories(out);var done=new CompletableFuture<Void>();
        Platform.startup(()->{try {
            var json=new ObjectMapper();var layout=new LiveLayout(json);var engine=new OcrEngine(json);var presentation=new Presentation(json);
            var input=ImageIO.read(Path.of("desktop/src/test/resources/battle-right-cursor.png").toFile());
            var text=layout.textImage(input,layout.locate(input));var regions=engine.recognize(text);
            var clock=new AtomicLong();var display=new LivePresentation(clock::get);
            board=new ResultCanvas(false);root=new StackPane(board);new Scene(root,960,640);root.resize(960,640);
            var first=render("cursor-visible",display.stabilize(presentation.panels(regions,input)));
            clock.set(100_000_000L);var blinking=render("cursor-blink-held",display.stabilize(presentation.panels(regions,text)));
            if(!same(first,blinking))throw new AssertionError("Cursor blink changed result pixels");
            var moved=new BufferedImage(240,160,BufferedImage.TYPE_INT_RGB);moved.setRGB(0,0,240,160,text.getRGB(0,0,240,160,null,0,240),0,240);
            var mask=json.readTree(Path.of("desktop/src/main/resources/cursors.json").toFile()).get("battle_arrow");
            for(int y=0;y<16;y++)for(int x=0;x<8;x++)if((mask.get(y).asInt()&(1<<(7-x)))!=0)moved.setRGB(8+x,136+y,0xff494151);
            clock.set(200_000_000L);render("cursor-move-pending",display.stabilize(presentation.panels(regions,moved)));
            clock.set(260_000_000L);var changed=render("cursor-moved",display.stabilize(presentation.panels(regions,moved)));
            if(same(first,changed))throw new AssertionError("Real cursor move did not reach result pixels");
            render("waiting-for-stable-text",presentation.panels(layout.locate(input),input));
            json.writerWithDefaultPrettyPrinter().writeValue(out.resolve("render-checks.json").toFile(),Map.of("passed",true,"cursorBlinkResultPixelsIdentical",true,"realMoveChangesResultPixels",true,"pendingMessageRendered",true,"size",List.of(960,640),"physicalScreenFlickerVerified",false));
            done.complete(null);
        }catch(Throwable e){done.completeExceptionally(e);}});
        try {done.get(30,TimeUnit.SECONDS);}finally{Platform.exit();}
        System.out.println("Render checks passed: blinking keeps identical result pixels; real selection movement updates them.");
    }
}

