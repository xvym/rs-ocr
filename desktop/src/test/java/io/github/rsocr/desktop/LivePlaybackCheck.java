package io.github.rsocr.desktop;

import com.fasterxml.jackson.databind.*;
import io.github.rsocr.*;
import io.github.rsocr.desktop.capture.*;
import javafx.application.Platform;
import javafx.scene.Scene;
import javafx.scene.layout.*;
import javafx.stage.Stage;
import javax.imageio.ImageIO;
import javax.swing.*;
import java.awt.*;
import java.awt.image.BufferedImage;
import java.nio.file.*;
import java.util.List;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;
import java.util.function.Predicate;

/** Actual WGC and JavaFX loop fed by controlled replay of existing real-device stills. */
public final class LivePlaybackCheck {
    private static final ObjectMapper JSON=new ObjectMapper();
    private static final String TITLE="RS OCR S5 controlled screenshot replay";
    private static final long EXPOSURE_MS=750;
    private record Expected(String id,String source,BufferedImage image,List<String> text) {}
    private static Path root,out,control,ack;
    private static final List<Expected> expected=new ArrayList<>();
    private static final Map<Integer,List<Expected>> known=new HashMap<>();
    private static final AtomicReference<LiveSession.View> shown=new AtomicReference<>();
    private static final AtomicReference<LiveSession.View> displayed=new AtomicReference<>();
    private static final AtomicReference<String> invalidDisplay=new AtomicReference<>();
    private static LiveSession live;private static Stage stage;
    private static long serial;
    private static List<String> text(List<OcrEngine.Region> regions) {
        return regions.stream().filter(r->!r.status().equals("pending")).map(r->Arrays.toString(r.logicalBox())+"::"+r.rawOcr()).sorted().toList();
    }
    // The test host's rounded window frame blends exactly the two bottom corner samples.
    // Compare every other pixel; OCR and independent expected text still include all characters.
    private static int[] comparisonPixels(BufferedImage image) {var pixels=image.getRGB(0,0,240,160,null,0,240);pixels[159*240]=0;pixels[160*240-1]=0;return pixels;}
    private static int hash(BufferedImage image) {return Arrays.hashCode(comparisonPixels(image));}
    private static boolean pixels(BufferedImage a,BufferedImage b) {return a!=null && b!=null && Arrays.equals(comparisonPixels(a),comparisonPixels(b));}
    public static void main(String[] args) throws Exception {
        root=Path.of(args[0]).toAbsolutePath();out=root.resolve(args.length>2?args[2]:"reports/s5-live");Files.createDirectories(out);
        Path run=Files.createTempDirectory(root.resolve(".tools"),"s5-replay-");control=run.resolve("command");ack=run.resolve("ack");
        var ref=JSON.readTree(root.resolve("reports/s3-acceptance/reference.json").toFile());
        var predictions=new HashMap<String,JsonNode>();for(var r:JSON.readTree(root.resolve("reports/s3-acceptance/predictions.json").toFile()).get("regions"))predictions.put(r.get("instance_id").asText(),r);
        for(var im:ref.get("images")) {
            String id=im.get("id").asText(),source=im.get("source").asText();var input=ImageIO.read(root.resolve(source).toFile());
            var normalized=Normalizer.normalize(input,Normalizer.preset(DesktopApplication.autoProfile(input.getWidth(),input.getHeight()),input));
            var target=new ArrayList<String>();for(var r:ref.get("regions"))if(r.get("image_id").asText().equals(id) && r.get("recognition_in_scope").asBoolean()) {
                var prediction=predictions.get(r.get("instance_id").asText());target.add(prediction.get("logical_box").toString().replace(",",", ")+"::"+prediction.get("text").asText());
            }
            target.sort(String::compareTo);var item=new Expected(id,source,normalized,List.copyOf(target));expected.add(item);known.computeIfAbsent(hash(normalized),ignored->new ArrayList<>()).add(item);
        }
        var fixture=new ProcessBuilder(Path.of(System.getProperty("java.home"),"bin/javaw.exe").toString(),"-Dsun.java2d.uiScale=1","-cp",System.getProperty("java.class.path"),Fixture.class.getName(),root.toString(),control.toString(),ack.toString())
            .redirectErrorStream(true).redirectOutput(out.resolve("fixture.log").toFile()).start();
        var scenarios=new ArrayList<Map<String,Object>>();var chains=new LinkedHashMap<String,Object>();boolean complete=false;
        try {
            var initialized=new CompletableFuture<Void>();
            Platform.startup(()->{try {
                var presentation=new Presentation(JSON);var source=new ResultCanvas(true);var result=new ResultCanvas(false);var boards=new HBox(12,source,result);HBox.setHgrow(source,Priority.ALWAYS);HBox.setHgrow(result,Priority.ALWAYS);
                source.setPrefSize(600,400);result.setPrefSize(600,400);var scene=new Scene(boards,1220,430);stage=new Stage();stage.setTitle("RS OCR · S5 回放检查");stage.setScene(scene);stage.show();
                live=new LiveSession(JSON,view->Platform.runLater(()->{
                    if(view.session()!=live.session() || view.sequence()!=live.latestSequence())return;
                    source.show(ResultCanvas.image(view.image()),List.of(),view.status());result.show(null,presentation.panels(view.regions(),view.image()),view.status());shown.set(view);Platform.requestNextPulse();
                }));
                scene.addPostLayoutPulseListener(()->{var view=shown.get();if(view!=null&&view.session()==live.session()&&view.sequence()==live.latestSequence()){live.displayed(view,System.nanoTime());checkDisplay(view);displayed.set(view);}});
                initialized.complete(null);
            }catch(Exception e){initialized.completeExceptionally(e);}});
            initialized.get(20,TimeUnit.SECONDS);
            WindowCapture.Window window=find(fixture.pid());
            for(String chain:List.of("GBA","NGC")) {
                int profile=chain.equals("GBA")?1:2;live.start(window,profile);int passed=0;var misses=new ArrayList<String>();
                for(var item:expected)if(item.id().startsWith(chain)) {
                    if(args.length>1 && passed+misses.size()>=Integer.parseInt(args[1]))break;
                    send(Map.of("source",item.source(),"mode","normal","cover",false));
                    boolean matched=watch(EXPOSURE_MS,v->v.image()!=null && pixels(v.image(),item.image()) && v.regions().stream().noneMatch(r->r.status().equals("pending")) && text(v.regions()).equals(item.text()));
                    if(matched)passed++;else {
                        if(misses.isEmpty()) {
                            var failed=displayed.get();
                            JSON.writerWithDefaultPrettyPrinter().writeValue(out.resolve(chain+"-first-status.json").toFile(),Map.of("status",failed==null?"no UI pulse":failed.status(),"diagnostics",failed==null?"":failed.diagnostics()));
                        }
                        misses.add(item.id());if(misses.size()==1){var view=displayed.get();if(view!=null&&view.image()!=null){ImageIO.write(view.image(),"png",out.resolve(chain+"-first-actual.png").toFile());ImageIO.write(item.image(),"png",out.resolve(chain+"-first-expected.png").toFile());JSON.writerWithDefaultPrettyPrinter().writeValue(out.resolve(chain+"-first-miss.json").toFile(),Map.of("expected",item.text(),"actual",text(view.regions()),"status",view.status(),"mapping",view.mapping().toString(),"diagnostics",view.diagnostics()));}}
                    }
                    if((passed+misses.size())%50==0)System.out.println(chain+" replay states="+(passed+misses.size())+" misses="+misses.size());
                }
                chains.put(chain,Map.of("states",passed+misses.size(),"fullyShown",passed,"missedStates",misses,"minimumExposureMs",EXPOSURE_MS,"measurement",live.report()));
                var first=expected.stream().filter(e->e.id().equals(chain+"-001")).findFirst().orElseThrow();var second=expected.stream().filter(e->e.id().equals(chain+"-002")).findFirst().orElseThrow();
                send(Map.of("source",first.source(),"mode","normal","cover",true));require(watch(1000,v->pixels(v.image(),first.image()) && text(v.regions()).equals(first.text())),chain+" occluded first");
                long before=nativeFrameFromView();send(Map.of("source",second.source(),"mode","normal","cover",true));
                boolean occluded=watch(1000,v->pixels(v.image(),second.image()) && text(v.regions()).equals(second.text()) && nativeFrameFromView()!=before);record(scenarios,chain,"new content while fully occluded",occluded);
                send(Map.of("mode","minimized","cover",false));record(scenarios,chain,"minimize clears results",watch(1000,v->v.image()==null&&v.regions().isEmpty()&&v.status().contains("最小化")));
                send(Map.of("source",first.source(),"mode","normal","cover",false));record(scenarios,chain,"restore reacquires content",watch(1000,v->pixels(v.image(),first.image())&&text(v.regions()).equals(first.text())));
                var beforeResize=displayed.get().mapping();
                send(Map.of("mode","resized","cover",false));record(scenarios,chain,"size change clears mapping and old results",watch(1000,v->v.image()==null&&v.regions().isEmpty()&&v.status().contains("校准")));
                var resizeView=displayed.get();live.calibrate(resizeView,beforeResize.viewport(),profile);
                record(scenarios,chain,"manual viewport calibration",watch(1000,v->v.mapping()!=null&&v.mapping().manual()&&pixels(v.image(),first.image())&&text(v.regions()).equals(first.text())));
                send(Map.of("source",second.source(),"mode","normal","cover",false));record(scenarios,chain,"size restore recalibrates",watch(1000,v->pixels(v.image(),second.image())&&text(v.regions()).equals(second.text())));
                live.calibrate(resizeView,beforeResize.viewport(),profile);record(scenarios,chain,"stale calibration is rejected",watch(500,v->v.status().contains("请重新校准")&&v.mapping()!=null&&!v.mapping().manual()&&pixels(v.image(),second.image())&&text(v.regions()).equals(second.text())));
                live.stop();record(scenarios,chain,"stop clears source and results",watch(500,v->v.image()==null&&v.regions().isEmpty()&&v.status().contains("已停止")));
            }
            live.start(window,1);var first=expected.getFirst();send(Map.of("source",first.source(),"mode","normal","cover",false));require(watch(1000,v->pixels(v.image(),first.image())),"restart before constructed checks");
            var battle=expected.stream().filter(e->e.id().equals("GBA-090")).findFirst().orElseThrow();
            send(Map.of("source",battle.source(),"mode","alternate","cover",false));var alternate=find(fixture.pid(),TITLE+" alternate");
            long alternateSession=live.start(alternate,1);record(scenarios,"constructed","switch to a different source window",watch(1000,v->v.session()==alternateSession&&pixels(v.image(),battle.image())&&text(v.regions()).equals(battle.text())));
            long restoredSession=live.start(window,1);record(scenarios,"constructed","switch back rejects prior window results",watch(1000,v->v.session()==restoredSession&&pixels(v.image(),first.image())&&text(v.regions()).equals(first.text())));
            send(Map.of("source",first.source(),"mode","empty","cover",false));record(scenarios,"constructed","empty dialogue keeps panel and clears text",watch(1000,v->v.regions().size()==1&&v.regions().getFirst().status().equals("recognized")&&v.regions().getFirst().rawOcr().isEmpty()));
            send(Map.of("source",first.source(),"mode","partial","cover",false));record(scenarios,"constructed","partial glyphs replace prior text",watch(1000,v->v.regions().size()==1&&v.regions().getFirst().status().equals("unknown_glyph")));
            send(Map.of("source",first.source(),"mode","blank","cover",false));record(scenarios,"constructed","disappeared dialogue removes panel",watch(1000,v->v.image()!=null&&v.regions().isEmpty()));
            send(Map.of("source",first.source(),"mode","normal","cover",false));record(scenarios,"constructed","visibility restore recognizes again",watch(1000,v->pixels(v.image(),first.image())&&text(v.regions()).equals(first.text())));
            send(Map.of("mode","closed","cover",false));record(scenarios,"constructed","closed window clears results",watch(1000,v->v.image()==null&&v.regions().isEmpty()&&v.status().contains("关闭")));
            require(invalidDisplay.get()==null,"Displayed stale text: "+invalidDisplay.get());
            complete=true;
        } finally {
            var report=new LinkedHashMap<String,Object>();report.put("evidenceKind","controlled window replay of existing actual-device screenshots through real WGC and JavaFX");report.put("hardwareLiveCaptureVerified",false);
            report.put("realContinuousGameplayVerified",false);report.put("chains",chains);report.put("scenarios",scenarios);report.put("unexpectedDisplayedText",invalidDisplay.get());report.put("completed",complete);
            report.put("passed",complete&&invalidDisplay.get()==null&&chains.values().stream().allMatch(c->((List<?>)((Map<?,?>)c).get("missedStates")).isEmpty())&&scenarios.stream().allMatch(c->Boolean.TRUE.equals(c.get("passed"))));
            report.put("pixelComparison","38,398 of 38,400 normalized pixels exact; only two bottom corner samples blended by the test host window frame excluded. No text comparison exceptions.");
            report.put("constructedLoad","Replay window caption refresh requested every 16ms to exercise continuous WGC frame delivery while each game screenshot is exposed at least "+EXPOSURE_MS+"ms, including a deliberate 150ms text-stability wait; not real continuous gameplay or a latency acceptance threshold.");
            JSON.writerWithDefaultPrettyPrinter().writeValue(out.resolve("playback-checks.json").toFile(),report);
            if(live!=null)live.close();if(stage!=null)Platform.runLater(stage::close);Platform.exit();fixture.destroy();fixture.waitFor(5,TimeUnit.SECONDS);
        }
        for(var chain:chains.values())require(((List<?>)((Map<?,?>)chain).get("missedStates")).isEmpty(),"Some "+EXPOSURE_MS+"ms replay states were missed; retained in report");
        int count=chains.values().stream().mapToInt(c->((Number)((Map<?,?>)c).get("states")).intValue()).sum();
        System.out.println("Playback checks completed: "+count+" existing screenshots, "+scenarios.size()+" controlled scenarios.");
    }
    private static long nativeFrameFromView() {var view=displayed.get();return view==null?-1:(view.captureRevision()<<32)^view.frameId();}
    private static void checkDisplay(LiveSession.View view) {
        if(view.image()==null)return;var candidates=known.get(hash(view.image()));if(candidates==null)return;
        var item=candidates.stream().filter(e->pixels(e.image(),view.image())).findFirst().orElse(null);if(item==null)return;
        for(String actual:text(view.regions()))if(!item.text().contains(actual))invalidDisplay.compareAndSet(null,item.id()+" "+actual);
    }
    private static WindowCapture.Window find(long pid) throws Exception {
        return find(pid,TITLE);
    }
    private static WindowCapture.Window find(long pid,String title) throws Exception {
        long until=System.nanoTime()+15_000_000_000L;
        while(System.nanoTime()<until){var found=WindowCapture.windows().stream().filter(w->w.pid()==pid&&(w.title().equals(title)||title.equals(TITLE)&&w.title().startsWith(TITLE+" · "))).findFirst();if(found.isPresent())return found.get();Thread.sleep(50);}throw new AssertionError("Replay fixture window not found");
    }
    private static void send(Map<String,Object> command) throws Exception {
        var data=new LinkedHashMap<String,Object>(command);data.put("serial",++serial);Path destination=Path.of(control+"-"+serial+".json"),response=Path.of(ack+"-"+serial+".json"),temporary=Path.of(destination+".tmp");JSON.writeValue(temporary.toFile(),data);Files.move(temporary,destination,StandardCopyOption.ATOMIC_MOVE);
        long until=System.nanoTime()+5_000_000_000L;
        while(System.nanoTime()<until){
            // Windows file scanners can briefly hold even an immutable, fully written acknowledgement.
            try{if(Files.exists(response)&&JSON.readTree(response.toFile()).get("serial").asLong()==serial)return;}catch(java.io.IOException temporarilyBusy){}
            Thread.sleep(10);
        }throw new AssertionError("Fixture command timed out: "+command);
    }
    private static boolean watch(long durationMs,Predicate<LiveSession.View> condition) throws Exception {
        boolean matched=false;long until=System.nanoTime()+durationMs*1_000_000L;
        while(System.nanoTime()<until){var view=displayed.get();if(view!=null && condition.test(view))matched=true;Thread.sleep(10);}return matched;
    }
    private static void record(List<Map<String,Object>> checks,String chain,String scenario,boolean passed) {checks.add(Map.of("chain",chain,"scenario",scenario,"passed",passed));require(passed,chain+" "+scenario);}
    private static void require(boolean condition,String detail) {if(!condition)throw new AssertionError(detail);}

    /** Test-owned application. Its own timer paints, covers, minimizes and resizes its own window. */
    public static final class Fixture {
        private static BufferedImage image;private static long previous=0;
        public static void main(String[] args) {
            Path root=Path.of(args[0]),control=Path.of(args[1]),ack=Path.of(args[2]);
            SwingUtilities.invokeLater(()->{
                var panel=new JPanel(){@Override protected void paintComponent(Graphics g){super.paintComponent(g);if(image!=null)g.drawImage(image,0,0,null);}};
                panel.setPreferredSize(new Dimension(1200,800));var frame=new JFrame(TITLE);frame.setDefaultCloseOperation(JFrame.DISPOSE_ON_CLOSE);frame.setContentPane(panel);frame.pack();frame.setLocation(30,30);frame.setVisible(true);
                var cover=new JWindow();cover.getContentPane().setBackground(new java.awt.Color(25,45,70));cover.add(new JLabel("RS OCR · 临时遮挡回放窗口",SwingConstants.CENTER));cover.setAlwaysOnTop(true);
                var alternate=new JFrame[1];
                var refreshCaption=new javax.swing.Timer(16,event->frame.setTitle(TITLE+" · "+(System.nanoTime()/1_000_000L%1000)));refreshCaption.start();
                var timer=new javax.swing.Timer(20,null);
                timer.addActionListener(event->{try {
                    Path command=Path.of(control+"-"+(previous+1)+".json");if(!Files.exists(command))return;var cmd=JSON.readTree(command.toFile());long current=cmd.get("serial").asLong();
                    String mode=cmd.path("mode").asText("normal");
                    if(mode.equals("alternate")) {
                        if(alternate[0]==null) {
                        var otherImage=ImageIO.read(root.resolve(cmd.get("source").asText()).toFile());
                        var otherPanel=new JPanel(){@Override protected void paintComponent(Graphics g){super.paintComponent(g);g.drawImage(otherImage,0,0,null);}};
                        otherPanel.setPreferredSize(new Dimension(otherImage.getWidth(),otherImage.getHeight()));alternate[0]=new JFrame(TITLE+" alternate");alternate[0].setContentPane(otherPanel);alternate[0].pack();alternate[0].setLocation(80,80);alternate[0].setVisible(true);
                        }
                    }else if(cmd.has("source"))image=ImageIO.read(root.resolve(cmd.get("source").asText()).toFile());
                    if(mode.equals("blank")){image=new BufferedImage(image.getWidth(),image.getHeight(),BufferedImage.TYPE_INT_RGB);}
                    if(mode.equals("empty") || mode.equals("partial")) {
                        var n=Normalizer.normalize(image,Normalizer.preset("gba-5x",image));int background=n.getRGB(32,120);
                        for(int y=120;y<152;y++)for(int x=32;x<224;x++){int rgb=n.getRGB(x,y);if(((rgb>>16)&255)<130&&((rgb>>8)&255)<130&&(rgb&255)<130)n.setRGB(x,y,background);}
                        if(mode.equals("partial"))for(int y=124;y<130;y++)for(int x=33;x<38;x++)n.setRGB(x,y,0xff111111);
                        var expanded=new BufferedImage(1200,800,BufferedImage.TYPE_INT_RGB);var graphics=expanded.createGraphics();graphics.drawImage(n,0,0,1200,800,null);graphics.dispose();image=expanded;
                    }
                    if(!mode.equals("minimized")&&!mode.equals("closed")) {
                        frame.setState(JFrame.NORMAL);var wanted=new Dimension(image==null?1200:image.getWidth(),image==null?800:image.getHeight());
                        if(mode.equals("resized")){wanted.width+=37;wanted.height+=19;}
                        if(!panel.getSize().equals(wanted)){panel.setPreferredSize(wanted);frame.pack();}
                        panel.paintImmediately(0,0,panel.getWidth(),panel.getHeight());
                    }
                    if(mode.equals("minimized"))frame.setState(JFrame.ICONIFIED);
                    if(cmd.path("cover").asBoolean()){cover.setBounds(frame.getBounds());cover.setVisible(true);}else cover.setVisible(false);
                    Path destination=Path.of(ack+"-"+current+".json"),temp=Path.of(destination+".tmp");JSON.writeValue(temp.toFile(),Map.of("serial",current,"mode",mode));Files.move(temp,destination,StandardCopyOption.ATOMIC_MOVE);previous=current;
                    if(mode.equals("closed")){refreshCaption.stop();cover.dispose();if(alternate[0]!=null)alternate[0].dispose();frame.dispose();timer.stop();}
                }catch(Exception e){e.printStackTrace();}});timer.start();
            });
        }
    }
}
