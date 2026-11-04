package io.github.rsocr.desktop;

import java.util.*;
import java.util.function.LongSupplier;
import io.github.rsocr.desktop.Presentation.*;

/** Keep native cursor blinking/bobbing out of the result board. */
public final class LivePresentation {
    private static final long MOVE_NANOS=60_000_000L,HIDE_NANOS=500_000_000L;
    private record Decoration(List<Pointer> pointers,List<Box> selections) {
        boolean empty() {return pointers.isEmpty() && selections.isEmpty();}
    }
    private static final class Entry {
        final Box clip;final String raw,status;Decoration shown,candidate;long since;
        Entry(Panel panel,Decoration decoration,long now) {clip=panel.clip();raw=panel.raw();status=panel.status();shown=candidate=decoration;since=now;}
    }
    private final Map<String,Entry> entries=new HashMap<>();
    private final LongSupplier clock;
    public LivePresentation() {this(System::nanoTime);}
    public LivePresentation(LongSupplier clock) {this.clock=clock;}
    public void reset() {entries.clear();}
    public boolean needsRefresh() {return entries.values().stream().anyMatch(e->!e.shown.equals(e.candidate));}
    public List<Panel> stabilize(List<Panel> panels) {
        long now=clock.getAsLong();var visible=new HashSet<String>();var result=new ArrayList<Panel>();
        for(var panel:panels) {
            visible.add(panel.key());var observed=new Decoration(panel.pointers(),panel.selections());var entry=entries.get(panel.key());
            if(entry==null || !entry.clip.equals(panel.clip()) || !entry.raw.equals(panel.raw()) || !entry.status.equals(panel.status())) {
                entry=new Entry(panel,observed,now);entries.put(panel.key(),entry);
            }
            else {
                if(!observed.equals(entry.candidate)) {entry.candidate=observed;entry.since=now;}
                if(now-entry.since>=(observed.empty()?HIDE_NANOS:MOVE_NANOS))entry.shown=observed;
            }
            result.add(new Panel(panel.key(),panel.name(),panel.clip(),panel.frame(),panel.order(),panel.raw(),panel.status(),panel.runs(),entry.shown.pointers(),entry.shown.selections(),panel.translations()));
        }
        entries.keySet().retainAll(visible);return List.copyOf(result);
    }
}
