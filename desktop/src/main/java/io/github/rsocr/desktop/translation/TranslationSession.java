package io.github.rsocr.desktop.translation;

import io.github.rsocr.OcrEngine;
import java.util.*;

/** Identity belongs to a capture session. Only accepted current frames can teach it. */
public final class TranslationSession {
    public record Player(String raw,String source) {}
    public record RegionResult(String key,String raw,List<TranslationEngine.Result> units) {}
    public record Frame(String game,List<RegionResult> regions,Player player,String manualPlayer,String automaticPlayer,String resourceVersion) {}
    private final TranslationEngine engine;
    private String game="both",manual="",automatic="";
    private List<String> cacheKey=List.of();private Frame cached;
    public TranslationSession(TranslationEngine engine) {this.engine=engine;}
    public synchronized void configure(String game,String manual) {
        if(!Set.of("both","ruby","sapphire").contains(game))throw new IllegalArgumentException("请选择游戏版本");
        manual=manual.strip();if(manual.codePointCount(0,manual.length())>5||manual.matches("(?s).*[\\[\\]{}\\\\�\\p{Cntrl}\\s].*"))throw new IllegalArgumentException("玩家名请填 1～5 个当前游戏字符，或留空");
        if(!this.game.equals(game))automatic="";this.game=game;this.manual=manual;cached=null;
    }
    public synchronized void reset() {automatic="";cacheKey=List.of();cached=null;}
    public synchronized Player player(Collection<String> current) {
        var names=new HashSet<>(current);if(names.size()==1)return new Player(names.iterator().next(),"current_frame");
        if(names.size()>1)return null;
        if(!manual.isEmpty())return new Player(manual,"manual");if(!automatic.isEmpty())return new Player(automatic,"session_memory");return null;
    }
    public synchronized Frame translate(List<OcrEngine.Region> regions) {
        var key=regions.stream().map(r->r.typeCandidates()+"\u0000"+r.status()+"\u0000"+r.rawOcr()).toList();if(cached!=null&&cacheKey.equals(key))return cached;
        var outputs=new ArrayList<RegionResult>();var players=new HashSet<String>();
        for(var r:regions) {
            var units=new ArrayList<TranslationEngine.Result>();
            if(!r.status().equals("pending")&&!r.rawOcr().isBlank()) {
                var types=r.typeCandidates();String type=types.getFirst();
                if(types.size()>1&&types.contains("pc_pokemon_menu")&&r.rawOcr().equals("ポケモンを つれていく\nポケモンを あずける\nボックスを せいりする\nさようなら"))types=List.of("pc_pokemon_menu");
                for(var u:VisibleUnits.split(r.rawOcr(),types)) {
                    var result=engine.lookup(u,type,game);units.add(result);
                    // The native save field explicitly identifies the player. Other names
                    // and original-trainer fields never become player identity.
                    for(var f:u.fields())if(f.role().equals("visible_player_name")&&!f.raw().contains("�"))players.add(f.raw());
                    for(var f:u.fields())if(Set.of("visible_player_name","visible_original_trainer").contains(f.role())) {
                        var name=engine.name(f.raw(),"person",game);int at=u.raw().indexOf(f.raw(),u.raw().indexOf(u.searchText())+u.searchText().length());
                        if(at>=0&&!name.sources().isEmpty()&&!name.value().equals(f.raw())) {
                            var nameUnit=new VisibleUnits.Unit(f.raw(),u.start()+at,u.start()+at+f.raw().length(),f.raw(),null,List.of());
                            units.add(new TranslationEngine.Result(nameUnit,name.value(),name.value(),"original_rsc_name","complete_visible_name_original_lexicon",null,name.sources(),List.of(),name.sources().stream().map(n->n.path("qid").asText()).distinct().toList()));
                        }
                    }
                    for(var b:result.bindings())if(b.sourceSlot().equals("PLAYER")&&b.raw()!=null&&result.bindings().stream().filter(v->Objects.equals(v.raw(),b.raw())).allMatch(v->v.sourceSlot().equals("PLAYER")))players.add(b.raw());
                }
            }
            outputs.add(new RegionResult(String.join("|",r.typeCandidates()),r.rawOcr(),List.copyOf(units)));
        }
        if(players.size()==1)automatic=players.iterator().next();
        cacheKey=key;cached=new Frame(game,List.copyOf(outputs),player(players),manual,automatic,engine.resourceVersion());return cached;
    }
}
