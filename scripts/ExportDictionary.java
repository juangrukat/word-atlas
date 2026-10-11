import java.io.*;
import java.lang.reflect.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import org.apache.lucene.index.av;
import org.apache.lucene.store.xm;
import org.apache.lucene.document.hr;
import org.apache.lucene.document.mr;

/** Reads stored records with the bundled read-only reader; never launches the app. */
public class ExportDictionary {
    static String quote(String value) {
        StringBuilder out = new StringBuilder("\"");
        for (int i = 0; i < value.length(); i++) {
            char c = value.charAt(i);
            if (c == '"' || c == '\\') out.append('\\').append(c);
            else if (c < 32) out.append(String.format("\\u%04x", (int)c));
            else out.append(c);
        }
        return out.append('"').toString();
    }
    public static void main(String[] args) throws Exception {
        Field fields = hr.class.getDeclaredField("p");
        fields.setAccessible(true);
        av reader = av.p(xm.p(new File(args[0])), true);
        try (PrintWriter out = new PrintWriter(new BufferedWriter(new OutputStreamWriter(new FileOutputStream(args[1]), StandardCharsets.UTF_8)))) {
            System.err.println("Records: " + reader.A());
            for (int i = 0; i < reader.A(); i++) {
                if (reader.v(i)) continue;
                hr doc = reader.p(i);
                Map<String,List<String>> values = new LinkedHashMap<>();
                for (Object raw : (List<?>)fields.get(doc)) {
                    mr field = (mr)raw;
                    if (!field.isBinary()) values.computeIfAbsent(field.name(), k -> new ArrayList<>()).add(field.h());
                }
                StringJoiner obj = new StringJoiner(",", "{", "}");
                for (Map.Entry<String,List<String>> e : values.entrySet()) {
                    StringJoiner arr = new StringJoiner(",", "[", "]");
                    for (String s : e.getValue()) arr.add(quote(s));
                    obj.add(quote(e.getKey()) + ":" + arr);
                }
                out.println(obj);
            }
            if (out.checkError()) throw new IOException("Export write failed");
        } finally { reader.hd(); }
    }
}
