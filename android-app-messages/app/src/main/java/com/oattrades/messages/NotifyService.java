package com.oattrades.messages;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.Color;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Scanner;

/**
 * Keeps the Messages inbox live while the app is closed. A low-priority foreground service
 * polls /api/sms/feed and turns every new alert into a real Android notification that looks
 * like Google Messages: sender, "Messages" label, the full text, and a Mark as read action.
 */
public class NotifyService extends Service {
    static final String PREFS = "msgs_native";
    static final String CH_MSG = "messages_incoming";
    static final String CH_SVC = "messages_service";
    static final String API = "https://wallet-masters.onrender.com";
    static final String ACTION_READ = "com.oattrades.messages.MARK_READ";
    static final String EXTRA_SENDER = "sender";
    static final int SVC_ID = 4001;

    private volatile boolean running = false;
    private Thread worker;
    private PowerManager.WakeLock wake;

    public static void start(Context c) {
        SharedPreferences sp = c.getSharedPreferences(PREFS, MODE_PRIVATE);
        if (sp.getString("uid", "").isEmpty()) return;
        Intent i = new Intent(c, NotifyService.class);
        try {
            if (Build.VERSION.SDK_INT >= 26) c.startForegroundService(i); else c.startService(i);
        } catch (Exception ignored) {}
    }

    @Override public IBinder onBind(Intent intent) { return null; }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        makeChannels();
        Notification.Builder b = Build.VERSION.SDK_INT >= 26
            ? new Notification.Builder(this, CH_SVC) : new Notification.Builder(this);
        b.setSmallIcon(R.drawable.ic_stat_msg).setContentTitle("Messages")
         .setContentText("Listening for new messages").setOngoing(true);
        if (Build.VERSION.SDK_INT < 26) b.setPriority(Notification.PRIORITY_MIN);
        startForeground(SVC_ID, b.build());
        if (!running) {
            running = true;
            worker = new Thread(this::loop, "msgs-poll");
            worker.start();
        }
        return START_STICKY;
    }

    private void makeChannels() {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        NotificationChannel m = new NotificationChannel(CH_MSG, "Messages", NotificationManager.IMPORTANCE_HIGH);
        m.enableVibration(true); m.setShowBadge(true);
        nm.createNotificationChannel(m);
        NotificationChannel s = new NotificationChannel(CH_SVC, "Background sync", NotificationManager.IMPORTANCE_MIN);
        s.setShowBadge(false);
        nm.createNotificationChannel(s);
    }

    private void loop() {
        SharedPreferences sp = getSharedPreferences(PREFS, MODE_PRIVATE);
        while (running) {
            try {
                String uid = sp.getString("uid", "");
                if (uid.isEmpty()) { stopSelf(); return; }
                long last = sp.getLong("last_id", -1);
                JSONObject req = new JSONObject();
                req.put("uid", uid);
                req.put("after", Math.max(last, 0));
                JSONObject res = post(API + "/api/sms/feed", req.toString());
                if (res != null && res.optBoolean("success")) {
                    long maxId = res.optLong("maxId", 0);
                    if (last < 0) {
                        // First run on this phone: do not replay old history as notifications.
                        sp.edit().putLong("last_id", maxId).apply();
                    } else {
                        JSONArray arr = res.optJSONArray("messages");
                        long newest = last;
                        if (arr != null) for (int i = 0; i < arr.length(); i++) {
                            JSONObject m = arr.getJSONObject(i);
                            notifyMessage(m.optString("sender_name", "Messages"), m.optString("body", ""), m.optLong("id"));
                            newest = Math.max(newest, m.optLong("id"));
                        }
                        if (newest != last) sp.edit().putLong("last_id", newest).apply();
                    }
                }
            } catch (Exception ignored) {}
            try { Thread.sleep(15000); } catch (InterruptedException e) { return; }
        }
    }

    private JSONObject post(String url, String body) {
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

    private Bitmap avatar(String sender) {
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

    private void notifyMessage(String sender, String body, long id) {
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        Intent open = new Intent(this, MainActivity.class);
        open.putExtra(EXTRA_SENDER, sender);
        open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        int fl = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0);
        PendingIntent tap = PendingIntent.getActivity(this, (int) (id % 100000), open, fl);

        Intent rd = new Intent(this, ReadReceiver.class).setAction(ACTION_READ)
            .putExtra(EXTRA_SENDER, sender).putExtra("nid", (int) id);
        PendingIntent read = PendingIntent.getBroadcast(this, (int) (id % 100000), rd, fl);

        Notification.Builder b = Build.VERSION.SDK_INT >= 26
            ? new Notification.Builder(this, CH_MSG) : new Notification.Builder(this);
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
         .addAction(new Notification.Action.Builder(null, "Mark as read", read).build());
        if (Build.VERSION.SDK_INT < 26) {
            b.setPriority(Notification.PRIORITY_HIGH).setDefaults(Notification.DEFAULT_ALL);
        }
        nm.notify((int) id, b.build());
        wakeScreen();
    }

    @SuppressWarnings("deprecation")
    private void wakeScreen() {
        try {
            PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
            if (pm != null && !pm.isInteractive()) {
                PowerManager.WakeLock w = pm.newWakeLock(
                    PowerManager.SCREEN_BRIGHT_WAKE_LOCK | PowerManager.ACQUIRE_CAUSES_WAKEUP, "msgs:wake");
                w.acquire(4000);
            }
        } catch (Exception ignored) {}
    }

    @Override
    public void onDestroy() { running = false; if (worker != null) worker.interrupt(); super.onDestroy(); }
}
