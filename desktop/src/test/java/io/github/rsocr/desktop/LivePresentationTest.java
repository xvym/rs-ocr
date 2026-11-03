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
}
