package io.github.rsocr.desktop.capture;

import io.github.rsocr.Normalizer;
import java.awt.image.BufferedImage;
import java.util.*;

/** Window/client bounds are hypotheses; only matching image features accept automatic calibration. */
public record LiveMapping(Normalizer.Viewport viewport,double gain,int width,int height,int dpi,boolean manual) {
    public static LiveMapping automatic(WindowCapture.Poll poll,int profile,LiveLayout layout) {
        var candidates=new ArrayList<LiveMapping>();var image=poll.image();
        var hints=new ArrayList<>(poll.clientHints());hints.add(new WindowCapture.Bounds(0,0,image.getWidth(),image.getHeight()));
        for(var b:hints) {
            if(b.x()<0 || b.y()<0 || b.x()+b.width()>image.getWidth() || b.y()+b.height()>image.getHeight())continue;
            if(profile!=2 && b.width()>=240 && b.height()>=160 && b.width()*2==b.height()*3)
                candidates.add(new LiveMapping(new Normalizer.Viewport(b.x(),b.y(),b.width(),b.height()),.984,image.getWidth(),image.getHeight(),poll.dpi(),false));
            if(profile!=1 && profile!=3 && b.width()==1600 && b.height()==1200)
                candidates.add(new LiveMapping(new Normalizer.Viewport(b.x()+212,b.y()+200,1168,800),.82,image.getWidth(),image.getHeight(),poll.dpi(),false));
        }
        LiveMapping best=null;double bestScore=0;
        for(var candidate:candidates.stream().distinct().toList()) {
            var normalized=Normalizer.normalize(image,candidate.viewport());var regions=layout.locate(normalized,candidate.gain());
            double score=regions.stream().mapToDouble(r->r.detectionScore()).max().orElse(0);
            if(score>bestScore){bestScore=score;best=candidate;}
        }
        return best;
    }
    public boolean matches(WindowCapture.Poll poll) {return width==poll.image().getWidth() && height==poll.image().getHeight() && dpi==poll.dpi();}
}
