package com.oattrades.messages;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Restarts the notification service after the phone reboots or the app is updated. */
public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        NotifyService.start(context);
    }
}
