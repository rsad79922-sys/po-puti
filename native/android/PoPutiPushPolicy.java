package ru.poputi.app;

/** Pure policy shared by native notification display and authenticated navigation. */
public final class PoPutiPushPolicy {
    private PoPutiPushPolicy() {}

    public static String safePath(String path) {
        if (path != null && path.matches("/(?:chat/[a-zA-Z0-9_-]+/[a-zA-Z0-9_-]+|ride/[a-zA-Z0-9_-]+|reviews/[a-zA-Z0-9_-]+|notifications|complaints|admin)")) {
            return path;
        }
        return "/notifications";
    }

    public static boolean accepts(String expectedRecipient, String incomingRecipient, boolean optedIn, boolean sessionMatches) {
        return optedIn && sessionMatches && expectedRecipient != null
            && !expectedRecipient.trim().isEmpty() && expectedRecipient.equals(incomingRecipient);
    }

    public static boolean validNotificationId(String id) {
        return id != null && id.matches("[a-zA-Z0-9_-]{1,100}");
    }
}
