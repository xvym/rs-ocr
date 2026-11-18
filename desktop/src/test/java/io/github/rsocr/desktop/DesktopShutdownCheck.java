package io.github.rsocr.desktop;

import com.fasterxml.jackson.databind.*;
import javafx.application.*;
import javafx.event.Event;
import javafx.scene.Node;
import javafx.scene.Parent;
import javafx.scene.control.*;
import javafx.stage.*;
import java.nio.file.*;
import java.lang.reflect.Field;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;

/** Launch the real application in a separate JVM and exercise its actual close event. */
public final class DesktopShutdownCheck {
    private static final AtomicReference<Throwable> failure=new AtomicReference<>();
    private static final AtomicBoolean sent=new AtomicBoolean();
    private static final AtomicLong requested=new AtomicLong();
    private static final AtomicReference<String> observed=new AtomicReference<>();
    private static final ObjectMapper JSON=new ObjectMapper();
    private static List<Node> nodes(Node root) {
        var all=new ArrayList<Node>();all.add(root);
        if(root instanceof Parent parent)for(var node:parent.getChildrenUnmodifiable())all.addAll(nodes(node));
        return all;
    }
    public static void main(String[] args) throws Exception {
        String mode=args[0];Path report=Path.of(args[1]);long started=System.nanoTime();
        var driver=Executors.newSingleThreadScheduledExecutor(r->{var t=new Thread(r,"shutdown-test-driver");t.setDaemon(true);return t;});
        var liveStarted=new AtomicBoolean();
        driver.scheduleWithFixedDelay(()->{
            try {Platform.runLater(()->{try {
                if(sent.get())return;
                var stage=Window.getWindows().stream().filter(w->w instanceof Stage s&&s.getTitle().equals("RS OCR · 原汉化中文")).map(w->(Stage)w).findFirst().orElse(null);
                if(stage==null)return;
                var controls=nodes(stage.getScene().getRoot());
                if(mode.equals("live")) {
                    var source=controls.stream().filter(n->n instanceof ComboBox<?> && "捕获窗口".equals(n.getAccessibleText())).map(n->(ComboBox<?>)n).findFirst().orElseThrow();
                    int target=-1;for(int i=0;i<source.getItems().size();i++)if(source.getItems().get(i).toString().startsWith("RS OCR S5 controlled screenshot replay")){target=i;break;}
                    if(target<0)return;
                    if(liveStarted.compareAndSet(false,true)) {
                        source.getSelectionModel().select(target);
                        controls.stream().filter(n->n instanceof Button b&&b.getText().equals("开始实时")).map(n->(Button)n).findFirst().orElseThrow().fire();
                        return;
                    }
                    String status=controls.stream().filter(n->n instanceof Label l&&(l.getText().startsWith("实时识别中")||l.getText().startsWith("请选择“校准游戏区域”"))).map(n->((Label)n).getText()).findFirst().orElse(null);
                    if(status==null)return;observed.set(status);
                } else observed.set(mode.equals("image")?"image open requested":"idle");
                if(mode.equals("diagnostic-error")) {
                    // Reproduce the missing diagnostic class from the user's shutdown log.
                    var handler=stage.getOnCloseRequest();DesktopApplication application=null;
                    for(var field:handler.getClass().getDeclaredFields())if(field.getType()==DesktopApplication.class) {
                        field.setAccessible(true);application=(DesktopApplication)field.get(handler);break;
                    }
                    if(application==null)throw new AssertionError("Application close handler not found");
                    Field mapper=DesktopApplication.class.getDeclaredField("mapper");mapper.setAccessible(true);
                    mapper.set(application,new ObjectMapper(){@Override public ObjectWriter writerWithDefaultPrettyPrinter(){throw new NoClassDefFoundError("simulated missing diagnostic component");}});
                }
                requested.set(System.nanoTime());sent.set(true);
                Event.fireEvent(stage,new WindowEvent(stage,WindowEvent.WINDOW_CLOSE_REQUEST));
                if(stage.isShowing())throw new AssertionError("Close event left the window visible");
            } catch(Throwable error){failure.compareAndSet(null,error);Platform.exit();}});}
            catch(IllegalStateException toolkitNotStarted){}
        },0,50,TimeUnit.MILLISECONDS);
        // Parent tooling also imposes a timeout and owns this test process only.
        driver.schedule(()->{failure.compareAndSet(null,new AssertionError("Application did not exit within 30 seconds"));Platform.exit();},30,TimeUnit.SECONDS);
        try {
            var applicationArgs=mode.equals("image")?new String[]{"--image",args[2]}:new String[0];
            Application.launch(DesktopApplication.class,applicationArgs);
        } finally {driver.shutdownNow();}
        if(failure.get()!=null)throw new AssertionError("Shutdown check failed: "+mode,failure.get());
        if(!sent.get())throw new AssertionError("No close event sent");
        double closeMs=(System.nanoTime()-requested.get())/1_000_000.0;
        if(closeMs>3000)throw new AssertionError("Shutdown took "+closeMs+"ms");
        Files.createDirectories(report.toAbsolutePath().getParent());
        JSON.writerWithDefaultPrettyPrinter().writeValue(report.toFile(),Map.of("passed",true,"mode",mode,"statusBeforeClose",observed.get(),"closeToApplicationReturnMs",closeMs,"startupAndCheckMs",(System.nanoTime()-started)/1_000_000.0));
        System.out.println("Shutdown passed: "+mode+" in "+closeMs+" ms");
    }
}
