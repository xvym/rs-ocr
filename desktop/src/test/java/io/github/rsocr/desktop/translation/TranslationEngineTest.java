package io.github.rsocr.desktop.translation;

import com.fasterxml.jackson.databind.*;
import java.nio.file.*;
import java.util.*;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class TranslationEngineTest {
    private static final ObjectMapper JSON=new ObjectMapper();
    private static final TranslationEngine ENGINE;
    static {try{ENGINE=new TranslationEngine(JSON);}catch(Exception e){throw new ExceptionInInitializerError(e);}}
    private static VisibleUnits.Unit unit(String s) {return new VisibleUnits.Unit(s,0,s.length(),s,null,List.of());}
    @Test void javaInterpreterMatchesEveryApprovedOriginalWindowAndFallbackInBothGames() throws Exception {
        var reference=JSON.readTree(Path.of("../corpus/visible-windows/reference.json").toFile());var failures=new ArrayList<String>();int count=0;
        for(var r:reference.path("regions"))if(r.path("inFirstEdition").asBoolean()) {
            var types=new ArrayList<String>();for(var t:r.path("typeCandidates"))types.add(t.asText());String type=types.getFirst();
            // The complete four-row PC menu provides layout evidence when visual types overlap.
            if(types.size()>1&&types.contains("pc_pokemon_menu")&&r.path("japanese").asText().split("\n").length==4)types= new ArrayList<>(List.of("pc_pokemon_menu"));
            var parsed=VisibleUnits.split(r.path("japanese").asText(),types);
            if(parsed.size()!=r.path("units").size()){failures.add(r.path("id")+" segmentation count "+parsed.size()+" != "+r.path("units").size());continue;}
            for(int i=0;i<parsed.size();i++){
                var u=parsed.get(i);var expected=r.path("units").get(i);
                if(!u.raw().equals(expected.path("raw").asText())||!u.searchText().equals(expected.path("searchText").asText())||!Objects.equals(u.kind(),expected.path("kind").isNull()?null:expected.path("kind").asText())){failures.add(expected.path("id")+" segmentation differs");continue;}
                for(String game:List.of("both","ruby","sapphire")) {
                    var actual=ENGINE.lookup(u,type,game,false);String chinese=game.equals("both")?expected.path("expectedChinese").asText(null):expected.path("expectedChineseByGame").path(game).asText(null);
                    String output=chinese==null?u.raw():expected.path("outputMode").asText().equals("whole_unit")||actual.status().equals("original_rsc_native_field")?chinese:u.raw().replace(u.searchText(),chinese);
                    if(!Objects.equals(chinese,actual.chinese())||!output.equals(actual.output()))failures.add(expected.path("id").asText()+" "+game+" expected="+chinese+" actual="+actual.chinese()+" reason="+actual.reason());count++;
                }
            }
        }
        Files.createDirectories(Path.of("../reports/s7-integration"));JSON.writerWithDefaultPrettyPrinter().writeValue(Path.of("../reports/s7-integration/java-parity.json").toFile(),Map.of("checks",count,"passed",failures.isEmpty(),"failures",failures,"nameLookupDisabledForS6Parity",true));
        assertTrue(failures.isEmpty(),String.join("\n",failures));assertEquals(2349,count);
    }
    @Test void uniqueOriginalIsUsedRegardlessOfLocalizationDifferences() {
        assertEquals("向尾喵：喵？",ENGINE.lookup(unit("エネコロロ『みゃあん？"),"field_dialog","both").chinese());
        assertEquals("万物皆靠大海生存，\n即便是在陆地上安家也一样。",ENGINE.lookup(unit("いのちの みなもとは うみから うまれて\nりくに あがって きた"),"field_dialog","both").chinese());
    }
    @Test void completeNamesPreferOriginalLexiconAndUnknownNamesStayVisible() {
        assertEquals("妙蛙种子",ENGINE.name("フシギダネ","species","both").value());assertEquals("ポチ",ENGINE.name("ポチ",null,"both").value());
        var r=ENGINE.lookup(unit("ハルカは パソコンの\nスイッチを いれた！"),"field_dialog","both");assertNotNull(r.chinese());assertEquals("ハルカは パソコンの\nスイッチを いれた！",r.unit().raw());
    }
    @Test void truncatedUnknownInjectedAndWrongLayoutInputsRemainRaw() {
        for(String s:List.of("あいて","しかし あいての グラ","ハルカは パソコンの","�","[PLAYER]"))assertNull(ENGINE.lookup(unit(s),"field_dialog","both").chinese(),s);
        assertNull(ENGINE.lookup(unit("エネコロロ『みゃあん？"),"bag_description","both").chinese());
    }
    @Test void equalOutputKeepsEverySourceAndActualTypeAndVersionConflictsStayRaw() {
        var same=ENGINE.name("ハルカ","person","both");assertEquals("小遥",same.value());assertTrue(same.sources().size()>2);
        assertEquals("鬼斯通",ENGINE.name("ゴースト","species","both").value());assertEquals("幽灵",ENGINE.name("ゴースト","type","both").value());assertEquals("ゴースト",ENGINE.name("ゴースト",null,"both").value());
        var ambiguous=ENGINE.lookup(unit("ピクニックガール"),"field_dialog","both");assertNull(ambiguous.chinese());assertEquals("original_rsc_context_required",ambiguous.reason());assertTrue(ambiguous.sourceQids().size()>0);
        assertEquals("野餐女孩",ENGINE.name("ピクニックガール","trainer_class","ruby").value());assertEquals("野餐少女",ENGINE.name("ピクニックガール","trainer_class","sapphire").value());
    }
}
