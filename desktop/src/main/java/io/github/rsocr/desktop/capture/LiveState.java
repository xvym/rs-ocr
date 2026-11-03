package io.github.rsocr.desktop.capture;

import io.github.rsocr.OcrEngine.Region;
import java.awt.image.BufferedImage;
import java.util.*;
import java.util.function.LongSupplier;

/** Per-region generations: animation elsewhere cannot keep valid text from being published. */
public final class LiveState {
    public static final long STABILITY_NANOS=150_000_000L;
    public record Key(long session,long mapping,String region,long generation) {}
    public record Job(BufferedImage image,double gain,Map<String,Key> keys,long submittedNanos) {}
    public record Ready(Key key,long firstObservedNanos,long submittedNanos,long recognizedNanos,Region region) {}
    public record Snapshot(List<Region> regions,List<Ready> ready,int pending) {}
    private static final class Entry {
        final Key key;final byte[] pixels;final long first,stableSince;final Region geometry;
        Region result;long submitted,recognized;
        Entry(Key key,byte[] pixels,long first,long stableSince,Region geometry) {this.key=key;this.pixels=pixels;this.first=first;this.stableSince=stableSince;this.geometry=geometry;}
    }
    private final LiveLayout layout;
    private final LongSupplier clock;
    private final LinkedHashMap<String,Entry> entries=new LinkedHashMap<>();
    private long session,mapping,generation;
    private BufferedImage image;private double gain;
    private long changed,discarded,missed;
    public LiveState(LiveLayout layout) {this(layout,System::nanoTime);}
    public LiveState(LiveLayout layout,LongSupplier clock) {this.layout=layout;this.clock=clock;}
    public synchronized void newSession(long session) {entries.clear();image=null;this.session=session;mapping=0;generation=0;changed=0;discarded=0;missed=0;}
    public static String id(Region region) {return String.join("|",region.typeCandidates());}
    public synchronized void reset(long session,long mapping) {
        missed+=entries.values().stream().filter(e->e.result==null).count();
        entries.clear();image=null;this.session=session;this.mapping=mapping;
    }
    public synchronized void observe(BufferedImage image,double gain,long firstObservedNanos) {
        var regions=layout.locate(image,gain);var textImage=layout.textImage(image,regions);var current=new LinkedHashMap<String,Entry>();
        for(var region:regions) {
            String id=id(region);byte[] pixels=layout.fingerprint(region,regions,textImage,gain);var old=entries.get(id);
            if(old!=null && Arrays.equals(old.pixels,pixels) && Arrays.equals(old.geometry.logicalBox(),region.logicalBox()))current.put(id,old);
            else {
                if(old!=null && old.result==null)missed++;
                current.put(id,new Entry(new Key(session,mapping,id,++generation),pixels,firstObservedNanos,clock.getAsLong(),region));changed++;
            }
        }
        for(var old:entries.entrySet())if(!current.containsKey(old.getKey()) && old.getValue().result==null)missed++;
        entries.clear();entries.putAll(current);this.image=textImage;this.gain=gain;
    }
    public synchronized Job job() {
        long now=clock.getAsLong();
        // The frozen engine reads a whole frame. Do not send it a snapshot containing
        // text that is still printing, even when another panel is already stable.
        if(entries.values().stream().anyMatch(e->now-e.stableSince<STABILITY_NANOS))return null;
        var keys=new LinkedHashMap<String,Key>();
        for(var e:entries.entrySet())if(e.getValue().result==null)keys.put(e.getKey(),e.getValue().key);
        return keys.isEmpty()?null:new Job(image,gain,Map.copyOf(keys),now);
    }
    public synchronized boolean complete(Job job,List<Region> regions) {
        boolean accepted=false;
        for(var region:regions) {
            var entry=entries.get(id(region));var key=job.keys().get(id(region));if(key==null)continue;
            if(entry!=null && entry.key.equals(key)) {entry.result=region;entry.submitted=job.submittedNanos();entry.recognized=System.nanoTime();accepted=true;}else discarded++;
        }
        return accepted;
    }
    public synchronized boolean current(Key key) {var entry=entries.get(key.region());return entry!=null && entry.key.equals(key);}
    public synchronized Snapshot snapshot() {
        var regions=new ArrayList<Region>();var ready=new ArrayList<Ready>();int pending=0;
        for(var e:entries.values())if(e.result==null) {regions.add(e.geometry);pending++;}
        else {regions.add(e.result);ready.add(new Ready(e.key,e.first,e.submitted,e.recognized,e.result));}
        return new Snapshot(List.copyOf(regions),List.copyOf(ready),pending);
    }
    public synchronized Map<String,Long> counts() {return Map.of("contentGenerations",changed,"discardedCompletions",discarded,"pendingBeforeChange",missed);}
}
