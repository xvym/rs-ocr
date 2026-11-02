package io.github.rsocr;

import java.awt.image.BufferedImage;

/** Explicit capture calibration. No testcase names, labels, or state hints. */
public final class Normalizer {
    public record Viewport(double x, double y, double width, double height) {
        public Viewport {
            if (!Double.isFinite(x+y+width+height) || x<0 || y<0 || width<240 || height<160)
                throw new IllegalArgumentException("视口必须是有效的 x,y,width,height，至少 240×160。");
        }
    }

    public static Viewport preset(String profile, BufferedImage image) {
        return switch (profile) {
            case "native" -> {
                if (image.getWidth()!=240 || image.getHeight()!=160)
                    throw new IllegalArgumentException("native 输入必须是 240×160。");
                yield new Viewport(0,0,240,160);
            }
            case "gba-5x" -> {
                if (image.getWidth()!=1200 || image.getHeight()!=800)
                    throw new IllegalArgumentException("gba-5x 输入必须是 1200×800。");
                yield new Viewport(0,0,1200,800);
            }
            case "ngc-capture" -> {
                if (image.getWidth()!=1600 || image.getHeight()!=1200)
                    throw new IllegalArgumentException("ngc-capture 输入必须是 1600×1200。");
                yield new Viewport(212,200,1168,800);
            }
            default -> throw new IllegalArgumentException("未知图像配置："+profile);
        };
    }

    public static BufferedImage normalize(BufferedImage source, Viewport viewport) {
        if (viewport.x()+viewport.width()>source.getWidth() || viewport.y()+viewport.height()>source.getHeight())
            throw new IllegalArgumentException("视口超出输入图像。");
        var result=new BufferedImage(240,160,BufferedImage.TYPE_INT_RGB);
        for(int y=0;y<160;y++) for(int x=0;x<240;x++) {
            int sx=(int)Math.floor(viewport.x()+(x+.5)*viewport.width()/240);
            int sy=(int)Math.floor(viewport.y()+(y+.5)*viewport.height()/160);
            result.setRGB(x,y,source.getRGB(sx,sy));
        }
        return result;
    }
}
