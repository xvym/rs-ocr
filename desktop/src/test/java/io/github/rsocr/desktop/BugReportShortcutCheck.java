package io.github.rsocr.desktop;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.github.rsocr.desktop.capture.LiveSession;
import javafx.application.*;
import javafx.event.Event;
import javafx.scene.control.TextArea;
import javafx.scene.input.*;
import javafx.stage.*;
import javax.imageio.ImageIO;
import java.lang.reflect.Field;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;

/** Separate-JVM integration check of actual F1 dispatch with text-control focus. */
public final class BugReportShortcutCheck {
    private static Object get(Object target,String name) throws Exception {var f=DesktopApplication.class.getDeclaredField(name);f.setAccessible(true);return f.get(target);}
    private static void set(Object target,String name,Object value) throws Exception {var f=DesktopApplication.class.getDeclaredField(name);f.setAccessible(true);f.set(target,value);}
    private static void press(DesktopApplication app) throws Exception {
        var text=(TextArea)get(app,"diagnostics");text.requestFocus();
        Event.fireEvent(text,new KeyEvent(KeyEvent.KEY_PRESSED,"","",KeyCode.F1,false,false,false,false));
    }
    public static void main(String[] args) throws Exception {
        Path root=Files.createTempDirectory(Path.of(".tools"),"f1-shortcut-").toAbsolutePath();
        System.setProperty("rsocr.project.root",root.toString());
        var error=new AtomicReference<Throwable>();var step=new AtomicInteger();var first=new AtomicReference<Path>();
        var driver=Executors.newSingleThreadScheduledExecutor();var mapper=new ObjectMapper();
        driver.scheduleWithFixedDelay(()->{try {Platform.runLater(()->{try {
            var stage=Window.getWindows().stream().filter(w->w instanceof Stage).map(w->(Stage)w).findFirst().orElse(null);if(stage==null)return;
            DesktopApplication app=null;
            for(Field field:stage.getOnCloseRequest().getClass().getDeclaredFields())if(field.getType()==DesktopApplication.class){field.setAccessible(true);app=(DesktopApplication)field.get(stage.getOnCloseRequest());break;}
            if(app==null)throw new AssertionError("Missing application");
            if(step.get()==0) {
                if(((ImageSession)get(app,"session")).view().phase()!=ImageSession.Phase.READY)return;
                press(app);press(app);step.set(1);return;
            }
            if((boolean)get(app,"savingBugReport"))return;
            List<Path> cases;try(var files=Files.list(root.resolve("bugreport"))){cases=files.sorted().toList();}
            if(step.get()==1) {
                if(cases.size()!=1)throw new AssertionError("Repeated F1 during save produced duplicate reports");first.set(cases.getFirst());
                var input=ImageIO.read(Path.of(args[0]).toFile());var saved=ImageIO.read(first.get().resolve("original.png").toFile());
                if(input.getWidth()!=saved.getWidth()||input.getHeight()!=saved.getHeight()||!Arrays.equals(input.getRGB(0,0,input.getWidth(),input.getHeight(),null,0,input.getWidth()),saved.getRGB(0,0,saved.getWidth(),saved.getHeight(),null,0,saved.getWidth())))throw new AssertionError("Original image pixels changed");
                if(mapper.readTree(first.get().resolve("recognition.json").toFile()).path("rawRegions").isEmpty())throw new AssertionError("No OCR result saved");
                // Inject a published live frame, then test the same real UI handler without a physical device.
                var image=((ImageSession)get(app,"session")).view();
                set(app,"liveMode",true);set(app,"liveView",new LiveSession.View(42,7,3,123,"test live snapshot",image.image(),input,null,image.regions(),List.of(),"test capture diagnostics",null));
                press(app);step.set(2);return;
            }
            if(cases.size()!=2)throw new AssertionError("Second F1 did not create its own case");
            Path live=cases.stream().filter(p->!p.equals(first.get())).findFirst().orElseThrow();
            var context=mapper.readTree(live.resolve("context.json").toFile());
            if(context.path("frameId").asInt()!=123||context.path("session").asInt()!=42||!context.path("mode").asText().equals("live"))throw new AssertionError("Live frame identity lost");
            if(!Files.exists(live.resolve("original.png"))||Files.exists(live.resolve("INCOMPLETE.txt")))throw new AssertionError("Incomplete live report");
            System.out.println("F1 shortcut passed: image pixels, OCR, repeat suppression, live frame identity; "+root);
            step.set(3);stage.close();Platform.exit();
        }catch(Throwable failure){error.compareAndSet(null,failure);Platform.exit();}});}catch(IllegalStateException notStarted){}},100,100,TimeUnit.MILLISECONDS);
        driver.schedule(()->{error.compareAndSet(null,new AssertionError("F1 check timed out"));Platform.exit();},45,TimeUnit.SECONDS);
        try {Application.launch(DesktopApplication.class,"--image",Path.of(args[0]).toAbsolutePath().toString());}finally{driver.shutdownNow();}
        if(error.get()!=null)throw new AssertionError("F1 shortcut failed",error.get());if(step.get()!=3)throw new AssertionError("F1 check did not complete");
    }
}
