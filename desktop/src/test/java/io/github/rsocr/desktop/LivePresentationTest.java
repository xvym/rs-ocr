package io.github.rsocr.desktop;

import io.github.rsocr.desktop.Presentation.*;
import java.util.*;
import java.util.concurrent.atomic.AtomicLong;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class LivePresentationTest {
    private final AtomicLong clock=new AtomicLong();
    private final LivePresentation display=new LivePresentation(clock::get);
    private final Pointer first=new Pointer(8,8),second=new Pointer(8,24);
    private Panel panel(List<Pointer> pointers) {
        var box=new Box(0,0,80,80);return new Panel("menu","菜单",box,box,0,"原文","recognized",List.of(),pointers);
    }
    private Panel show(List<Pointer> pointers) {return display.stabilize(List.of(panel(pointers))).getFirst();}
    @Test void cursorBlinkKeepsTheSamePanelAndRealMovementSettlesEvenWithoutNewCaptureFrames() {
        var visible=show(List.of(first));clock.set(10_000_000L);
        assertEquals(visible,show(List.of()));assertTrue(display.needsRefresh());
        clock.set(200_000_000L);assertEquals(visible,show(List.of(first)));assertFalse(display.needsRefresh());
        clock.set(250_000_000L);assertEquals(List.of(first),show(List.of(second)).pointers());
        clock.set(310_000_000L);assertEquals(List.of(second),show(List.of(second)).pointers());assertFalse(display.needsRefresh());
        clock.set(320_000_000L);show(List.of());clock.set(820_000_000L);
        assertTrue(show(List.of()).pointers().isEmpty());assertFalse(display.needsRefresh());
    }
    @Test void disappearanceAndNewSessionNeverRetainOldSelection() {
        show(List.of(first));assertTrue(display.stabilize(List.of()).isEmpty());
        assertTrue(show(List.of()).pointers().isEmpty());show(List.of(first));display.reset();
        assertTrue(show(List.of()).pointers().isEmpty());
    }
    private Panel moves(String raw,List<Box> selection) {
        var box=new Box(80,24,160,88);return new Panel("summary_battle_moves","招式",box,box,0,raw,"recognized",List.of(),List.of(),selection);
    }
    @Test void moveOutlineRetainsTheObservedRowAcrossLongDarkPhasesAndUpdatesOnMovement() {
        var first=new Box(85,32,150,16);var next=new Box(85,96,150,16);
        var visible=display.stabilize(List.of(moves("列表",List.of(first))));
        clock.set(10_000_000L);assertEquals(visible,display.stabilize(List.of(moves("列表",List.of()))));
        clock.set(2_000_000_000L);assertEquals(visible,display.stabilize(List.of(moves("列表",List.of()))));assertFalse(display.needsRefresh());
        display.stabilize(List.of(moves("列表",List.of(next))));clock.addAndGet(60_000_000L);
        assertEquals(List.of(next),display.stabilize(List.of(moves("列表",List.of(next)))).getFirst().selections());
        assertTrue(display.stabilize(List.of(moves("新列表",List.of()))).getFirst().selections().isEmpty());
        display.stabilize(List.of(moves("新列表",List.of(first))));display.reset();
        assertTrue(display.stabilize(List.of(moves("新列表",List.of()))).getFirst().selections().isEmpty());
        display.stabilize(List.of(moves("新列表",List.of(first))));display.stabilize(List.of());
        assertTrue(display.stabilize(List.of(moves("新列表",List.of()))).getFirst().selections().isEmpty());
    }
}
