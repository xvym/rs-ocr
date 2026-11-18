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
    @Test void heKanaHomoglyphsUseOriginalLexiconInBothDirectionsAndKeepRawText() {
        for(String game:List.of("both","ruby","sapphire")) {
            var result=ENGINE.lookup(unit("へラクロス"),"field_dialog",game);
            var canonical=ENGINE.lookup(unit("ヘラクロス"),"field_dialog",game);
            assertEquals("赫拉克罗斯",result.chinese());assertEquals(canonical.citations(),result.citations());
            assertEquals("へラクロス",result.unit().raw());assertEquals("へラクロス",result.unit().searchText());
            var name=ENGINE.name("へラクロス","species",game);
            assertEquals("赫拉克罗斯",name.value());assertEquals("へラクロス",name.raw());assertFalse(name.sources().isEmpty());
            assertEquals("大蛇瞪眼",ENGINE.name("ヘびにらみ","move",game).value());
            assertEquals("给大吾的信",ENGINE.name("ダイゴヘのてがみ","item",game).value());
        }
        var wrongKind=new VisibleUnits.Unit("へラクロス",0,5,"へラクロス","move",List.of());
        assertNull(ENGINE.lookup(wrongKind,"battle_moves","both").chinese());
        for(String raw:List.of("へラクロ","へらクロス","へラクロス�","[へラクロス]"))
            assertEquals(raw,ENGINE.name(raw,"species","both").value());
    }
    @Test void battleActorHomoglyphsTranslateWithoutChangingObservedBindingsOrUnknownNames() {
        for(String game:List.of("both","ruby","sapphire"))for(String raw:List.of("へラクロスの\nすばやさが さがった！","へラクロスは\nかわらわりを した！")) {
            var result=ENGINE.lookup(unit(raw),"battle_message",game);
            var canonical=ENGINE.lookup(unit(raw.replace('へ','ヘ')),"battle_message",game);
            assertNotNull(result.chinese());assertEquals(canonical.chinese(),result.chinese());assertTrue(result.chinese().contains("赫拉克罗斯"));
            assertEquals(raw,result.unit().raw());assertTrue(result.bindings().stream().anyMatch(b->"へラクロス".equals(b.raw())&&"赫拉克罗斯".equals(b.value())&&!b.citations().isEmpty()));
            for(var binding:result.bindings())if(binding.start()>=0)assertEquals(binding.raw(),raw.substring(binding.start(),binding.end()));
            assertTrue(ENGINE.lookup(unit(raw),"battle_message",game,false).chinese().contains("へラクロス"));
            var unknown=ENGINE.lookup(unit(raw.replace("へラクロス","へラクロ")),"battle_message",game);
            assertNotNull(unknown.chinese());assertTrue(unknown.chinese().contains("へラクロ"));
        }
    }
    @Test void truncatedUnknownInjectedAndWrongLayoutInputsRemainRaw() {
        for(String s:List.of("あいて","しかし あいての グラ","ハルカは パソコンの","�","[PLAYER]"))assertNull(ENGINE.lookup(unit(s),"field_dialog","both").chinese(),s);
        assertNull(ENGINE.lookup(unit("エネコロロ『みゃあん？"),"bag_description","both").chinese());
    }
    @Test void cannotUseHerePublishesTheCompleteOriginalInBothGames() {
        for(String game:List.of("both","ruby","sapphire"))for(String type:List.of("field_dialog","bag_prompt"))
            for(String raw:List.of("ここでは つかえません","ここでは　つかえません","ここでは\nつかえません")) {
                var result=ENGINE.lookup(unit(raw),type,game);
                assertEquals("在这里无法使用。",result.chinese());assertEquals(result.chinese(),result.output());
                assertEquals(raw,result.unit().raw());
                assertEquals(List.of("rs.common.strings.OtherText_CantUseThatHere"),result.sourceQids());
                assertEquals(game.equals("both")?2:1,result.citations().size());
                for(var citation:result.citations()) {
                    assertEquals("9043",citation.path("sourceLine").asText());
                    assertEquals("在这里无法使用。",citation.path("chinese").asText());
                }
            }
        for(String raw:List.of("ここでは つかえませ","ここでは つかえません�"))
            assertNull(ENGINE.lookup(unit(raw),"field_dialog","both").chinese());
        var wrongKind=new VisibleUnits.Unit("ここでは つかえません",0,11,"ここでは つかえません","move",List.of());
        assertNull(ENGINE.lookup(wrongKind,"battle_moves","both").chinese());
    }
    @Test void drizzleDescriptionUsesTheCompleteOriginalSourceInBothGames() {
        for(String game:List.of("both","ruby","sapphire"))
            for(String raw:List.of("せんとうに　でると　あめを　ふらす","せんとうに でると あめを ふらす","せんとうに でると\nあめを ふらす")) {
                var units=VisibleUnits.split("とくせい\nあめふらし\n"+raw,List.of("summary_ability"));
                var result=ENGINE.lookup(units.get(2),"summary_ability",game);
                assertEquals("ability_description",units.get(2).kind());
                assertEquals("出场时降下雨。",result.chinese());assertEquals(result.chinese(),result.output());
                assertEquals(raw,result.unit().raw());
                assertEquals(List.of("rs.common.ability_descriptions.gAbilityDescription_Drizzle"),result.sourceQids());
                assertEquals(game.equals("both")?2:1,result.citations().size());
                for(var citation:result.citations()) {
                    assertEquals("4959",citation.path("sourceLine").asText());
                    assertEquals("出场时降下雨。",citation.path("chinese").asText());
                    assertEquals(citation.path("game").asText().equals("ruby")?"upstream-5":"upstream-6",citation.path("sourceId").asText());
                }
            }
        for(String raw:List.of("せんとうに でると あめを ふら","せんとうに でると あめを ふらす�"))
            assertNull(ENGINE.lookup(new VisibleUnits.Unit(raw,0,raw.length(),raw,"ability_description",List.of()),"summary_ability","both").chinese());
        String raw="せんとうに でると あめを ふらす";
        assertNull(ENGINE.lookup(new VisibleUnits.Unit(raw,0,raw.length(),raw,"ability",List.of()),"summary_ability","both").chinese());
    }
    @Test void safariMetLocationUsesTheOriginalMapNameAndMemoPrintRecipe() {
        for(String game:List.of("both","ruby","sapphire"))
            for(String raw:List.of("サファリゾーンで であった","サファリゾーンで　であった","サファリゾーンでであった")) {
                var result=ENGINE.lookup(unit(raw),"summary_memo",game);
                assertEquals("狩猎地带相遇。",result.chinese());assertEquals(result.chinese(),result.output());
                assertEquals("original_rsc_native_field",result.status());assertEquals("memo_met_location",result.ruleId());
                assertEquals(raw,result.unit().raw());
                assertTrue(result.citations().stream().anyMatch(c->c.path("qid").asText().equals("rs.common.region_map_entries.sMapName_SAFARIZONE")&&c.path("sourceLine").asInt()==8262));
                assertTrue(result.citations().stream().anyMatch(c->c.path("qid").asText().equals("rs.common.strings2.gOtherText_Met")&&c.path("sourceLine").asInt()==9751));
                assertEquals(game.equals("both")?4:2,result.citations().size());
            }
        for(String raw:List.of("サファリゾーンで であっ","サファリゾー�で であった","サファリゾーンで あったようだ","サファリゾーンXで であった"))
            assertNull(ENGINE.lookup(unit(raw),"summary_memo","both").chinese());
        assertNull(ENGINE.lookup(unit("サファリゾーンで であった"),"field_dialog","both").chinese());
    }
    @Test void equalOutputKeepsEverySourceAndActualTypeAndVersionConflictsStayRaw() {
        var same=ENGINE.name("ハルカ","person","both");assertEquals("小遥",same.value());assertTrue(same.sources().size()>2);
        assertEquals("鬼斯通",ENGINE.name("ゴースト","species","both").value());assertEquals("幽灵",ENGINE.name("ゴースト","type","both").value());assertEquals("ゴースト",ENGINE.name("ゴースト",null,"both").value());
        var ambiguous=ENGINE.lookup(unit("ピクニックガール"),"field_dialog","both");assertNull(ambiguous.chinese());assertEquals("original_rsc_context_required",ambiguous.reason());assertTrue(ambiguous.sourceQids().size()>0);
        assertEquals("野餐女孩",ENGINE.name("ピクニックガール","trainer_class","ruby").value());assertEquals("野餐少女",ENGINE.name("ピクニックガール","trainer_class","sapphire").value());
    }
}
