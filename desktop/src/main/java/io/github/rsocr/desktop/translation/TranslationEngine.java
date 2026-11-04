package io.github.rsocr.desktop.translation;

import com.fasterxml.jackson.databind.*;
import com.fasterxml.jackson.databind.node.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.security.*;
import java.util.*;
import java.util.regex.*;
import static io.github.rsocr.desktop.translation.VisibleUnits.*;

/** Offline interpreter of source-linked S6 rules. No generated Chinese or semantic veto. */
public final class TranslationEngine {
    public static final String POLICY="rsc-original-only-v1";
    public record Binding(String token,String sourceSlot,String raw,String value,int start,int end,String identitySource,List<JsonNode> citations) {}
    public record Result(Unit unit,String output,String chinese,String status,String reason,String ruleId,List<JsonNode> citations,List<Binding> bindings,List<String> sourceQids) {
        public boolean translated() {return chinese!=null;}
    }
    public record Name(String raw,String value,List<JsonNode> sources) {}
    private record Projection(String key,List<Integer> offsets) {}
    private record Capture(String slot,String raw,int start,int end) {}
    private record Hit(String qid,int page,int lineStart,int lineCount,List<Capture> captures,JsonNode meaning,JsonNode model) {}
    private record Bound(String output,List<JsonNode> citations,List<Binding> bindings,String family) {}
    private static final class MatchingLimit extends RuntimeException {}
    private final JsonNode data,visible,variables;
    private final Map<String,JsonNode> rules=new HashMap<>();
    private final Map<String,List<JsonNode>> lexical=new HashMap<>(),plans=new HashMap<>(),contracts=new HashMap<>();
    private final Set<String> included=new HashSet<>();
    private final Map<String,JsonNode> originalCandidates=new HashMap<>();
    private final String allowed;
    private static final Pattern TOKEN=Pattern.compile("\\[[^\\]]+\\]|\\\\v\\\\h[0-9A-Fa-f]{2}");
    private static final Pattern INVALID=Pattern.compile("[\\[\\]{}\\\\�\\uE000\\uE001\\x00-\\x08\\x0B\\x0C\\x0E-\\x1F]");

    public TranslationEngine(ObjectMapper mapper) throws IOException {
        byte[] bytes;
        try(var stream=TranslationEngine.class.getResourceAsStream("/translation/runtime.json")) {if(stream==null)throw new IOException("缺少原汉化资源，请重新构建桌面程序");bytes=stream.readAllBytes();}
        JsonNode manifest;
        try(var stream=TranslationEngine.class.getResourceAsStream("/translation/manifest.json")) {if(stream==null)throw new IOException("缺少中文资源清单");manifest=mapper.readTree(stream);}
        if(!digest(bytes).equals(manifest.path("sha256").asText()))throw new IOException("原汉化资源校验失败");
        data=mapper.readTree(bytes);visible=data.path("visible");variables=visible.path("variableBindings");
        if(!POLICY.equals(data.path("translationPolicy").asText())||!data.path("sourceSelection").asText().equals("unique_original_rsc_text")||data.path("semanticDifferenceFallback").asBoolean(true))throw new IOException("原汉化资源政策不兼容");
        for(var s:data.path("rscSources"))if(!s.path("repository").asText().equals("UWorldGX/pkmn_rs_chn_rsc")||!s.path("commit").asText().equals("f513cf437acca23d1a5882650ee3b148dc463a17"))throw new IOException("汉化来源版本不兼容");
        for(var r:visible.path("rules"))rules.put(ruleKey(r.path("type").asText(),r.path("searchText").asText(),nullable(r.get("kind"))),r);
        for(var group:List.of("lexicon","units"))for(var r:data.path(group))lexical.computeIfAbsent(project(r.path("japanese").asText(),false).key,k->new ArrayList<>()).add(r);
        for(var p:visible.path("semanticUnits").path("plans"))for(var a:p.path("anchors"))plans.computeIfAbsent(ruleKey(p.path("type").asText(),project(a.path("japanese").asText(),true).key,nullable(p.get("kind"))),k->new ArrayList<>()).add(p);
        for(var c:variables.path("contracts"))contracts.computeIfAbsent(c.path("type").asText(),k->new ArrayList<>()).add(c);
        for(var t:data.path("includedTypes"))included.add(t.asText());
        for(var c:data.path("candidates"))originalCandidates.put(c.path("id").asText(),c);
        allowed=variables.path("battleTemplates").path("actor").path("allowedCharacters").asText()+" 　";
    }
    public String resourceVersion() {return data.path("s6ManifestSha256").asText();}
    private static String digest(byte[] b) {try{return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(b));}catch(NoSuchAlgorithmException e){throw new IllegalStateException(e);}}
    private static String nullable(JsonNode n) {return n==null||n.isNull()?null:n.asText();}
    private static String ruleKey(String type,String text,String kind) {return type+"\u0000"+Objects.toString(kind,"")+"\u0000"+text;}
    private static boolean applicable(JsonNode n,String game) {return game.equals("both")||n.path("game").asText().equals("both")||n.path("game").asText().equals(game);}
    private static List<String> games(String game) {if(!Set.of("ruby","sapphire","both").contains(game))throw new IllegalArgumentException("未知游戏版本");return game.equals("both")?List.of("ruby","sapphire"):List.of(game);}
    private static boolean space(char c) {return c==' '||c=='　'||c=='\r'||c=='\n';}
    private static boolean digit(char c) {return c>='0'&&c<='9'||c>='０'&&c<='９';}
    private static Projection project(String raw,boolean display) {
        var key=new StringBuilder();var offsets=new ArrayList<Integer>();
        for(int i=0;i<raw.length();i++) {
            char c=raw.charAt(i);
            if(space(c)){int end=i+1;while(end<raw.length()&&space(raw.charAt(end)))end++;if(i>0&&end<raw.length()&&digit(raw.charAt(i-1))&&digit(raw.charAt(end))){key.append(' ');offsets.add(i);}i=end-1;}
            else {key.append(display&&(c>='０'&&c<='９'||c=='Ｈ'||c=='Ｐ')?(char)(c-0xFEE0):display&&c=='／'?'/':c);offsets.add(i);}
        }
        return new Projection(key.toString(),offsets);
    }
    private static String display(String s) {return s.replace("\\p","\n\n").replace("\\n","\n").replace("\\l","\n");}
    private static List<JsonNode> nodes(JsonNode n) {var out=new ArrayList<JsonNode>();if(n!=null)for(var v:n)out.add(v);return out;}
    private static List<JsonNode> citations(JsonNode n,String game) {return nodes(n.path("citations")).stream().filter(c->applicable(c,game)).toList();}
    private static String unique(Collection<String> values) {var set=new LinkedHashSet<>(values);return set.size()==1?set.iterator().next():null;}
    private static List<String> qids(List<JsonNode> cs) {return cs.stream().map(c->c.path("qid").asText()).filter(s->!s.isEmpty()).distinct().toList();}
    private Result fallback(Unit u,String reason,String id) {return new Result(u,u.raw(),null,"retained_japanese",reason,id,List.of(),List.of(),List.of());}
    private List<JsonNode> lexicalRows(String raw,String kind,String game,boolean typedOnly) {
        var rows=lexical.getOrDefault(project(raw,false).key,List.of()).stream().filter(r->applicable(r,game)).toList();
        if(kind!=null){var typed=rows.stream().filter(r->kind.equals(r.path("kind").asText())).toList();if(typedOnly||!typed.isEmpty())return typed;}
        return rows;
    }
    private List<JsonNode> lexicalEvidence(List<JsonNode> rows) {
        var evidence=new ArrayList<JsonNode>();for(var row:rows)for(var id:row.path("candidateIds")){var source=originalCandidates.get(id.asText());if(source!=null)evidence.add(source);}return List.copyOf(evidence);
    }
    private Result output(Unit u,String chinese,String status,String reason,String id,List<JsonNode> cs,List<Binding> bs,boolean whole) {
        int at=u.raw().indexOf(u.searchText());String out=whole?chinese:u.raw().substring(0,at)+chinese+u.raw().substring(at+u.searchText().length());
        return new Result(u,out,chinese,status,reason,id,List.copyOf(cs),List.copyOf(bs),qids(cs));
    }
    public Name name(String raw,String kind,String game) {
        if(raw==null||raw.isEmpty()||INVALID.matcher(raw).find())return new Name(raw,raw,List.of());
        var rows=lexicalRows(raw,kind,game,false);
        String value=unique(rows.stream().map(r->r.path("chinese").asText()).filter(s->!s.matches(".*[\\\\\\[\\]{}].*")).toList());
        return value==null?new Name(raw,raw,List.of()):new Name(raw,value,lexicalEvidence(rows));
    }
    private Name actorName(String raw,String game) {
        var full=name(raw,null,game);if(!full.sources.isEmpty())return full;
        for(var p:variables.path("battleTemplates").path("actor").path("prefixes")){
            String prefix=p.path("text").asText(),key=project(prefix,true).key;var projection=project(raw,true);
            if(projection.key.startsWith(key)&&projection.key.length()>key.length()){
                int at=projection.offsets.get(key.length());var n=name(raw.substring(at),null,game);
                if(!n.sources.isEmpty())return new Name(raw,raw.substring(0,at)+n.value,n.sources);
            }
        }
        return full;
    }
    public Result lookup(Unit u,String type,String game) {return lookup(u,type,game,true);}
    public Result lookup(Unit u,String type,String game,boolean translateNames) {
        games(game);if(!included.contains(type))return fallback(u,"outside_first_edition",null);
        if(u.searchText().isEmpty()||!u.raw().contains(u.searchText())||INVALID.matcher(u.raw()).find())return fallback(u,"invalid_or_unknown_input",null);
        var rule=rules.get(ruleKey(type,u.searchText(),u.kind()));String id=rule==null?null:rule.path("id").asText();
        var nativeResult=nativeField(u,type,game);if(nativeResult!=null)return nativeResult;
        var meanings=new LinkedHashSet<JsonNode>();
        for(String text:List.of(u.raw(),u.searchText()))for(var p:plans.getOrDefault(ruleKey(type,project(text,true).key,u.kind()),List.of()))
            if(project(p.path("outputMode").asText().equals("whole_unit")?u.raw():u.searchText(),true).key.equals(project(text,true).key))meanings.add(p);
        if(!meanings.isEmpty()) {
            var quotes=new ArrayList<String>();var cs=new ArrayList<JsonNode>();JsonNode first=null;
            for(var p:meanings){var chosen=citations(p,game);if(!games(game).stream().allMatch(g->chosen.stream().anyMatch(c->c.path("game").asText().equals(g))))continue;for(var c:chosen)quotes.add(display(c.path("quote").asText()));cs.addAll(chosen);if(first==null)first=p;}
            String chinese=unique(quotes);if(chinese==null)return fallback(u,"original_semantic_output_conflict",id);
            if(rule!=null&&rule.path("disposition").asText().equals("original_rsc_semantic")&&!rule.path("semanticUnit").asText().equals(first.path("id").asText()))return fallback(u,"semantic_unit_source_conflict",id);
            return output(u,chinese,"original_rsc_semantic_unit","reviewed_original_semantic_unit",id,cs,List.of(),first.path("outputMode").asText().equals("whole_unit"));
        }
        if(rule==null||rule.path("disposition").asText().equals("original_rsc_template")) {
            Bound bound;try{bound=bind(u.searchText(),type,game,translateNames);}catch(MatchingLimit incomplete){return fallback(u,"binding_search_incomplete",id);}
            if(bound!=null&&(rule==null||rule.path("variableFamily").asText().equals(bound.family)))return output(u,bound.output,"original_rsc_bound_template","reviewed_original_template_binding",id,bound.citations,bound.bindings,false);
            if(rule!=null)return fallback(u,"current_variable_binding_not_verified",id);
            // Complete source-backed lexical values may appear beyond the fixed fixtures.
            var lexicalRows=lexicalRows(u.searchText(),u.kind(),game,true);String chinese=unique(lexicalRows.stream().map(r->r.path("chinese").asText()).filter(s->!s.matches(".*[\\\\\\[\\]{}].*")).toList());
            if(chinese!=null)return output(u,display(chinese),"original_rsc_available","unique_original_rsc_source",null,lexicalEvidence(lexicalRows),List.of(),false);
            if(!lexicalRows.isEmpty()){var cs=lexicalEvidence(lexicalRows);return new Result(u,u.raw(),null,"retained_japanese","original_rsc_context_required",null,cs,List.of(),qids(cs));}
            return fallback(u,"no_reviewed_visible_window",null);
        }
        if(!rule.path("disposition").asText().equals("original_rsc_span"))return fallback(u,rule.path("reasonCode").asText(),id);
        var cs=citations(rule,game);String chinese=unique(cs.stream().map(c->display(c.path("quote").asText())).toList());
        if(chinese==null||!games(game).stream().allMatch(g->cs.stream().anyMatch(c->c.path("game").asText().equals(g))))return fallback(u,"original_game_or_wording_conflict",id);
        return output(u,chinese,"original_rsc_visible_span",rule.path("reasonCode").asText(),id,cs,List.of(),false);
    }
    private List<Hit> hits(JsonNode contract,String raw,String game) {
        var p=project(raw,true);var hits=new ArrayList<Hit>();
        for(var t:data.path("generic"))if(t.path("qid").asText().equals(contract.path("qid").asText())&&applicable(t,game)&&window(contract,t)&&t.path("fixed").asDouble()/Math.max(1,p.key.length())>=.25) {
            var work=new int[2];enumerate(t,t.path("tokens"),0,0,p,raw,new ArrayList<>(),new HashMap<>(),hits,work,false,contract.path("qid").asText(),0);
            if(work[0]>4096)throw new MatchingLimit();
        }
        for(var m:data.path("battle")) {
            String qid=contract.path("qid").asText();if(!nodes(m.path("sourceQids")).stream().anyMatch(n->n.asText().equals(qid)))continue;
            var w=m.path("sourceWindow");if(w.isMissingNode()){var n=JsonNodeFactory.instance.objectNode();n.put("page",0).put("lineStart",0).put("lineCount",raw.split("\n",-1).length);w=n;}
            if(!window(contract,w))continue;boolean mismatch=false;for(var it=contract.path("conditions").fields();it.hasNext();){var e=it.next();if(m.path("meaning").has(e.getKey())&&!m.path("meaning").get(e.getKey()).equals(e.getValue()))mismatch=true;}if(mismatch)continue;
            var work=new int[2];enumerate(m,m.path("tokens"),0,0,p,raw,new ArrayList<>(),new HashMap<>(),hits,work,true,qid,0);
            if(work[0]>10000)throw new MatchingLimit();
        }
        return hits;
    }
    private static boolean window(JsonNode c,JsonNode t) {
        var windows=c.has("windows")?nodes(c.get("windows")):List.of(c.path("window"));
        return windows.stream().anyMatch(w->w.path("page").asInt()==t.path("page").asInt()&&w.path("lineStart").asInt()==t.path("lineStart").asInt()&&w.path("lineCount").asInt()==t.path("lineCount").asInt());
    }
    private void enumerate(JsonNode model,JsonNode tokens,int index,int offset,Projection p,String raw,List<Capture> captures,Map<String,JsonNode> typed,List<Hit> out,int[] work,boolean battle,String qid,int ignored) {
        if(++work[0]>(battle?10000:4096)||work[1]>=(battle?32:16)){work[0]=Integer.MAX_VALUE/2;return;}
        if(index==tokens.size()) {
            if(offset!=p.key.length())return;work[1]++;var meaning=model.path("meaning").isObject()?((ObjectNode)model.get("meaning")).deepCopy():JsonNodeFactory.instance.objectNode();typed.forEach(meaning::set);
            var mapped=new ArrayList<Capture>();for(var c:captures)mapped.add(new Capture(model.path("sourceSlotMaps").path(qid).path(c.slot).asText(c.slot),c.raw,c.start,c.end));
            var w=battle?model.path("sourceWindow"):model;out.add(new Hit(qid,w.path("page").asInt(),w.path("lineStart").asInt(),w.path("lineCount").asInt(raw.split("\n",-1).length),mapped,meaning,model));return;
        }
        var t=tokens.get(index);String literal=battle?t.path("type").asText().equals("literal")?t.path("key").asText():null:nullable(t.get("literal"));
        if(literal!=null){
            if(!p.key.startsWith(literal,offset))return;
            if(battle)for(var b:t.path("lineBreaks")){int at=offset+b.asInt();if(at<=0||at>=p.key.length()||!raw.substring(p.offsets.get(at-1)+1,p.offsets.get(at)).matches("(?s).*[\\r\\n].*"))return;}
            enumerate(model,tokens,index+1,offset+literal.length(),p,raw,captures,typed,out,work,battle,qid,0);return;
        }
        int max=battle?t.path("type").asText().equals("number")?t.path("maxDigits").asInt():t.path("maxCharacters").asInt(14):64;
        if(battle&&t.path("type").asText().equals("choice"))max=nodes(t.path("choices")).stream().mapToInt(c->c.path("key").asText().length()).max().orElse(0);
        for(int end=offset+1;end<=Math.min(p.key.length(),offset+max);end++) {
            String value=p.key.substring(offset,end);int a=p.offsets.get(offset),b=p.offsets.get(end-1)+1;String observed=raw.substring(a,b),slot=t.path("slot").asText();
            var extra=new HashMap<>(typed);var typedOptions=new ArrayList<Map<String,JsonNode>>();typedOptions.add(extra);boolean valid=true;
            if(observed.contains("�")||observed.contains("\uE000")||observed.contains("\uE001"))continue;
            if(battle) {
                String kind=t.path("type").asText();
                if(kind.equals("choice")) {
                    var choices=nodes(t.path("choices")).stream().filter(c->c.path("key").asText().equals(value)).toList();if(choices.isEmpty()||observed.contains("\n")||observed.contains("\r"))continue;
                    typedOptions.clear();for(var choice:choices){var branch=new HashMap<>(typed);for(var fields=choice.path("meaning").fields();fields.hasNext();){var e=fields.next();branch.put(e.getKey(),e.getValue());}typedOptions.add(branch);}
                } else if(kind.equals("number")) {
                    if(!value.matches("0|[1-9][0-9]*")||!observed.matches("[0-9０-９]+"))continue;
                    extra.put(t.path("field").asText(),JsonNodeFactory.instance.numberNode(Long.parseLong(value)));
                } else {
                    if(observed.contains("\n")||observed.contains("\r")||value.chars().anyMatch(c->allowed.indexOf(c)<0))continue;
                    String name=value;if(t.path("parsePrefix").asBoolean(true))for(var prefix:variables.path("battleTemplates").path("actor").path("prefixes")){String k=project(prefix.path("text").asText(),true).key;if(value.startsWith(k)&&value.length()>k.length()){name=value.substring(k.length());break;}}
                    if(name.length()>t.path("maxCharacters").asInt(10))continue;
                }
            } else {
                if(t.path("singleLine").asBoolean()&&(observed.contains("\n")||observed.contains("\r")))continue;
                if(t.has("choices")&&!nodes(t.get("choices")).stream().anyMatch(c->c.asText().equals(value)))continue;
                if(t.has("terms")&&(observed.contains("\n")||observed.contains("\r")||nodes(t.get("terms")).stream().noneMatch(c->applicable(c,"both")&&c.path("key").asText().equals(value))))continue;
            }
            for(var c:captures)if(c.slot.equals(slot)&&!c.raw.replace("\n","").replace("\r","").equals(observed.replace("\n","").replace("\r","")))valid=false;
            if(!valid)continue;
            var next=new ArrayList<>(captures);next.add(new Capture(slot,observed,a,b));for(var option:typedOptions)enumerate(model,tokens,index+1,end,p,raw,next,option,out,work,battle,qid,0);
            if(work[0]>10000){out.clear();return;}
        }
    }
    private Bound bind(String raw,String type,String game,boolean translateNames) {
        if(raw.length()>512)return null;var results=new ArrayList<Bound>();
        for(var f:contracts.getOrDefault(type,List.of()))for(var hit:hits(f,raw,game)) {
            boolean valid=true;for(var it=f.path("conditions").fields();it.hasNext();){var e=it.next();if(!Objects.equals(hit.meaning.get(e.getKey()),e.getValue()))valid=false;}
            if(f.has("equivalentWording")&&!hit.meaning.path("event").asText().equals(f.path("equivalentWording").path("event").asText()))valid=false;if(!valid)continue;
            var outputs=new LinkedHashMap<String,String>();var allCs=new ArrayList<JsonNode>();var allBindings=new ArrayList<Binding>();
            for(String g:games(game)) {
                var bindings=new LinkedHashMap<String,Binding>();
                for(var it=f.path("bindings").fields();it.hasNext();){var e=it.next();var b=value(e.getKey(),e.getValue(),hit,raw,g,translateNames);if(b==null){valid=false;break;}bindings.put(e.getKey(),b);}
                if(!valid)break;var cs=citations(f,g);String chinese=unique(cs.stream().map(c->render(c.path("quote").asText(),bindings)).toList());if(chinese==null){valid=false;break;}
                outputs.put(g,chinese);allCs.addAll(cs);allBindings.addAll(bindings.values());
            }
            if(valid) {
                String chinese=unique(outputs.values());if(chinese==null&&game.equals("both")&&f.has("equivalentWording"))chinese=outputs.get(f.path("equivalentWording").path("selection").asText());
                if(chinese!=null)results.add(new Bound(chinese,allCs,allBindings,f.path("id").asText()));
            }
        }
        if(unique(results.stream().map(Bound::output).toList())==null)return null;
        var first=results.getFirst();return new Bound(first.output,results.stream().flatMap(r->r.citations.stream()).distinct().toList(),results.stream().flatMap(r->r.bindings.stream()).distinct().toList(),first.family);
    }
    private Binding value(String token,JsonNode spec,Hit c,String raw,String game,boolean translateNames) {
        String from=spec.path("from").asText(),slot=spec.path("slot").asText();
        if(from.equals("capture")||from.equals("lexical_capture")) {
            var matches=c.captures.stream().filter(b->b.slot.equals(slot)).distinct().toList();if(matches.size()!=1)return null;var b=matches.getFirst();
            if(b.start<0||b.end>raw.length()||!raw.substring(b.start,b.end).equals(b.raw)||b.raw.matches("(?s).*[\\r\\n\\[\\]{}\\\\�].*"))return null;
            if(from.equals("lexical_capture"))return termBinding(token,slot,b.raw,b.start,b.end,game,spec.path("kind").asText(),null,spec.path("allowedQids"));
            String category=spec.path("category").asText();int length=b.raw.replace(" ","").replace("　","").codePointCount(0,b.raw.replace(" ","").replace("　","").length());
            if(category.equals("number")){if(!b.raw.matches("[0-9０-９]{1,5}"))return null;}
            else if(category.equals("honorific")){if(!Set.of("くん","ちゃん").contains(b.raw))return null;}
            else {
                int prefix=0;if(category.equals("actor"))for(var p:variables.path("battleTemplates").path("actor").path("prefixes")){String k=project(p.path("text").asText(),true).key;if(project(b.raw,true).key.startsWith(k)){prefix=k.length();break;}}
                if(length-prefix<1||length-prefix>(category.equals("player")?5:category.equals("display_term")?16:10)||b.raw.chars().anyMatch(ch->allowed.indexOf(ch)<0))return null;
            }
            var n=translateNames&&Set.of("actor","player").contains(category)?actorName(b.raw,game):new Name(b.raw,b.raw,List.of());
            return new Binding(token,slot,b.raw,n.value,b.start,b.end,slot.equals("PLAYER")?"current_frame":"current_value",n.sources);
        }
        if(from.equals("normal_experience_empty"))return c.meaning.path("event").asText().equals("experience_gain")&&!c.meaning.path("boostedWording").asBoolean(true)?new Binding(token,"","","",-1,-1,"native_normal_component",List.of()):null;
        String qid=null,kind=spec.path("kind").asText();
        if(from.equals("meaning_term"))qid=nullable(c.meaning.get(spec.path("field").asText()));
        if(from.equals("model_component")&&c.meaning.path("event").asText().equals("stat_change")&&Math.abs(c.meaning.path("delta").asInt())==1&&c.model.path("componentSources").size()==2){qid=c.model.path("componentSources").get(spec.path("index").asInt()).asText();kind="original_component";}
        return qid==null?null:termBinding(token,"",null,-1,-1,game,kind,qid,null);
    }
    private Binding termBinding(String token,String slot,String raw,int start,int end,String game,String kind,String qid,JsonNode allowedQids) {
        var ts=nodes(variables.path("terms")).stream().filter(t->t.path("game").asText().equals(game)&&t.path("kind").asText().equals(kind)&&(qid==null?project(t.path("japanese").asText(),true).key.equals(project(raw,true).key):t.path("qid").asText().equals(qid))&&(allowedQids==null||allowedQids.isMissingNode()||nodes(allowedQids).stream().anyMatch(q->q.asText().equals(t.path("qid").asText())))).toList();
        String value=unique(ts.stream().map(t->t.path("chinese").asText()).toList());if(value==null)return null;
        return new Binding(token,slot,raw,value,start,end,"source_term",ts.stream().flatMap(t->nodes(t.path("citations")).stream()).toList());
    }
    private static String render(String quote,Map<String,Binding> values) {
        var out=new StringBuilder();var matcher=TOKEN.matcher(quote);int at=0;
        while(matcher.find()){out.append(display(quote.substring(at,matcher.start())));var b=values.get(matcher.group());if(b==null)return null;out.append(b.value);at=matcher.end();}
        return out.append(display(quote.substring(at))).toString();
    }
    private Result nativeField(Unit u,String type,String game) {
        if(u.raw().contains("\n")||u.raw().contains("\r"))return null;var p=project(u.raw(),true);var results=new ArrayList<Result>();
        for(var f:visible.path("nativeFields").path("fields")) {
            if(!f.path("type").asText().equals(type))continue;String op=f.path("operation").asText(),source=project(f.path("source").path("japanese").asText().replaceAll("\\[(?:PALETTE [0-9]+)\\]",""),true).key;
            String observed=null;JsonNode location=null;int a=-1,b=-1;
            if(op.equals("original_location_then_literal")){
                int at=source.indexOf("[STR_VAR_1]");if(at<0)continue;String before=source.substring(0,at),after=source.substring(at+11);if(!p.key.startsWith(before)||!p.key.endsWith(after)||p.key.length()<=before.length()+after.length())continue;
                a=before.length();b=p.key.length()-after.length();String k=p.key.substring(a,b);for(var l:f.path("locations"))if(project(l.path("japanese").asText(),true).key.equals(k))location=l;if(location==null)continue;
            }else if(op.equals("overwrite_original_final_two_zeroes")){
                int at=source.indexOf("00");if(at<0||!p.key.startsWith(source.substring(0,at))||!p.key.endsWith(source.substring(at+2)))continue;a=at;b=p.key.length()-(source.length()-at-2);if(b<=a||!p.key.substring(a,b).matches("[1-9][0-9]?"))continue;
            }else if(op.equals("original_level_marker_value_comma")){
                if(!p.key.startsWith("Lv")||!p.key.endsWith(source))continue;a=2;b=p.key.length()-source.length();if(b<=a||!p.key.substring(a,b).matches("[1-9][0-9]?|100"))continue;
            }else {if(!p.key.startsWith(source))continue;a=source.length();b=p.key.length();if(b<=a||!p.key.substring(a,b).matches("0|[1-9][0-9]{0,9}"))continue;}
            if(a<0||b<=a||b>p.offsets.size())continue;observed=u.raw().substring(p.offsets.get(a),p.offsets.get(b-1)+1);if(location==null&&!observed.matches("[0-9０-９]+"))continue;
            var outputs=new ArrayList<String>();var cs=new ArrayList<JsonNode>();boolean valid=true;
            for(String g:games(game)){
                var quotes=citations(f,g);var places=location==null?List.<JsonNode>of():citations(location,g);String quote=unique(quotes.stream().map(c->c.path("quote").asText()).toList()),place=unique(places.stream().map(c->c.path("quote").asText()).toList());
                if((op.equals("original_location_then_literal")||op.equals("overwrite_original_final_two_zeroes"))&&quote==null||location!=null&&place==null){valid=false;break;}
                outputs.add(op.equals("original_location_then_literal")?place+quote:op.equals("overwrite_original_final_two_zeroes")?quote.substring(0,quote.length()-2)+observed:op.equals("original_level_marker_value_comma")?"Lv"+observed+f.path("source").path("english").asText():observed);cs.addAll(quotes);cs.addAll(places);
            }
            String chinese=unique(outputs);if(valid&&chinese!=null)results.add(output(u,chinese,"original_rsc_native_field","reviewed_original_native_printing",f.path("id").asText(),cs,List.of(),true));
        }
        return unique(results.stream().map(Result::output).toList())==null?null:results.getFirst();
    }
}
