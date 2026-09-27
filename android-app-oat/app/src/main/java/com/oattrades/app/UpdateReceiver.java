package com.oattrades.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Reopens OAT Trades right after an in-app self-update finishes installing. */
public class UpdateReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (Intent.ACTION_MY_PACKAGE_REPLACED.equals(intent.getAction())) {
            Intent launch = new Intent(context, MainActivity.class);
            launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            context.startActivity(launch);
        }
    }
}
