package io.github.rsocr.desktop.translation;

import com.fasterxml.jackson.databind.*;
import java.util.*;
import java.nio.file.*;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class SourceRecordsTest {
    private static final ObjectMapper JSON=new ObjectMapper();
    private final TranslationEngine engine=new TranslationEngine(JSON);
    private final JsonNode data=JSON.readTree(getClass().getResourceAsStream("/translation/runtime.json"));
    SourceRecordsTest() throws Exception {}
    private static VisibleUnits.Unit unit(String text,String kind){return new VisibleUnits.Unit(text,0,text.length(),text,kind,List.of());}

    @Test void everyAbilityDescriptionWorksInBothGamesWithSpacesAndWrapping() {
        var rows=new ArrayList<JsonNode>();data.path("sourceRecords").forEach(rows::add);data.path("units").forEach(rows::add);
        int count=0;
        for(var row:rows)if(row.path("kind").asText().equals("ability_description")) {
            String source=row.path("japanese").asText();
            for(String text:List.of(source,source.replace('　',' '),source.replace('　','\n'))) {
                String ability=row.path("context").path("abilityName").asText("あめふらし");
                var parsed=VisibleUnits.split("とくせい\n"+ability+"\n"+text,List.of("summary_ability"));
                var result=engine.lookup(parsed.get(2),"summary_ability",row.path("game").asText());
                assertEquals(row.path("chinese").asText(),result.chinese(),row.path("id").asText()+" "+text);
                assertFalse(result.citations().isEmpty());assertEquals(text,result.unit().raw());
            }
            count++;
        }
        assertEquals(156,count);
    }
    @Test void completeSourcePrintingAndNamedTemplatesKeepOriginalEvidence() throws Exception {
        int staticCount=0,templateCount=0;
        var statuses=new TreeMap<String,Integer>();var retained=new ArrayList<Map<String,String>>();
        for(var row:data.path("sourceRecords")) {
            String type=row.path("types").get(0).asText(),game=row.path("game").asText();
            String kind=row.path("kind").asText();if(!Set.of("ability_description","move_description","item_description").contains(kind))kind=null;
            String text=row.path("matchText").asText(),expected=row.path("outputText").asText();
            if(row.path("mode").asText().equals("named_template")) {
                // Independent fixture values: names outside the dictionary stay literal.
                text=text.replace("\uE000PLAYER\uE001","ABC").replace("\uE000RIVAL\uE001","XYZ").replace("\uE000KUN\uE001","くん").replace("\uE000B_ATK_NAME_WITH_PREFIX\uE001","ABC").replace("\uE000B_DEF_NAME_WITH_PREFIX\uE001","XYZ");
                expected=expected.replace("[玩家]","ABC").replace("[对手]","XYZ").replace("[占位符]","くん").replace("[LegendPokemon1]","ABC").replace("[LegendPokemon2]","XYZ");templateCount++;
            }else staticCount++;
            var result=engine.lookup(unit(text,kind),type,game);
            statuses.merge(result.status(),1,Integer::sum);
            if(result.translated())assertFalse(result.citations().isEmpty(),row.path("id").asText());
            else retained.add(Map.of("id",row.path("id").asText(),"reason",result.reason()));
            if(result.status().startsWith("original_rsc_source_"))assertEquals(expected,result.chinese(),row.path("id").asText());
            else if(!result.translated())assertTrue(Set.of("original_source_record_conflict","original_rsc_context_required").contains(result.reason()),row.path("id").asText()+" "+result.reason());
            assertEquals(text,result.unit().raw());
        }
        assertTrue(staticCount>10000);assertTrue(templateCount>100);
        Files.createDirectories(Path.of("../reports/runtime-registration"));
        JSON.writerWithDefaultPrettyPrinter().writeValue(Path.of("../reports/runtime-registration/java-source-checks.json").toFile(),Map.of("passed",true,"staticAttempts",staticCount,"templateAttempts",templateCount,"statuses",statuses,"retained",retained,"scope","Complete-source synthetic text inputs; not screenshot, partial-page or device-chain coverage"));
    }
    @Test void prefixesUnknownGlyphsWrongFieldsAndUnboundBuffersStayJapanese() {
        String text="ポケモンが よりつき にくくなる";
        assertNotNull(engine.lookup(unit(text,"ability_description"),"summary_ability","both").chinese());
        assertNull(engine.lookup(unit(text.substring(0,text.length()-1),"ability_description"),"summary_ability","both").chinese());
        assertNull(engine.lookup(unit(text+"�","ability_description"),"summary_ability","both").chinese());
        assertNull(engine.lookup(unit(text,"move_description"),"summary_ability","both").chinese());
        assertNull(engine.lookup(unit(text,null),"bag_description","both").chinese());
        assertNotNull(engine.lookup(VisibleUnits.split("とくせい\n�\n"+text,List.of("summary_ability")).get(2),"summary_ability","both").chinese());
        assertNull(engine.lookup(unit("[STR_VAR_1]のもじです",null),"field_dialog","both").chinese());
        assertNull(engine.lookup(unit("カイオーガアは がんばリボンを もらった！",null),"field_dialog","both").chinese());
        var name=engine.lookup(unit("ABCは がんばリボンを もらった！",null),"field_dialog","both");
        assertEquals("ABC获得了努力奖章。",name.chinese());
        assertTrue(name.bindings().stream().allMatch(b->b.raw().equals("ABC")&&b.identitySource().equals("current_frame")));
        String repeated="ミツル『あっ！ ABCさん！\n\nぼく あれから つよくなったんだ！\n\nそれを ABCさんにも\nおじさんにも わかって もらいたいんです！\n\nABCさん おねがいです！\nぼくと しょうぶ してください";
        assertNotNull(engine.lookup(unit(repeated,null),"field_dialog","both").chinese());
        assertNull(engine.lookup(unit(repeated.replaceFirst("ABCさんにも","XYZさんにも"),null),"field_dialog","both").chinese());
        String weather="てんきの えいきょうが なくなる";
        assertNull(engine.lookup(unit(weather,"ability_description"),"summary_ability","both").chinese());
        assertEquals("去除所有天气的影响。",engine.lookup(VisibleUnits.split("とくせい\nノーてんき\n"+weather,List.of("summary_ability")).get(2),"summary_ability","both").chinese());
        assertEquals("所有天气的影响都会消失。",engine.lookup(VisibleUnits.split("とくせい\nエアロック\n"+weather,List.of("summary_ability")).get(2),"summary_ability","both").chinese());
    }
}
