package io.github.rsocr.desktop.capture;

import java.util.*;

/** The UI acknowledges painted pulses; placeholders never count as recognized text. */
public final class LiveMetrics {
    private final Set<LiveState.Key> shown=new HashSet<>();
    private final List<Double> latency=new ArrayList<>();
    private final List<Map<String,Object>> events=new ArrayList<>();
    private long polls,newFrames,repeatedFrames,contentFrames,layoutUpdates,skippedNativeFrames,unknownDisplays;
    public synchronized void skippedNativeFrames(long count) {skippedNativeFrames+=count;}
    public synchronized void frame(boolean fresh,boolean changed) {polls++;if(fresh)newFrames++;else repeatedFrames++;if(changed)contentFrames++;}
    public synchronized void layout() {layoutUpdates++;}
    public synchronized void displayed(LiveState.Ready ready,long now) {
        if(!shown.add(ready.key()))return;
        double elapsed=(now-ready.firstObservedNanos())/1_000_000.0;
        if(ready.region().status().equals("recognized") && !ready.region().rawOcr().isEmpty())latency.add(elapsed);
        if(ready.region().status().equals("unknown_glyph"))unknownDisplays++;
        events.add(Map.of("region",ready.key().region(),"generation",ready.key().generation(),"rawJapanese",ready.region().rawOcr(),"status",ready.region().status(),"displayLatencyMs",elapsed,
            "receiveToSubmissionMs",(ready.submittedNanos()-ready.firstObservedNanos())/1_000_000.0,
            "ocrThroughAcceptanceMs",(ready.recognizedNanos()-ready.submittedNanos())/1_000_000.0,
            "acceptanceToUiPulseMs",(now-ready.recognizedNanos())/1_000_000.0,"session",ready.key().session(),"mappingGeneration",ready.key().mapping()));
    }
    public synchronized Map<String,Object> report(Map<String,Long> counts) {
        var sorted=latency.stream().sorted().toList();var result=new LinkedHashMap<String,Object>();
        result.put("endpoint","raw Japanese canvas after JavaFX post-layout pulse; not Chinese latency acceptance");
        result.put("timingScope","native callback arrival of the first processed frame for a region state; superseded native frames are counted separately");
        result.put("polls",polls);result.put("newNativeFrames",newFrames);result.put("repeatedNativeFramePolls",repeatedFrames);result.put("changedNormalizedFrames",contentFrames);result.put("layoutUpdates",layoutUpdates);
        result.put("nativeFramesNotSampled",skippedNativeFrames);
        result.put("unknownGlyphDisplays",unknownDisplays);
        result.put("textSamples",sorted.size());result.put("p50Ms",percentile(sorted,.5));result.put("p95Ms",percentile(sorted,.95));result.put("maxMs",sorted.isEmpty()?null:sorted.getLast());
        result.put("over200Ms",sorted.stream().filter(v->v>200).count());result.put("contentGenerationsNotShown",counts.getOrDefault("contentGenerations",0L)-shown.size());
        result.putAll(counts);result.put("events",List.copyOf(events));return result;
    }
    private static Double percentile(List<Double> values,double p) {return values.isEmpty()?null:values.get(Math.max(0,(int)Math.ceil(values.size()*p)-1));}
}
