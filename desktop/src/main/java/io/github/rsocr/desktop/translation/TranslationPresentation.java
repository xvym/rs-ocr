package io.github.rsocr.desktop.translation;

import io.github.rsocr.desktop.Presentation.*;
import java.util.*;

/** Replace only each unit's observed text allocation; keep raw OCR and native geometry. */
public final class TranslationPresentation {
    private record Span(Run run,int start,int end) {}
    public List<Panel> apply(List<Panel> panels,TranslationSession.Frame frame) {
        if(frame==null)return panels;var result=new ArrayList<Panel>();
        for(var p:panels) {
            var r=frame.regions().stream().filter(v->v.key().equals(p.key())||v.key().startsWith(p.key()+"|")).filter(v->v.raw().equals(p.raw())).findFirst().orElse(null);
            if(r==null||p.status().equals("pending")){result.add(p);continue;}
            var spans=new ArrayList<Span>();int cursor=0;
            // Sprite recognition may be appended before the row's grid characters
            // (e.g. SEL at the far right). Map spans in observed reading order.
            for(var run:p.runs().stream().sorted(Comparator.comparingDouble(Run::y).thenComparingDouble(Run::x)).toList()) {
                if(run.raw().isBlank())continue;int at=p.raw().indexOf(run.raw(),cursor);
                if(at<0)continue;spans.add(new Span(run,at,at+run.raw().length()));cursor=at+run.raw().length();
            }
            var hidden=new HashSet<Run>();var blocks=new ArrayList<TextBlock>();
            for(var u:r.units())if(u.translated()) {
                boolean whole=u.status().equals("original_rsc_native_field")||!u.output().equals(u.unit().raw().replace(u.unit().searchText(),u.chinese()));
                int start=u.unit().start()+(whole?0:u.unit().raw().indexOf(u.unit().searchText())),end=whole?u.unit().end():start+u.unit().searchText().length();
                var owned=spans.stream().filter(s->s.start>=start&&s.end<=end).toList();if(owned.isEmpty())continue;
                double x=owned.stream().mapToDouble(s->s.run.x()).min().orElseThrow(),y=owned.stream().mapToDouble(s->s.run.y()).min().orElseThrow();
                double bottom=owned.stream().mapToDouble(s->s.run.y()+s.run.height()).max().orElseThrow();
                double right=p.clip().x()+p.clip().width()-2;
                // Another field on the same observed row is a hard column boundary.
                for(var s:spans)if((s.end<=start||s.start>=end)&&s.run.y()>=y&&s.run.y()<bottom&&s.run.x()>x)right=Math.min(right,s.run.x()-2);
                if(right<=x)continue;for(var s:owned)hidden.add(s.run);
                blocks.add(new TextBlock(new Box(x,y,right-x,Math.min(bottom,p.clip().y()+p.clip().height())-y),u.chinese()));
            }
            result.add(new Panel(p.key(),p.name(),p.clip(),p.frame(),p.order(),p.raw(),p.status(),p.runs().stream().filter(run->!hidden.contains(run)).toList(),p.pointers(),p.selections(),List.copyOf(blocks)));
        }
        return List.copyOf(result);
    }
}
