package io.github.rsocr.desktop.translation;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.github.rsocr.OcrEngine;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;

/** Diagnostic entry point for checking the packaged interpreter without a GUI or checkout. */
public final class TranslationCli {
    public static void main(String[] args) throws Exception {
        var json=new ObjectMapper();var engine=new TranslationEngine(json);var session=new TranslationSession(engine);
        try(var input=new BufferedReader(new InputStreamReader(System.in,StandardCharsets.UTF_8));var output=new PrintWriter(new OutputStreamWriter(System.out,StandardCharsets.UTF_8),true)) {
            String line;
            while((line=input.readLine())!=null) {
                if(line.isBlank())continue;var request=json.readTree(line);session.configure(request.path("game").asText("both"),request.path("player").asText(""));if(request.path("restart").asBoolean())session.reset();
                var types=new ArrayList<String>();if(request.has("types"))for(var type:request.get("types"))types.add(type.asText());else types.add(request.path("type").asText("field_dialog"));
                var region=new OcrEngine.Region(types,"diagnostic",new int[]{0,0,240,160},1,request.path("japanese").asText(),"recognized",List.of());
                output.println(json.writeValueAsString(session.translate(List.of(region))));
            }
        }
    }
}
