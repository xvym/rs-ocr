package io.github.rsocr.desktop;

import io.github.rsocr.OcrEngine;
import io.github.rsocr.desktop.capture.*;
import org.junit.jupiter.api.Test;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

class LiveMetricsTest {
    @Test void timingIncludesQueueRecognitionAndUiAndKeepsUnknownAndMissedStatesSeparate() {
        var metrics=new LiveMetrics();metrics.frame(true,true);metrics.frame(false,false);metrics.skippedNativeFrames(2);
        long start=1_000_000_000L;
        var region=new OcrEngine.Region(List.of("field_dialog"),"dialogue_jp",new int[]{8,112,224,48},1,"原文","recognized",List.of());
        var ready=new LiveState.Ready(new LiveState.Key(1,2,"field_dialog",1),start,start+30_000_000,start+80_000_000,region);
        metrics.displayed(ready,start+220_000_000);metrics.displayed(ready,start+400_000_000);
        var unknown=new OcrEngine.Region(region.typeCandidates(),region.variant(),region.logicalBox(),1,"�","unknown_glyph",List.of());
        metrics.displayed(new LiveState.Ready(new LiveState.Key(1,2,"field_dialog",2),start,start+10_000_000,start+20_000_000,unknown),start+500_000_000);
        var report=metrics.report(Map.of("contentGenerations",3L,"pendingBeforeChange",1L));
        assertEquals(1,report.get("textSamples"));assertEquals(220.0,report.get("p50Ms"));assertEquals(1L,report.get("over200Ms"));
        assertEquals(1L,report.get("unknownGlyphDisplays"));assertEquals(1L,report.get("contentGenerationsNotShown"));assertEquals(1L,report.get("repeatedNativeFramePolls"));assertEquals(2L,report.get("nativeFramesNotSampled"));
        var first=(Map<?,?>)((List<?>)report.get("events")).getFirst();
        assertEquals(30.0,first.get("receiveToSubmissionMs"));assertEquals(50.0,first.get("ocrThroughAcceptanceMs"));assertEquals(140.0,first.get("acceptanceToUiPulseMs"));
    }
}
