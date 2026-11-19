package com.oattrades.messages;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * Fires from the repeating alarm. Does one quick inbox check on a short worker thread (goAsync keeps
 * the process alive for it) and then re-arms the alarm. No service and no foreground notification.
 */
public class PollReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(final Context context, Intent intent) {
        final PendingResult pr = goAsync();
        final Context app = context.getApplicationContext();
        new Thread(() -> {
            try { NotifyService.checkOnce(app); } catch (Throwable ignored) {}
            NotifyService.schedule(app, NotifyService.INTERVAL_MS);
            pr.finish();
        }, "msgs-poll").start();
    }
}
