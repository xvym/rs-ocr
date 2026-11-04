package io.github.rsocr.desktop.capture;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.github.rsocr.*;
import io.github.rsocr.desktop.translation.*;
import java.awt.image.BufferedImage;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicLong;
import java.util.function.Consumer;

/** Capture and OCR have separate single-thread owners and at most one OCR job in flight. */
public final class LiveSession implements AutoCloseable {
    public record View(long session,long sequence,long captureRevision,long frameId,String status,BufferedImage image,BufferedImage captured,
                       LiveMapping mapping,List<OcrEngine.Region> regions,List<LiveState.Ready> ready,String diagnostics,TranslationSession.Frame translations) {}
    private final ScheduledExecutorService captureWorker=Executors.newSingleThreadScheduledExecutor(r->{var t=new Thread(r,"rs-capture");t.setDaemon(true);return t;});
    private final ExecutorService ocrWorker=Executors.newSingleThreadExecutor(r->{var t=new Thread(r,"rs-live-ocr");t.setDaemon(true);return t;});
    private final AtomicLong selected=new AtomicLong(),sequence=new AtomicLong();
    private final OcrEngine engine;private final LiveLayout layout;private final LiveState state;private final Consumer<View> listener;
    private final TranslationSession translations;
    private volatile LiveMetrics metrics=new LiveMetrics();
    private WindowCapture capture;private WindowCapture.Window window;private LiveMapping mapping;
    private long active,revision=-1,mappingGeneration,lastFrame=-1;
    private int profile;private int[] previousPixels;private boolean busy;
    private BufferedImage normalized,captured;private WindowCapture.Poll lastPoll;
    private String status="已停止";private long lastCalibration;

    public LiveSession(ObjectMapper mapper,Consumer<View> listener) throws Exception {
        this(mapper,listener,null);
    }
    public LiveSession(ObjectMapper mapper,Consumer<View> listener,TranslationEngine translationEngine) throws Exception {
        this.listener=listener;engine=new OcrEngine(mapper);layout=new LiveLayout(mapper);state=new LiveState(layout);
        translations=translationEngine==null?null:new TranslationSession(translationEngine);
        captureWorker.scheduleWithFixedDelay(this::tick,0,16,TimeUnit.MILLISECONDS);
    }
    public long session() {return selected.get();}
    public long latestSequence() {return sequence.get();}
    public void translationSettings(String game,String manualPlayer) {if(translations!=null)captureWorker.execute(()->translations.configure(game,manualPlayer));}
    public void windows(Consumer<List<WindowCapture.Window>> result,Consumer<String> failure) {
        captureWorker.execute(()->{try{result.accept(WindowCapture.windows());}catch(RuntimeException|LinkageError e){failure.accept(e.getMessage());}});
    }
    public long start(WindowCapture.Window window,int profile) {
        long id=selected.incrementAndGet();
        captureWorker.execute(()->{
            if(id!=selected.get())return;
            release();active=id;state.newSession(id);if(translations!=null)translations.reset();this.window=window;this.profile=profile;metrics=new LiveMetrics();
            try {capture=new WindowCapture(window);status="等待窗口画面…";emit();}catch(RuntimeException|LinkageError e){fail(e);}
        });return id;
    }
    public long stop() {
        long id=selected.incrementAndGet();captureWorker.execute(()->{if(id!=selected.get())return;release();active=id;status="已停止，结果已清除";emit();});return id;
    }
    public void calibrate(View observed,Normalizer.Viewport viewport,int profile) {
        long requested=selected.get();captureWorker.execute(()->{
            if(capture==null || lastPoll==null || requested!=active || active!=selected.get() || captured==null)return;
            if(observed.session()!=active || observed.captureRevision()!=revision || observed.captured().getWidth()!=captured.getWidth() || observed.captured().getHeight()!=captured.getHeight()) {
                status="窗口尺寸已变化，请重新校准游戏区域";emit();return;
            }
            if(viewport.x()+viewport.width()>captured.getWidth() || viewport.y()+viewport.height()>captured.getHeight())return;
            double gain=profile==0&&observed.mapping()!=null?observed.mapping().gain():profile==2?.82:.984;
            invalidate();mapping=new LiveMapping(viewport,gain,captured.getWidth(),captured.getHeight(),lastPoll.dpi(),true);
            status="区域已校准，等待新帧…";lastFrame=-1;emit();
        });
    }
    private void invalidate() {mapping=null;normalized=null;previousPixels=null;lastFrame=-1;state.reset(active,++mappingGeneration);}
    private void release() {
        if(capture!=null){capture.close();capture=null;}invalidate();captured=null;lastPoll=null;revision=-1;if(translations!=null)translations.reset();
    }
    private void fail(Throwable error) {release();status="捕获已停止："+error.getMessage();emit();}
    private void tick() {
        if(capture==null || active!=selected.get())return;
        try {
            var poll=capture.poll();lastPoll=poll;
            if(poll.status()!=WindowCapture.Status.RUNNING || poll.image()==null) {
                if(normalized!=null || mapping!=null)invalidate();captured=null;status=poll.detail();
                if(poll.status()==WindowCapture.Status.CLOSED || poll.status()==WindowCapture.Status.ERROR)release();
                emit();return;
            }
            captured=poll.image();
            if(revision!=poll.revision() || mapping!=null && !mapping.matches(poll)) {invalidate();revision=poll.revision();}
            boolean fresh=lastFrame!=poll.frameId();
            if(!fresh && mapping!=null){metrics.frame(false,false);launchOcr();return;}
            if(fresh && lastFrame>=0)metrics.skippedNativeFrames(Math.max(0,poll.frameId()-lastFrame-1));
            lastFrame=poll.frameId();
            if(mapping==null) {
                long now=System.nanoTime();
                if(fresh || now-lastCalibration>200_000_000L) {mapping=LiveMapping.automatic(poll,profile,layout);lastCalibration=now;}
                if(mapping==null) {metrics.frame(fresh,false);status="请选择“校准游戏区域”，框选窗口中的游戏画面";emit();return;}
                state.reset(active,++mappingGeneration);
            }
            var nextImage=Normalizer.normalize(captured,mapping.viewport());
            int[] pixels=nextImage.getRGB(0,0,240,160,null,0,240);boolean changed=!Arrays.equals(previousPixels,pixels);metrics.frame(fresh,changed);
            if(changed) {
                normalized=nextImage;
                long first=poll.javaSampleTimeNanos()-Math.max(0,poll.sampleTimeNanos()-poll.frameArrivalNanos());
                state.observe(normalized,mapping.gain(),first);previousPixels=pixels;metrics.layout();
            }
            status="实时识别中";if(changed)emit();launchOcr();
        } catch(RuntimeException|LinkageError e) {fail(e);}
    }
    private void launchOcr() {
        if(busy || capture==null || active!=selected.get())return;var job=state.job();if(job==null)return;
        busy=true;long id=active;
        ocrWorker.execute(()->{
            try {
                var results=engine.recognize(job.image(),job.gain());
                post(()->{busy=false;if(id==active && id==selected.get() && capture!=null){state.complete(job,results);emit();launchOcr();}});
            } catch(Exception e) {post(()->{busy=false;if(id==active && id==selected.get())fail(e);});}
        });
    }
    private void post(Runnable result) {try{captureWorker.execute(result);}catch(RejectedExecutionException stopped){if(!captureWorker.isShutdown())throw stopped;}}
    private void emit() {
        var snapshot=state.snapshot();String detail=window==null?"":("窗口="+window+"\n会话="+active+" 映射代次="+mappingGeneration+"\n映射="+mapping);
        if(lastPoll!=null)detail+="\n捕获代次="+lastPoll.revision()+" 帧="+lastPoll.frameId()+" DPI="+lastPoll.dpi()+"\n原生接收="+lastPoll.frameArrivalNanos()+" 采样="+lastPoll.sampleTimeNanos();
        detail+="\n状态="+state.counts();
        var translated=translations==null?null:translations.translate(snapshot.regions());
        listener.accept(new View(active,sequence.incrementAndGet(),revision,lastPoll==null?-1:lastPoll.frameId(),status,normalized,captured,mapping,snapshot.regions(),snapshot.ready(),detail,translated));
    }
    public void displayed(View view,long now) {if(view.session()==selected.get())for(var ready:view.ready())if(state.current(ready.key()))metrics.displayed(ready,now,view.translations());}
    public Map<String,Object> report() {
        var report=new LinkedHashMap<String,Object>(metrics.report(state.counts()));
        report.put("sourceWindow",window);report.put("currentMapping",mapping);report.put("profileIndex",profile);report.put("pollIntervalMs",16);
        report.put("stabilityWaitMs",TimeUnit.NANOSECONDS.toMillis(LiveState.STABILITY_NANOS));
        report.put("stabilityPolicy","Wait until every visible text region is unchanged for 150ms before whole-frame OCR. Background animation and recognized cursor/wait-arrow pixels do not reset text stability. Timing includes stability wait; pixel stability does not prove sentence completion.");return report;
    }
    @Override public void close() {
        selected.incrementAndGet();captureWorker.execute(this::release);captureWorker.shutdown();ocrWorker.shutdownNow();
    }
}
