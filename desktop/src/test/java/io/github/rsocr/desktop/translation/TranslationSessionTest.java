package io.github.rsocr.desktop.translation;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.github.rsocr.OcrEngine;
import io.github.rsocr.desktop.capture.*;
import java.awt.image.BufferedImage;
import java.util.*;
import java.util.concurrent.atomic.AtomicLong;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class TranslationSessionTest {
    private final ObjectMapper json=new ObjectMapper();
    private final TranslationEngine engine=new TranslationEngine(json);
    TranslationSessionTest() throws Exception {}
    private static OcrEngine.Region region(String raw,String type) {return new OcrEngine.Region(List.of(type),"dialogue_jp",new int[]{8,112,224,48},1,raw,"recognized",List.of());}
    @Test void currentNameWinsManualWinsMemoryAndResetPreservesOnlyManual() {
        var s=new TranslationSession(engine);s.configure("both","ユウキ");
        var f=s.translate(List.of(region("ハルカは\nパソコンの スイッチを いれた！","field_dialog")));
        assertEquals("ハルカ",f.player().raw());assertEquals("current_frame",f.player().source());assertEquals("ハルカ",f.automaticPlayer());
        var next=s.translate(List.of(region("あいて","battle_message")));assertEquals("ユウキ",next.player().raw());assertEquals("manual",next.player().source());assertNull(next.regions().getFirst().units().getFirst().chinese());
        s.configure("both","");assertEquals("session_memory",s.translate(List.of()).player().source());s.reset();assertNull(s.translate(List.of()).player());
        s.configure("ruby","ユウキ");s.reset();assertEquals("ユウキ",s.translate(List.of()).player().raw());assertNull(s.player(List.of("ハルカ","ユウキ")));
    }
    @Test void rivalOtherTrainerAndBattleActorsNeverTeachPlayerIdentity() {
        var s=new TranslationSession(engine);
        s.translate(List.of(region("おや/ハルカ IDNo12345","summary_personal")));assertNull(s.translate(List.of()).player());
        assertThrows(IllegalArgumentException.class,()->s.configure("both","ABCDEF"));assertThrows(IllegalArgumentException.class,()->s.configure("both","[A]"));
    }
    @Test void namesAndNumbersAreTakenAgainFromEachFrameAndPendingAndAbsentRegionsClearChinese() {
        var s=new TranslationSession(engine);String boot="ハルカは\nパソコンの スイッチを いれた！";
        assertEquals("小遥启动了电脑。",s.translate(List.of(region(boot,"field_dialog"))).regions().getFirst().units().getFirst().chinese());
        assertEquals("小悠启动了电脑。",s.translate(List.of(region(boot.replace("ハルカ","ユウキ"),"field_dialog"))).regions().getFirst().units().getFirst().chinese());
        var pending=new OcrEngine.Region(List.of("field_dialog"),"dialogue_jp",new int[]{8,112,224,48},1,"","pending",List.of());
        assertTrue(s.translate(List.of(pending)).regions().getFirst().units().isEmpty());assertTrue(s.translate(List.of()).regions().isEmpty());
    }
    @Test void sourceOrMappingRestartAndOutOfOrderOcrCannotPublishOldChinese() throws Exception {
        var clock=new AtomicLong();var state=new LiveState(new LiveLayout(json),clock::get);var input=javax.imageio.ImageIO.read(java.nio.file.Path.of("../gba_testcase/Screenshot 2026-10-31 15-38-28.png").toFile());
        var image=io.github.rsocr.Normalizer.normalize(input,io.github.rsocr.Normalizer.preset("gba-5x",input));state.newSession(1);state.observe(image,.984,0);clock.addAndGet(LiveState.STABILITY_NANOS);var old=state.job();assertNotNull(old);
        state.newSession(2);state.observe(image,.984,1);assertFalse(state.complete(old,new OcrEngine(json).recognize(image)));assertTrue(state.snapshot().regions().stream().allMatch(r->r.status().equals("pending")));
        var s=new TranslationSession(engine);assertTrue(s.translate(state.snapshot().regions()).regions().stream().allMatch(r->r.units().isEmpty()));
    }
    @Test void chineseTimingCountsPaintedChineseAndKeepsFallbackSeparate() {
        var r=region("ハルカは\nパソコンの スイッチを いれた！","field_dialog");var s=new TranslationSession(engine);var frame=s.translate(List.of(r));var metrics=new LiveMetrics();
        metrics.displayed(new LiveState.Ready(new LiveState.Key(1,1,"field_dialog",1),0,160_000_000,170_000_000,r),210_000_000,frame);
        var report=(Map<?,?>)metrics.report(Map.of("contentGenerations",1L)).get("chineseDisplay");assertEquals(1,report.get("samples"));assertEquals(210.0,report.get("p95Ms"));assertEquals(1L,report.get("over200Ms"));
    }
}
