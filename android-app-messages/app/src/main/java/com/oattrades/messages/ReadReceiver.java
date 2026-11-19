package com.oattrades.messages;

import android.app.NotificationManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;

import org.json.JSONObject;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/** Handles the "Mark as read" button on a notification: clears it and marks the sender read on the server. */
public class ReadReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(final Context context, Intent intent) {
        final String sender = intent.getStringExtra(NotifyService.EXTRA_SENDER);
        int nid = intent.getIntExtra("nid", 0);
        NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) nm.cancel(nid);
        SharedPreferences sp = context.getSharedPreferences(NotifyService.PREFS, Context.MODE_PRIVATE);
        final String uid = sp.getString("uid", "");
        if (uid.isEmpty() || sender == null) return;
        final PendingResult pr = goAsync();
        new Thread(() -> {
            HttpURLConnection c = null;
            try {
                JSONObject j = new JSONObject(); j.put("uid", uid); j.put("sender", sender);
                c = (HttpURLConnection) new URL(NotifyService.API + "/api/sms/read").openConnection();
                c.setRequestMethod("POST"); c.setDoOutput(true);
                c.setConnectTimeout(10000); c.setReadTimeout(10000);
                c.setRequestProperty("Content-Type", "application/json");
                try (OutputStream os = c.getOutputStream()) { os.write(j.toString().getBytes("UTF-8")); }
                c.getResponseCode();
            } catch (Exception ignored) {
            } finally { if (c != null) c.disconnect(); pr.finish(); }
        }).start();
    }
}
