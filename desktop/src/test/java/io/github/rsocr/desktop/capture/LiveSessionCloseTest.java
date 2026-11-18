package io.github.rsocr.desktop.capture;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class LiveSessionCloseTest {
    @Test void repeatedClosureIsSafeAndInvalidatesTheActiveSession() throws Exception {
        var live=new LiveSession(new ObjectMapper(),ignored->{});long before=live.session();
        live.close();assertTrue(live.session()>before);long closed=live.session();
        assertDoesNotThrow(live::close);assertEquals(closed,live.session());
    }
}
