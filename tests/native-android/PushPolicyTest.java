package ru.poputi.app;

import static org.junit.Assert.*;
import org.junit.Test;

/** Exercises production policy without Android, providers, credentials or network. */
public class PushPolicyTest {
    @Test public void onlyCurrentOptedInAccountReceivesNotification() {
        assertTrue(PoPutiPushPolicy.accepts("account-a", "account-a", true, true));
        assertFalse(PoPutiPushPolicy.accepts("account-b", "account-a", true, true));
        assertFalse(PoPutiPushPolicy.accepts("account-a", "account-a", false, true));
        assertFalse(PoPutiPushPolicy.accepts("account-a", "account-a", true, false));
        assertFalse(PoPutiPushPolicy.accepts(null, null, true, true));
        assertFalse(PoPutiPushPolicy.accepts("", "", true, true));
        assertFalse(PoPutiPushPolicy.accepts(" ", " ", true, true));
        assertFalse(PoPutiPushPolicy.accepts("account-a", null, true, true));
        assertFalse(PoPutiPushPolicy.accepts("account-a", "account-a\n", true, true));
    }

    @Test public void navigationAcceptsOnlyAuthenticatedApplicationRoutes() {
        for (String path : new String[]{"/notifications", "/complaints", "/admin", "/ride/ride-123", "/reviews/user_123", "/chat/ride-123/user_123"}) {
            assertEquals(path, PoPutiPushPolicy.safePath(path));
        }
        for (String path : new String[]{null, "", "https://attacker.invalid/ride/a", "//attacker.invalid", "javascript:alert(1)", "file:///data", "/login", "/profile", "/ride/", "/ride/../admin", "/ride/a?redirect=https://attacker.invalid", "/ride/a#fragment", "/ride/a%2fadmin", "/chat/a/b/c", "/chat/a/b\n", "/ride/a\u0000", "/admin/"}) {
            assertEquals("/notifications", PoPutiPushPolicy.safePath(path));
        }
    }

    @Test public void notificationIdentifiersCannotCarryPathsOrOversizedData() {
        assertTrue(PoPutiPushPolicy.validNotificationId("note_a-123"));
        assertTrue(PoPutiPushPolicy.validNotificationId(repeatedA(100)));
        for (String id : new String[]{null, "", repeatedA(101), "../note", "note/a", "note?a", "note\n", "note\u0000", "уведомление"}) {
            assertFalse(PoPutiPushPolicy.validNotificationId(id));
        }
    }

    private static String repeatedA(int length) {
        StringBuilder result = new StringBuilder();
        for (int i=0; i<length; i++) result.append('a');
        return result.toString();
    }
}
