package com.oattrades.messages;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ShortcutInfo;
import android.content.pm.ShortcutManager;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.os.Build;
import android.os.PowerManager;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Scanner;

/**
 * Checks the Messages inbox once and turns every new alert into a real Android notification that
 * looks like Google Messages (sender, "Messages" label, full text, Mark as read). Driven by a
 * repeating alarm (PollReceiver), so there is no service and nothing permanent in the shade.
 */
public class NotifyService {
    static final String PREFS = "msgs_native";
    // Bammi, 2026-11-23: banners were ON in the app settings yet no banner appeared, which means
    // the channel itself had been lowered (Android locks a channel's importance once it exists and
    // an app can never raise it again). A brand new channel id is created fresh at HIGH, so the
    // heads-up banner works again no matter what the old channel was set to.
    static final String CH_MSG = "messages_alerts_v3";      // HIGH: heads-up banner + expanded peek
    static final String CH_MSG_OLD = "messages_incoming_v2";
    static final String CH_MSG_OLD2 = "messages_incoming";
    static final String CH_OLD = "messages_service";
    static final String API = "https://wallet-masters.onrender.com";
    static final String ACTION_READ = "com.oattrades.messages.MARK_READ";
    static final String EXTRA_SENDER = "sender";
    static final long INTERVAL_MS = 10_000L;   // Bammi: alert must land within ~20s of approval

    /** Arms (or re-arms) the repeating check. Safe to call any number of times. */
    public static void start(Context c) {
        SharedPreferences sp = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        if (sp.getString("uid", "").isEmpty()) return;
        schedule(c, 3000L);
        armBackup(c);
    }

    static PendingIntent alarmIntent(Context c) {
        Intent i = new Intent(c, PollReceiver.class).setAction("com.oattrades.messages.POLL");
        int fl = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0);
        return PendingIntent.getBroadcast(c, 4002, i, fl);
    }

    static void schedule(Context c, long delayMs) {
        schedule(c, delayMs, false);
    }

    /**
     * delayMs until the next check. precise = the moment a known alert becomes due, which is
     * armed as an alarm-clock alarm: those are exempt from Doze, so a closed app still posts the
     * notification on time (Bammi, 2026-11-22). The alarm icon only appears during that window.
     */
    static void schedule(Context c, long delayMs, boolean precise) {
        try {
            android.app.AlarmManager am = (android.app.AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
            if (am == null) return;
            long at = System.currentTimeMillis() + Math.max(500L, delayMs);
            PendingIntent pi = alarmIntent(c);
            boolean exact = Build.VERSION.SDK_INT < 31 || am.canScheduleExactAlarms();
            if (precise && Build.VERSION.SDK_INT >= 21) {
                Intent show = new Intent(c, MainActivity.class);
                int fl = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0);
                PendingIntent showPi = PendingIntent.getActivity(c, 4003, show, fl);
                am.setAlarmClock(new android.app.AlarmManager.AlarmClockInfo(at, showPi), pi);
            } else if (Build.VERSION.SDK_INT >= 23 && exact) {
                am.setExactAndAllowWhileIdle(android.app.AlarmManager.RTC_WAKEUP, at, pi);
            } else if (Build.VERSION.SDK_INT >= 23) {
                am.setAndAllowWhileIdle(android.app.AlarmManager.RTC_WAKEUP, at, pi);
            } else {
                am.set(android.app.AlarmManager.RTC_WAKEUP, at, pi);
            }
        } catch (Exception ignored) {}
    }

    /** Backup heartbeat (Bammi, 2026-11-22): the 10 second chain is a single shot alarm that
     *  re-arms itself, so if Android kills the process right after one fires, the chain dies and
     *  nothing arrives until the app is opened. This repeating alarm revives it, so an alert can
     *  never sit waiting for the user to open the app. */
    static void armBackup(Context c) {
        try {
            android.app.AlarmManager am = (android.app.AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
            if (am == null) return;
            Intent i = new Intent(c, PollReceiver.class).setAction("com.oattrades.messages.POLL_BACKUP");
            int fl = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0);
            PendingIntent pi = PendingIntent.getBroadcast(c, 4003, i, fl);
            am.setInexactRepeating(android.app.AlarmManager.RTC_WAKEUP,
                System.currentTimeMillis() + 60_000L, 15 * 60_000L, pi);
        } catch (Exception ignored) {}
    }

    static void cancel(Context c) {
        try {
            android.app.AlarmManager am = (android.app.AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
            if (am != null) am.cancel(alarmIntent(c));
        } catch (Exception ignored) {}
    }

    static void makeChannels(Context ctx) {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        NotificationChannel m = new NotificationChannel(CH_MSG, "Messages", NotificationManager.IMPORTANCE_HIGH);
        m.enableVibration(true); m.setShowBadge(true);
        m.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        m.enableLights(true);
        m.setSound(android.media.RingtoneManager.getDefaultUri(android.media.RingtoneManager.TYPE_NOTIFICATION),
                   new android.media.AudioAttributes.Builder()
                       .setUsage(android.media.AudioAttributes.USAGE_NOTIFICATION)
                       .setContentType(android.media.AudioAttributes.CONTENT_TYPE_SONIFICATION).build());
        nm.createNotificationChannel(m);
        // Retire every older channel so exactly one "Messages" category remains and no old
        // lowered setting can swallow the banner. Alerts stay in the in-app inbox regardless.
        try { nm.deleteNotificationChannel(CH_OLD); } catch (Exception ignored) {}
        try { nm.deleteNotificationChannel(CH_MSG_OLD); } catch (Exception ignored) {}
        try { nm.deleteNotificationChannel(CH_MSG_OLD2); } catch (Exception ignored) {}
    }

    /** One inbox check. Returns how long to wait before the next check (ms). */
    static long checkOnce(Context ctx) {
        SharedPreferences sp = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        try {
            String uid = sp.getString("uid", "");
            if (uid.isEmpty()) { cancel(ctx); return INTERVAL_MS; }
            makeChannels(ctx);
            long last = sp.getLong("last_id", -1);
            JSONObject req = new JSONObject();
            req.put("uid", uid);
            req.put("after", 0);
            req.put("seen", seenIds(sp));
            JSONObject res = post(API + "/api/sms/feed", req.toString());
            if (res != null && res.optBoolean("success")) {
                long maxId = res.optLong("maxId", 0);
                long nextAt = res.optLong("nextAt", 0);
                long serverNow = res.optLong("serverNow", 0);
                if (last < 0) {
                    // First run on this phone: do not replay old history as notifications.
                    sp.edit().putLong("last_id", maxId).apply();
                } else {
                    JSONArray arr = res.optJSONArray("messages");
                    long newest = last;
                    if (arr != null) for (int i = 0; i < arr.length(); i++) {
                        JSONObject m = arr.getJSONObject(i);
                        notifyMessage(ctx, m.optString("sender_name", "Messages"), m.optString("body", ""), m.optLong("id"));
                        rememberSeen(sp, m.optLong("id"));
                        newest = Math.max(newest, m.optLong("id"));
                    }
                    if (newest != last) sp.edit().putLong("last_id", newest).apply();
                }
                // Deliver what is due first, then arm the next check. If an alert is still
                // waiting out its delay, the next check is exactly when it becomes due, armed
                // as an alarm-clock alarm so it survives Doze with the app closed.
                if (nextAt > 0) {
                    long wait = serverNow > 0 ? (nextAt - serverNow) : (nextAt - System.currentTimeMillis());
                    // Bammi, 2026-11-23: the alert's due time can be moved EARLIER (released right
                    // after the OAT approval card fades). Sleeping until the old time would miss
                    // that, so while an alert is pending never sleep longer than 2.5 seconds.
                    return Math.max(800L, Math.min(wait + 400L, 2500L));
                }
            }
        } catch (Exception ignored) {}
        return INTERVAL_MS;
    }

    /** Ids already turned into a notification (newest 60 kept). A set, not a single cursor,
     *  because an earlier-id message can become due after a later-id one. */
    static JSONArray seenIds(SharedPreferences sp) {
        JSONArray a = new JSONArray();
        try {
            String raw = sp.getString("seen_ids", "");
            if (!raw.isEmpty()) for (String p : raw.split(",")) { if (!p.isEmpty()) a.put(Long.parseLong(p)); }
        } catch (Exception ignored) {}
        return a;
    }

    static void rememberSeen(SharedPreferences sp, long id) {
        try {
            String raw = sp.getString("seen_ids", "");
            java.util.LinkedList<String> l = new java.util.LinkedList<>();
            if (!raw.isEmpty()) for (String p : raw.split(",")) if (!p.isEmpty()) l.add(p);
            if (!l.contains(String.valueOf(id))) l.add(String.valueOf(id));
            while (l.size() > 60) l.removeFirst();
            StringBuilder sb = new StringBuilder();
            for (String p : l) { if (sb.length() > 0) sb.append(','); sb.append(p); }
            sp.edit().putString("seen_ids", sb.toString()).apply();
        } catch (Exception ignored) {}
    }

    static JSONObject post(String url, String body) {
        HttpURLConnection c = null;
        try {
            c = (HttpURLConnection) new URL(url).openConnection();
            c.setRequestMethod("POST"); c.setDoOutput(true);
            c.setConnectTimeout(12000); c.setReadTimeout(15000);
            c.setRequestProperty("Content-Type", "application/json");
            try (OutputStream os = c.getOutputStream()) { os.write(body.getBytes("UTF-8")); }
            if (c.getResponseCode() != 200) return null;
            Scanner sc = new Scanner(c.getInputStream(), "UTF-8").useDelimiter("\\A");
            return new JSONObject(sc.hasNext() ? sc.next() : "{}");
        } catch (Exception e) { return null; }
        finally { if (c != null) c.disconnect(); }
    }

    /** Same 12 colours and same hash as the Messages page (messages/index.html colorFor), so a bank is
     *  the same colour in the notification shade and in its thread. UBA is pinned to the exact blue
     *  measured from Bammi's real alert, rgb(66,193,233). */
    static final int[] AV_COLORS = {0xFFE46BB4, 0xFFF98B6B, 0xFFA86CE8, 0xFF5FC9E8, 0xFF7DC96B, 0xFFE8C04A,
        0xFF4FB3A3, 0xFF6E93E8, 0xFFE86B7D, 0xFF9BD35A, 0xFFE88A3C, 0xFFB07AE8};

    static int avatarColor(String sender) {
        String key = sender == null ? "" : sender.trim();
        if (key.equalsIgnoreCase("UBA")) return 0xFF42C1E9;          // measured from the real alert
        long h = 0;                                                   // page: h = (h*31 + c) >>> 0
        for (int i = 0; i < key.length(); i++) h = (h * 31 + key.charAt(i)) & 0xFFFFFFFFL;
        return AV_COLORS[(int) (h % AV_COLORS.length)];
    }

    /** Avatar for the conversation icon and the shortcut. Android crops these to a circle around the
     *  bitmap centre, so this is a square, perfectly centred disc: nothing may overhang or the disc
     *  would shift off-centre (measured: a wide bitmap moved the disc 14 px and clipped the badge). */
    static Bitmap avatar(String sender) { return avatar(sender, false); }

    /** withBadge adds the real alert's olive speech bubble badge on the bottom right (measured from
     *  Bammi's real UBA alert: diameter 0.37 of the disc, centre +0.45 / +0.30 of the diameter). Only
     *  used where Android does not crop the icon to a circle. */
    static Bitmap avatar(String sender, boolean withBadge) {
        final int sz = 192, extra = withBadge ? 28 : 0, w = sz + extra, h = sz + (withBadge ? 24 : 0);
        Bitmap bm = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888);
        Canvas cv = new Canvas(bm);
        Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
        float dcx = sz / 2f, dcy = sz / 2f;
        p.setColor(avatarColor(sender));
        cv.drawCircle(dcx, dcy, sz / 2f, p);
        p.setColor(0xFF1A1A1E);                                       // dark person glyph
        cv.drawCircle(dcx, sz * 0.38f, sz * 0.15f, p);
        cv.drawArc(sz * 0.24f, sz * 0.56f, sz * 0.76f, sz * 1.10f, 180, 180, true, p);
        if (withBadge) {
            float r = sz * 0.185f, cx = dcx + sz * 0.45f, cy = dcy + sz * 0.30f;
            p.setColor(0xFF829256);
            cv.drawCircle(cx, cy, r, p);
            p.setColor(0xFF1A1A1E);
            cv.drawRoundRect(new android.graphics.RectF(cx - r * 0.50f, cy - r * 0.44f, cx + r * 0.50f, cy + r * 0.30f), r * 0.18f, r * 0.18f, p);
            android.graphics.Path tail = new android.graphics.Path();
            tail.moveTo(cx - r * 0.30f, cy + r * 0.20f); tail.lineTo(cx - r * 0.34f, cy + r * 0.58f); tail.lineTo(cx + r * 0.06f, cy + r * 0.24f); tail.close();
            cv.drawPath(tail, p);
        }
        return bm;
    }

    /** Publishes one dynamic shortcut per bank and returns its id, or null below Android 7.1.
     *  This is what makes Android show the bank before the app name in the header, the way the
     *  real bank alert reads "UBA • Messages • now" (Bammi, 2026-11-24). */
    static String publishBankShortcut(Context ctx, String sender) {
        // setShortcutId() only exists from Android 8, so never publish below it: returning null
        // keeps the old layout instead of throwing NoSuchMethodError on Android 7.1.
        if (Build.VERSION.SDK_INT < 26) return null;
        try {
            ShortcutManager sm = (ShortcutManager) ctx.getSystemService(Context.SHORTCUT_SERVICE);
            if (sm == null) return null;
            String clean = (sender == null ? "" : sender).trim();
            if (clean.isEmpty()) return null;
            String sid = "bank_" + clean.toLowerCase().replaceAll("[^a-z0-9]", "_");
            for (ShortcutInfo existing : sm.getDynamicShortcuts()) {
                if (existing.getId().equals(sid)) return sid;   // already published
            }
            // Android rejects a shortcut intent without an action ("Shortcut intent needs an
            // action"), which would have thrown here and silently left the header as
            // "Messages • UBA". So build a dedicated intent that always carries ACTION_VIEW.
            Intent shortcutIntent = new Intent(ctx, MainActivity.class)
                .setAction(Intent.ACTION_VIEW)
                .putExtra(EXTRA_SENDER, clean)
                .setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            ShortcutInfo.Builder sib = new ShortcutInfo.Builder(ctx, sid)
                .setShortLabel(clean)
                .setLongLabel(clean)
                .setIcon(android.graphics.drawable.Icon.createWithBitmap(avatar(clean)))
                .setIntent(shortcutIntent);
            if (Build.VERSION.SDK_INT >= 30) sib.setLongLived(true);   // keep the conversation alive
            ShortcutInfo si = sib.build();
            sm.pushDynamicShortcut(si);                          // keeps the 5 most recent
            return sid;
        } catch (Throwable t) {
            return null;                                          // never break the alert itself
        }
    }

    /** First USSD dial code in the text, e.g. *919*28#, or null. Only real dial codes qualify:
     *  reference numbers such as UTR688884890830 must never get a CALL NUMBER button. */
    static String findDialable(String body) {
        try {
            java.util.regex.Matcher m = java.util.regex.Pattern.compile("\\*\\d[\\d*]*#").matcher(body == null ? "" : body);
            if (m.find()) return m.group().trim();
        } catch (Exception ignored) {}
        return null;
    }

    static void notifyMessage(Context ctx, String sender, String body, long id) {
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        Intent open = new Intent(ctx, MainActivity.class);
        open.putExtra(EXTRA_SENDER, sender);
        open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        int fl = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0);
        PendingIntent tap = PendingIntent.getActivity(ctx, (int) (id % 100000), open, fl);

        Intent rd = new Intent(ctx, ReadReceiver.class).setAction(ACTION_READ)
            .putExtra(EXTRA_SENDER, sender).putExtra("nid", (int) id);
        PendingIntent read = PendingIntent.getBroadcast(ctx, (int) (id % 100000), rd, fl);

        // Bammi, 2026-11-24 (side by side screenshots): the real alert reads "UBA • Messages • 19m"
        // with the bank FIRST. Android only puts the conversation first when the notification is a
        // real conversation, which needs a published shortcut id plus setLongLived. Without it the
        // header reads "Messages • UBA • now", which is what ours did.
        String shortcutId = publishBankShortcut(ctx, sender);
        Notification.Builder b = Build.VERSION.SDK_INT >= 26
            ? new Notification.Builder(ctx, CH_MSG) : new Notification.Builder(ctx);
        if (shortcutId != null) b.setShortcutId(shortcutId);
        b.setSmallIcon(R.drawable.ic_stat_msg)
         .setContentTitle(sender)
         .setContentText(body)
         .setContentIntent(tap).setAutoCancel(true)
         .setWhen(System.currentTimeMillis()).setShowWhen(true)
         .setCategory(Notification.CATEGORY_MESSAGE)
         .setVisibility(Notification.VISIBILITY_PUBLIC)
         .setColor(0xFFC5CF6B);
        // Bammi, 2026-11-24 (live UBA recording): a real bank alert shows the sender avatar on the
        // LEFT and the full text expanded, exactly like a conversation. Android only lays a
        // notification out that way when it is a MessagingStyle with a Person, so use it on
        // Android 9+ and fall back to the big text layout below that.
        boolean conversation = false;
        if (Build.VERSION.SDK_INT >= 28) {
            try {
                android.app.Person you = new android.app.Person.Builder().setName("Me").build();
                android.app.Person from = new android.app.Person.Builder()
                    .setName(sender)
                    .setIcon(android.graphics.drawable.Icon.createWithBitmap(avatar(sender)))
                    .build();
                Notification.MessagingStyle ms = new Notification.MessagingStyle(you);
                // Bammi, 2026-11-24: the real alert's header reads "UBA • Messages • now". Without a
                // conversation title Android prints the app name only and repeats the sender on its
                // own line above the text, so name the conversation after the bank.
                ms.setConversationTitle(sender);
                ms.addMessage(new Notification.MessagingStyle.Message(body, System.currentTimeMillis(), from));
                b.setStyle(ms);
                // No setLargeIcon here on purpose: with a Person icon Android already draws the
                // avatar, and setting both produced two icons in the card (Bammi, 2026-11-24).
                conversation = true;
            } catch (Throwable ignored) {}
        }
        if (!conversation) {
            b.setLargeIcon(avatar(sender, true)).setStyle(new Notification.BigTextStyle().bigText(body));
        }
        // CALL NUMBER, like the real UBA alert, when the text carries a code or number to dial.
        String dial = findDialable(body);
        if (dial != null) {
            Intent call = new Intent(Intent.ACTION_DIAL, android.net.Uri.fromParts("tel", dial, null))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            PendingIntent callPi = PendingIntent.getActivity(ctx, (int) (id % 100000) + 7, call, fl);
            b.addAction(Build.VERSION.SDK_INT >= 23
                ? new Notification.Action.Builder(android.graphics.drawable.Icon.createWithResource(ctx, R.drawable.ic_call), "Call number", callPi).build()
                : new Notification.Action.Builder(R.drawable.ic_call, "Call number", callPi).build());
        }
        // Real alert: CALL NUMBER is the only bordered button, "Mark as read" is plain text.
        b.addAction(Build.VERSION.SDK_INT >= 23
            ? new Notification.Action.Builder((android.graphics.drawable.Icon) null, "Mark as read", read).build()
            : new Notification.Action.Builder(0, "Mark as read", read).build());
        if (Build.VERSION.SDK_INT < 26) {
            b.setPriority(Notification.PRIORITY_MAX).setDefaults(Notification.DEFAULT_ALL);
        }
        nm.notify((int) id, b.build());
        wakeScreen(ctx);
    }

    @SuppressWarnings("deprecation")
    static void wakeScreen(Context ctx) {
        try {
            PowerManager pm = (PowerManager) ctx.getSystemService(Context.POWER_SERVICE);
            if (pm != null && !pm.isInteractive()) {
                PowerManager.WakeLock w = pm.newWakeLock(
                    PowerManager.SCREEN_BRIGHT_WAKE_LOCK | PowerManager.ACQUIRE_CAUSES_WAKEUP, "msgs:wake");
                w.acquire(4000);
            }
        } catch (Exception ignored) {}
    }

}
