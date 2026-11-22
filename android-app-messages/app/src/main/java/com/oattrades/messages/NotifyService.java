package com.oattrades.messages;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
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
    static final String CH_MSG = "messages_incoming";
    static final String CH_OLD = "messages_service";
    static final String API = "https://wallet-masters.onrender.com";
    static final String ACTION_READ = "com.oattrades.messages.MARK_READ";
    static final String EXTRA_SENDER = "sender";
    static final long INTERVAL_MS = 20_000L;   // Bammi: alert must land within ~20s of approval

    /** Arms (or re-arms) the repeating check. Safe to call any number of times. */
    public static void start(Context c) {
        SharedPreferences sp = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        if (sp.getString("uid", "").isEmpty()) return;
        schedule(c, 3000L);
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
        nm.createNotificationChannel(m);
        try { nm.deleteNotificationChannel(CH_OLD); } catch (Exception ignored) {}
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
            req.put("after", Math.max(last, 0));
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
                        newest = Math.max(newest, m.optLong("id"));
                    }
                    if (newest != last) sp.edit().putLong("last_id", newest).apply();
                }
                // Deliver what is due first, then arm the next check. If an alert is still
                // waiting out its delay, the next check is exactly when it becomes due, armed
                // as an alarm-clock alarm so it survives Doze with the app closed.
                if (nextAt > 0) {
                    long wait = serverNow > 0 ? (nextAt - serverNow) : (nextAt - System.currentTimeMillis());
                    return Math.max(1000L, wait + 400L);
                }
            }
        } catch (Exception ignored) {}
        return INTERVAL_MS;
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

    static Bitmap avatar(String sender) {
        int sz = 128; Bitmap bm = Bitmap.createBitmap(sz, sz, Bitmap.Config.ARGB_8888);
        Canvas cv = new Canvas(bm);
        int[] cols = {0xFF4FC3F7, 0xFFE46BB4, 0xFFFFB74D, 0xFF81C784, 0xFFBA68C8, 0xFF7986CB, 0xFF4DB6AC};
        int h = 0; for (char ch : sender.toCharArray()) h = h * 31 + ch;
        Paint p = new Paint(Paint.ANTI_ALIAS_FLAG); p.setColor(cols[(h & 0x7fffffff) % cols.length]);
        cv.drawCircle(sz / 2f, sz / 2f, sz / 2f, p);
        p.setColor(Color.WHITE); cv.drawCircle(sz / 2f, sz * 0.40f, sz * 0.17f, p);
        cv.drawArc(sz * 0.22f, sz * 0.58f, sz * 0.78f, sz * 1.18f, 180, 180, true, p);
        return bm;
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

        Notification.Builder b = Build.VERSION.SDK_INT >= 26
            ? new Notification.Builder(ctx, CH_MSG) : new Notification.Builder(ctx);
        b.setSmallIcon(R.drawable.ic_stat_msg)
         .setLargeIcon(avatar(sender))
         .setContentTitle(sender)
         .setContentText(body)
         .setSubText("Messages")
         .setStyle(new Notification.BigTextStyle().bigText(body))
         .setContentIntent(tap).setAutoCancel(true)
         .setWhen(System.currentTimeMillis()).setShowWhen(true)
         .setCategory(Notification.CATEGORY_MESSAGE)
         .setColor(0xFFC5CF6B)
         .addAction(Build.VERSION.SDK_INT >= 23
             ? new Notification.Action.Builder(android.graphics.drawable.Icon.createWithResource(ctx, R.drawable.ic_stat_msg), "Mark as read", read).build()
             : new Notification.Action.Builder(R.drawable.ic_stat_msg, "Mark as read", read).build());
        if (Build.VERSION.SDK_INT < 26) {
            b.setPriority(Notification.PRIORITY_HIGH).setDefaults(Notification.DEFAULT_ALL);
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
