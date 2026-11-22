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
            long next = NotifyService.INTERVAL_MS;
            try { next = NotifyService.checkOnce(app); } catch (Throwable ignored) {}
            // a short wait means an alert is about to become due -> arm it as an exact alarm-clock
            NotifyService.schedule(app, next, next < NotifyService.INTERVAL_MS);
            NotifyService.armBackup(app);   // keeps the heartbeat alive if this chain is ever killed
            pr.finish();
        }, "msgs-poll").start();
    }
}
