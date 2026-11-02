package io.github.rsocr;

import com.fasterxml.jackson.databind.*;
import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.nio.file.*;
import java.security.MessageDigest;
import java.util.*;

/** PNG -> calibrated pixels -> region detection -> raw Japanese. No reference input. */
public final class Main {
    public static void main(String[] args) {
        try { run(args); }
        catch(Exception e) { System.err.println(e.getMessage());System.exit(2); }
    }

    private static void run(String[] args) throws Exception {
        var options=new HashMap<String,String>();
        for(int i=0;i<args.length;i++) {
            if(args[i].equals("--help")) { usage();return; }
            if(!Set.of("--image","--directory","--profile","--viewport","--out","--normalized","--color-gain").contains(args[i]) || i+1>=args.length)
                throw new IllegalArgumentException("未知参数或缺少参数值："+args[i]);
            if(options.put(args[i],args[++i])!=null)throw new IllegalArgumentException("参数重复："+args[i-1]);
        }
        if(options.containsKey("--image")==options.containsKey("--directory")) throw new IllegalArgumentException("请指定 --image 或 --directory。");
        if(options.containsKey("--profile")==options.containsKey("--viewport")) throw new IllegalArgumentException("请指定 --profile 或 --viewport。");
        var mapper=new ObjectMapper();
        var engine=new OcrEngine(mapper);
        List<Path> files;
        if(options.containsKey("--image")) files=List.of(Path.of(options.get("--image")));
        else try(var stream=Files.list(Path.of(options.get("--directory")))) {
            files=stream.filter(p->p.getFileName().toString().toLowerCase(Locale.ROOT).endsWith(".png")).sorted().toList();
        }
        if(files.isEmpty())throw new IllegalArgumentException("输入目录中没有 PNG。");
        var frames=new ArrayList<Map<String,Object>>();
        for(var path:files) {
            long start=System.nanoTime();
            BufferedImage input=ImageIO.read(path.toFile());
            if(input==null)throw new IllegalArgumentException("无法读取图像："+path);
            Normalizer.Viewport viewport;
            if(options.containsKey("--viewport")) {
                var parts=options.get("--viewport").split(",",-1);
                if(parts.length!=4)throw new IllegalArgumentException("--viewport 使用 x,y,width,height。");
                viewport=new Normalizer.Viewport(Double.parseDouble(parts[0]),Double.parseDouble(parts[1]),Double.parseDouble(parts[2]),Double.parseDouble(parts[3]));
            } else viewport=Normalizer.preset(options.get("--profile"),input);
            var normalized=Normalizer.normalize(input,viewport);
            double gain=Double.parseDouble(options.getOrDefault("--color-gain","ngc-capture".equals(options.get("--profile"))?"0.82":"0.984"));
            if(!Double.isFinite(gain) || gain<=0 || gain>2)throw new IllegalArgumentException("color-gain 必须在 0 到 2 之间。");
            var regions=engine.recognize(normalized,gain);
            var frame=new LinkedHashMap<String,Object>();
            frame.put("source",path.toString().replace('\\','/'));frame.put("viewport",viewport);
            frame.put("sourceSha256",HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(Files.readAllBytes(path))));
            frame.put("colorGain",gain);
            frame.put("regions",regions);frame.put("elapsedMs",(System.nanoTime()-start)/1_000_000.0);frames.add(frame);
            if(options.containsKey("--normalized")) {
                var dir=Path.of(options.get("--normalized"));Files.createDirectories(dir);
                ImageIO.write(normalized,"PNG",dir.resolve(path.getFileName()).toFile());
            }
        }
        var output=new LinkedHashMap<String,Object>();
        output.put("schemaVersion",1);output.put("engineVersion","0.1.0");output.put("frames",frames);
        var executable=Path.of(Main.class.getProtectionDomain().getCodeSource().getLocation().toURI());
        if(Files.isRegularFile(executable))output.put("engineSha256",HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(Files.readAllBytes(executable))));
        String json=mapper.writerWithDefaultPrettyPrinter().writeValueAsString(output)+"\n";
        if(options.containsKey("--out")) {
            var out=Path.of(options.get("--out")).toAbsolutePath();Files.createDirectories(out.getParent());Files.writeString(out,json);
        } else System.out.print(json);
    }

    private static void usage() {
        System.out.println("rs-ocr --image <PNG> | --directory <目录> --profile native|gba-5x|ngc-capture --out <JSON> [--normalized <目录>]");
        System.out.println("自定义视口：用 --viewport x,y,width,height 替代 --profile。识别仅使用图片和内置字形。 ");
    }
}
