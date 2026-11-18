package io.github.rsocr.desktop.translation;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.github.rsocr.OcrEngine;
import io.github.rsocr.desktop.Presentation.*;
import java.util.*;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class TranslationDiagnosticsTest {
    private final ObjectMapper json=new ObjectMapper();
    private final TranslationEngine engine=new TranslationEngine(json);
    TranslationDiagnosticsTest() throws Exception {}
    private static OcrEngine.Region region(String raw,String type) {return new OcrEngine.Region(List.of(type),"dialogue_jp",new int[]{8,112,224,48},1,raw,"recognized",List.of());}
    private String report(String raw,String type) {return TranslationDiagnostics.describe(new TranslationSession(engine).translate(List.of(region(raw,type))),List.of(),engine);}

    @Test void unknownGlyphAndUnmatchedTextHaveDifferentActions() {
        String invalid=report("あ�いう","field_dialog");
        assertTrue(invalid.contains("invalid_or_unknown_input"));assertTrue(invalid.contains("先对照原图核对日文"));assertTrue(invalid.contains("识别原文：あ�いう"));
        String unknown=report("あいうえおかきくけこさしすせそたちつてと","field_dialog");
        assertTrue(unknown.contains("no_reviewed_visible_window"));assertTrue(unknown.contains("本结果不能说明原汉化资料没有中文"));
    }
    @Test void outsideScopeIsNotPresentedAsMissingChinese() {
        String text=report("あいう","unsupported_diagnostic_fixture");
        assertTrue(text.contains("尚未纳入中文翻译范围"));assertTrue(text.contains("outside_first_edition"));
    }
    @Test void outputExistsButMissingDisplayBlockIsReported() {
        var frame=new TranslationSession(engine).translate(List.of(region("キズぐすり ×3","bag_list")));
        assertTrue(frame.regions().getFirst().units().getFirst().translated());
        var box=new Box(0,0,240,160);
        var panel=new Panel("bag_list","背包",box,null,0,"キズぐすり ×3","recognized",List.of(),List.of());
        String text=TranslationDiagnostics.describe(frame,List.of(panel),engine);
        assertTrue(text.contains("已匹配中文，但未生成对应显示文本块"));assertTrue(text.contains("中文结果：伤药"));
        var shown=new Panel("bag_list","背包",box,null,0,"キズぐすり ×3","recognized",List.of(),List.of(),List.of(),List.of(new TextBlock(box,"伤药")));
        assertFalse(TranslationDiagnostics.describe(frame,List.of(shown),engine).contains("未生成对应显示文本块"));
    }
    @Test void emptyAndPendingFramesNeverReuseAnOldFailure() {
        assertTrue(TranslationDiagnostics.describe(null,List.of(),engine).contains("等待识别结果"));
        var session=new TranslationSession(engine);
        assertTrue(TranslationDiagnostics.describe(session.translate(List.of()),List.of(),engine).contains("未检测到"));
        var pending=new OcrEngine.Region(List.of("field_dialog"),"dialogue_jp",new int[]{8,112,224,48},1,"","pending",List.of());
        var panel=new Panel("field_dialog","对话",new Box(8,112,224,48),null,0,"","pending",List.of(),List.of());
        assertTrue(TranslationDiagnostics.describe(session.translate(List.of(pending)),List.of(panel),engine).contains("等待文字稳定"));
    }
    @Test void whitespaceClueDoesNotChangeTheLookupResult() throws Exception {
        var resource=json.readTree(getClass().getResourceAsStream("/translation/runtime.json"));
        var rule=resource.path("visible").path("rules").findValues("id");
        assertFalse(rule.isEmpty());
        var first=resource.path("visible").path("rules").get(0);
        String type=first.path("type").asText(),raw=first.path("searchText").asText().replace(" ","　");
        String kind=first.path("kind").isNull()?null:first.path("kind").asText();
        var unit=new VisibleUnits.Unit(raw,0,raw.length(),raw,kind,List.of());
        var before=engine.lookup(unit,type,"both");
        var hints=engine.diagnosticHints(before,type,"both");
        assertTrue(hints.stream().anyMatch(h->h.contains("空白或换行不同")));
        assertEquals(before,engine.lookup(unit,type,"both"));
    }
}
