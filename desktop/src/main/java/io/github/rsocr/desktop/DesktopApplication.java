package io.github.rsocr.desktop;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.github.rsocr.Normalizer;
import io.github.rsocr.OcrEngine;
import io.github.rsocr.desktop.capture.*;
import io.github.rsocr.desktop.translation.*;
import javafx.application.*;
import javafx.animation.PauseTransition;
import javafx.util.Duration;
import javafx.geometry.Insets;
import javafx.scene.Scene;
import javafx.scene.control.*;
import javafx.scene.input.*;
import javafx.scene.layout.*;
import javafx.stage.*;
import javax.imageio.ImageIO;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.*;

public final class DesktopApplication extends Application {
    private final ImageSession session=new ImageSession();
    private final ObjectMapper mapper=new ObjectMapper();
    private final ExecutorService worker=Executors.newSingleThreadExecutor(r->{var t=new Thread(r,"rs-ocr-images");t.setDaemon(true);return t;});
    private OcrEngine engine;
    private Presentation presentation;
    private TranslationEngine translationEngine;
    private TranslationSession.Frame imageTranslations;
    private final TranslationPresentation translationPresentation=new TranslationPresentation();
    private final ComboBox<String> game=new ComboBox<>();
    private final TextField playerName=new TextField();
    private String manualPlayer="";
    private final LivePresentation livePresentation=new LivePresentation();
    private final PauseTransition selectionRefresh=new PauseTransition(Duration.millis(60));
    private List<Presentation.Panel> livePanels=List.of();
    private LiveLayout imageLayout;
    private LiveSession live;
    private LiveSession.View liveView,pulseView;
    private boolean liveMode;
    private final ComboBox<WindowCapture.Window> sources=new ComboBox<>();
    private final Button calibrate=new Button("校准游戏区域"),measure=new Button("保存测量");
    private Future<?> pending;
    private final ResultCanvas original=new ResultCanvas(true),result=new ResultCanvas(false);
    private final Label status=new Label(),file=new Label("尚未打开图片");
    private final TextArea diagnostics=new TextArea();
    private final ComboBox<String> profile=new ComboBox<>();
    private final Button previous=new Button("上一张"),next=new Button("下一张"),recognize=new Button("重新识别"),stop=new Button("停止");
    private final CheckBox preview=new CheckBox("显示原图"),debug=new CheckBox("诊断");
    private List<Path> files=List.of();private int index=-1;
    private VBox sourcePane;
    private Path lastDirectory;

    @Override public void init() throws Exception { engine=new OcrEngine(mapper);presentation=new Presentation(mapper);translationEngine=new TranslationEngine(mapper);imageLayout=new LiveLayout(mapper);live=new LiveSession(mapper,this::acceptLive,translationEngine); }
    @Override public void start(Stage stage) {
        selectionRefresh.setOnFinished(e->{if(liveMode && liveView!=null)showLiveResult(liveView);});
        var open=new Button("打开图片");open.setDefaultButton(false);open.setOnAction(e->openImage(stage));
        var folder=new Button("打开目录");folder.setOnAction(e->openFolder(stage));
        previous.setOnAction(e->navigate(-1));next.setOnAction(e->navigate(1));recognize.setOnAction(e->loadCurrent());stop.setOnAction(e->clear());
        profile.getItems().setAll("自动","NDS 采集","NGC／OBS 采集","原生 240 × 160");profile.getSelectionModel().select(0);
        profile.setAccessibleText("图像配置");profile.setOnAction(e->{if(liveMode)startLive();else if(index>=0)loadCurrent();});
        preview.setSelected(true);preview.setOnAction(e->{sourcePane.setVisible(preview.isSelected());sourcePane.setManaged(preview.isSelected());});
        var toolbar=new HBox(9,open,folder,new Separator(),new Label("图像配置"),profile,new Separator(),previous,next,recognize,stop);
        toolbar.setPadding(new Insets(15));toolbar.getStyleClass().add("toolbar");
        var refreshSources=new Button("刷新窗口");refreshSources.setOnAction(e->refreshSources());
        sources.setPromptText("选择 NDS 投屏或 OBS 窗口");sources.setAccessibleText("捕获窗口");sources.setMinWidth(180);sources.setPrefWidth(350);sources.setMaxWidth(Double.MAX_VALUE);
        sources.setOnAction(e->{if(liveMode && sources.getValue()!=null)startLive();});
        var begin=new Button("开始实时");begin.setOnAction(e->startLive());calibrate.setDisable(true);calibrate.setOnAction(e->calibrate(stage));measure.setOnAction(e->saveMeasurement(stage));
        var captureBar=new HBox(9,new Label("捕获窗口"),sources,refreshSources,begin,calibrate,measure);HBox.setHgrow(sources,Priority.ALWAYS);captureBar.setPadding(new Insets(0,15,12,15));
        game.getItems().setAll("未指定","红宝石","蓝宝石");game.getSelectionModel().select(0);game.setAccessibleText("游戏版本");
        game.setOnAction(e->{if(liveMode)startLive();else if(index>=0)loadCurrent();});
        playerName.setPromptText("日文名字，可留空");playerName.setPrefColumnCount(8);playerName.setAccessibleText("当前玩家名");
        var applyName=new Button("应用名字");applyName.setOnAction(e->{try{var check=new TranslationSession(translationEngine);check.configure(selectedGame(),playerName.getText());manualPlayer=playerName.getText().strip();if(liveMode)startLive();else if(index>=0)loadCurrent();else status.setText(manualPlayer.isEmpty()?"已清除手动玩家名":"已设置当前玩家名");}catch(IllegalArgumentException error){status.setText(error.getMessage());}});
        var translationBar=new HBox(9,new Label("游戏"),game,new Separator(),new Label("玩家名"),playerName,applyName);translationBar.setPadding(new Insets(0,15,12,15));
        file.getStyleClass().add("filename");file.setMaxWidth(Double.MAX_VALUE);HBox.setHgrow(file,Priority.ALWAYS);
        var meta=new HBox(12,file,preview,debug);meta.setPadding(new Insets(10,17,10,17));
        sourcePane=board("实机画面",original);var resultPane=board("原汉化中文",result);
        var boards=new HBox(14,sourcePane,resultPane);boards.setPadding(new Insets(0,17,12,17));HBox.setHgrow(sourcePane,Priority.ALWAYS);HBox.setHgrow(resultPane,Priority.ALWAYS);
        sourcePane.prefWidthProperty().bind(boards.widthProperty().subtract(48).divide(2));resultPane.prefWidthProperty().bind(boards.widthProperty().subtract(48).divide(2));
        sourcePane.setMinWidth(0);resultPane.setMinWidth(0);
        diagnostics.setEditable(false);diagnostics.setWrapText(false);diagnostics.setPrefRowCount(8);diagnostics.setVisible(false);diagnostics.setManaged(false);diagnostics.setAccessibleText("识别诊断");
        debug.setOnAction(e->{diagnostics.setVisible(debug.isSelected());diagnostics.setManaged(debug.isSelected());if(liveMode&&liveView!=null)showLiveDiagnostics(liveView);});
        status.setPadding(new Insets(9,17,12,17));status.setMaxWidth(Double.MAX_VALUE);status.getStyleClass().add("status");
        var root=new VBox(toolbar,captureBar,translationBar,meta,boards,diagnostics,status);VBox.setVgrow(boards,Priority.ALWAYS);
        var scene=new Scene(root,1250,760);scene.getStylesheets().add(Objects.requireNonNull(getClass().getResource("/desktop.css")).toExternalForm());
        scene.getAccelerators().put(new KeyCodeCombination(KeyCode.O,KeyCombination.CONTROL_DOWN),()->openImage(stage));
        scene.getAccelerators().put(new KeyCodeCombination(KeyCode.RIGHT,KeyCombination.ALT_DOWN),()->navigate(1));
        scene.getAccelerators().put(new KeyCodeCombination(KeyCode.LEFT,KeyCombination.ALT_DOWN),()->navigate(-1));
        scene.getAccelerators().put(new KeyCodeCombination(KeyCode.F5),()->{if(liveMode)startLive();else loadCurrent();});
        scene.addPostLayoutPulseListener(()->{if(pulseView!=null && liveMode){live.displayed(pulseView,System.nanoTime());pulseView=null;}});
        stage.setTitle("RS OCR · 原汉化中文");stage.setMinWidth(990);stage.setMinHeight(650);stage.setScene(scene);stage.setOnCloseRequest(e->clear());stage.show();refresh();
        refreshSources();
        try {
            var options=options(getParameters().getRaw());
            String setting=options.getOrDefault("--profile","auto");
            profile.getSelectionModel().select(switch(setting){case "auto"->0;case "gba-5x"->1;case "ngc-capture"->2;case "native"->3;default->throw new IllegalArgumentException("未知图像配置："+setting);});
            if(options.containsKey("--image"))selectImage(Path.of(options.get("--image")));
            else if(options.containsKey("--directory"))selectFolder(Path.of(options.get("--directory")));
        } catch(Exception e) {showError(e);}
    }
    private static Map<String,String> options(List<String> args) {
        var values=new HashMap<String,String>();
        for(int i=0;i<args.size();i++) {
            String key=args.get(i);if(!Set.of("--image","--directory","--profile").contains(key)||i+1==args.size())throw new IllegalArgumentException("未知或不完整参数："+key);
            if(values.put(key,args.get(++i))!=null)throw new IllegalArgumentException("参数重复："+key);
        }
        if(values.containsKey("--image")&&values.containsKey("--directory"))throw new IllegalArgumentException("请只指定图片或目录中的一个。");return values;
    }
    private VBox board(String title,ResultCanvas canvas) {var heading=new Label(title);heading.getStyleClass().add("board-title");var pane=new VBox(7,heading,canvas);VBox.setVgrow(canvas,Priority.ALWAYS);return pane;}
    private void openImage(Stage stage) {
        var chooser=new FileChooser();chooser.setTitle("打开实机截图");chooser.getExtensionFilters().add(new FileChooser.ExtensionFilter("PNG 图片","*.png","*.PNG"));
        if(lastDirectory!=null && Files.isDirectory(lastDirectory))chooser.setInitialDirectory(lastDirectory.toFile());
        var selected=chooser.showOpenDialog(stage);if(selected!=null)try{selectImage(selected.toPath());}catch(Exception e){showError(e);}
    }
    private void openFolder(Stage stage) {
        var chooser=new DirectoryChooser();chooser.setTitle("打开截图目录");if(lastDirectory!=null && Files.isDirectory(lastDirectory))chooser.setInitialDirectory(lastDirectory.toFile());
        var selected=chooser.showDialog(stage);if(selected!=null)try{selectFolder(selected.toPath());}catch(Exception e){showError(e);}
    }
    private List<Path> inventory(Path directory) throws Exception {
        try(var stream=Files.list(directory)) {return stream.filter(Files::isRegularFile).filter(p->p.getFileName().toString().toLowerCase(Locale.ROOT).endsWith(".png")).map(p->p.toAbsolutePath().normalize()).sorted().toList();}
    }
    private void selectImage(Path path) throws Exception {
        var selected=path.toAbsolutePath().normalize();if(!Files.isRegularFile(selected))throw new IllegalArgumentException("图片不存在："+selected);
        lastDirectory=selected.getParent();files=inventory(lastDirectory);index=files.indexOf(selected);if(index<0){files=List.of(selected);index=0;}loadCurrent();
    }
    private void selectFolder(Path path) throws Exception {
        var entries=inventory(path.toAbsolutePath().normalize());if(entries.isEmpty())throw new IllegalArgumentException("目录中没有 PNG 图片。");
        files=entries;index=0;lastDirectory=path.toAbsolutePath().normalize();loadCurrent();
    }
    private void navigate(int delta) {if(index+delta>=0 && index+delta<files.size()){index+=delta;loadCurrent();}}
    private String selectedGame() {return switch(game.getSelectionModel().getSelectedIndex()){case 1->"ruby";case 2->"sapphire";default->"both";};}
    private void clear() {if(pending!=null)pending.cancel(true);liveMode=false;live.stop();liveView=null;pulseView=null;imageTranslations=null;selectionRefresh.stop();livePresentation.reset();calibrate.setDisable(true);session.stop();refresh();}
    private void showError(Exception e) {liveMode=false;live.stop();imageTranslations=null;liveView=null;pulseView=null;selectionRefresh.stop();calibrate.setDisable(true);long generation=session.begin(index>=0?files.get(index):null);session.fail(generation,"无法识别："+e.getMessage());refresh();}
    private void loadCurrent() {
        if(index<0)return;if(liveMode){liveMode=false;live.stop();liveView=null;pulseView=null;calibrate.setDisable(true);}if(pending!=null)pending.cancel(true);
        imageTranslations=null;Path path=files.get(index);int selectedProfile=profile.getSelectionModel().getSelectedIndex();long generation=session.begin(path);refresh();
        var translator=new TranslationSession(translationEngine);translator.configure(selectedGame(),manualPlayer);
        pending=worker.submit(()->{
            try {
                long started=System.nanoTime();var input=ImageIO.read(path.toFile());if(input==null)throw new IllegalArgumentException("无法读取这张图片。");
                String preset=switch(selectedProfile){case 1->"gba-5x";case 2->"ngc-capture";case 3->"native";default->autoProfile(input.getWidth(),input.getHeight());};
                var image=Normalizer.normalize(input,Normalizer.preset(preset,input));
                Platform.runLater(()->{if(session.imageReady(generation,image))refresh();});
                double gain=preset.equals("ngc-capture")?.82:.984;
                var regions=engine.recognize(imageLayout.textImage(image,imageLayout.locate(image,gain)),gain);
                var translated=translator.translate(regions);
                double elapsed=(System.nanoTime()-started)/1_000_000.0;
                Platform.runLater(()->{if(session.complete(generation,regions,elapsed)){imageTranslations=translated;refresh();}});
            } catch(Exception e) {Platform.runLater(()->{if(session.fail(generation,"无法识别："+e.getMessage()))refresh();});}
        });
    }
    public static String autoProfile(int width,int height) {
        if(width==1200&&height==800)return "gba-5x";if(width==1600&&height==1200)return "ngc-capture";if(width==240&&height==160)return "native";
        throw new IllegalArgumentException("图片尺寸未适配，请使用 1200×800、1600×1200 或 240×160 的截图。");
    }
    private void refresh() {
        var view=session.view();var panels=translationPresentation.apply(presentation.panels(view.regions(),view.image()),imageTranslations);var image=ResultCanvas.image(view.image());
        original.show(image,List.of(),view.message());result.show(null,panels,view.message());
        file.setText(index<0?"尚未打开图片":String.format("%d / %d   %s",index+1,files.size(),files.get(index).getFileName()));
        previous.setDisable(index<=0);next.setDisable(index<0||index+1>=files.size());recognize.setDisable(index<0);stop.setDisable(view.phase()==ImageSession.Phase.IDLE||view.phase()==ImageSession.Phase.STOPPED);
        status.setText(view.message()+(view.phase()==ImageSession.Phase.READY?String.format(" · %d 个区域 · 离线处理 %.0f ms",panels.size(),view.elapsedMs()):""));
        try {diagnostics.setText(mapper.writerWithDefaultPrettyPrinter().writeValueAsString(Map.of("state",view.phase(),"generation",view.generation(),"rawRegions",view.regions(),"displayPanels",panels,"translation",imageTranslations==null?"":imageTranslations)));}catch(Exception e){diagnostics.setText(e.toString());}
    }
    private void refreshSources() {
        var selected=sources.getValue();
        live.windows(windows->Platform.runLater(()->{boolean wasLive=liveMode;liveMode=false;sources.getItems().setAll(windows);if(selected!=null)windows.stream().filter(w->w.hwnd()==selected.hwnd()&&w.pid()==selected.pid()).findFirst().ifPresent(sources::setValue);liveMode=wasLive;}),
            message->Platform.runLater(()->status.setText("窗口列表不可用："+message)));
    }
    private void startLive() {
        var selected=sources.getValue();if(selected==null){status.setText("请先选择投屏或 OBS 窗口");return;}
        if(pending!=null)pending.cancel(true);session.stop();liveMode=true;liveView=null;pulseView=null;
        original.show(null,List.of(),"等待窗口画面…");result.show(null,List.of(),"等待窗口画面…");file.setText("实时 · "+selected.title());
        previous.setDisable(true);next.setDisable(true);recognize.setDisable(true);stop.setDisable(false);calibrate.setDisable(true);status.setText("正在连接窗口…");
        live.translationSettings(selectedGame(),manualPlayer);live.start(selected,profile.getSelectionModel().getSelectedIndex());
    }
    private void acceptLive(LiveSession.View view) {
        Platform.runLater(()->{
            if(!liveMode || view.session()!=live.session() || view.sequence()!=live.latestSequence())return;
            if(liveView==null || liveView.session()!=view.session() || liveView.captureRevision()!=view.captureRevision() || liveView.mapping()!=view.mapping())livePresentation.reset();
            boolean imageChanged=liveView==null || liveView.image()!=view.image();
            liveView=view;livePanels=translationPresentation.apply(presentation.panels(view.regions(),view.image()),view.translations());
            if(imageChanged || view.image()==null)original.show(ResultCanvas.image(view.image()),List.of(),view.status());
            showLiveResult(view);
            calibrate.setDisable(view.captured()==null);status.setText(view.status()+" · "+livePanels.size()+" 个区域");
            if(debug.isSelected())showLiveDiagnostics(view);
            pulseView=view;Platform.requestNextPulse();
        });
    }
    private void showLiveResult(LiveSession.View view) {
        result.show(null,livePresentation.stabilize(livePanels),view.status());
        if(livePresentation.needsRefresh())selectionRefresh.playFromStart();else selectionRefresh.stop();
    }
    private void showLiveDiagnostics(LiveSession.View view) {try{diagnostics.setText(view.diagnostics()+"\n\n"+mapper.writerWithDefaultPrettyPrinter().writeValueAsString(Map.of("rawRegions",view.regions(),"translation",view.translations()==null?"":view.translations())));}catch(Exception error){diagnostics.setText(error.toString());}}
    private void calibrate(Stage stage) {
        var view=liveView;if(!liveMode || view==null || view.captured()==null){status.setText("请先开始实时捕获，等待窗口画面");return;}
        long sessionId=view.session();
        new CalibrationDialog(stage,view.captured(),view.mapping()==null?null:view.mapping().viewport()).showAndWait().ifPresent(v->{if(liveMode&&live.session()==sessionId)live.calibrate(view,v,profile.getSelectionModel().getSelectedIndex());});
    }
    private void saveMeasurement(Stage stage) {
        var chooser=new FileChooser();chooser.setTitle("保存实时识别测量");chooser.setInitialFileName("rs-ocr-live-measurement.json");var file=chooser.showSaveDialog(stage);if(file==null)return;
        try {mapper.writerWithDefaultPrettyPrinter().writeValue(file,live.report());}catch(Exception e){status.setText("保存失败："+e.getMessage());}
    }
    @Override public void stop() {live.close();worker.shutdownNow();}
}
