package com.oattrades.messages;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;

/**
 * Host for the notification bubble. A bubble needs an activity that is resizable and embeddable,
 * which MainActivity is not (singleTask + portrait lock). Rather than change MainActivity, which
 * would risk the app failing to open, the bubble gets this tiny separate activity. It does no work
 * of its own: it hands the tap straight to MainActivity for the same conversation and closes.
 *
 * Reversible: set NotifyService.EXPERIMENT_BUBBLE to false and no bubble is ever requested, so this
 * class is never started.
 */
public class BubbleActivity extends Activity {
    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        try {
            Intent in = new Intent(this, MainActivity.class)
                .setAction(Intent.ACTION_VIEW)
                .putExtra(NotifyService.EXTRA_SENDER, getIntent().getStringExtra(NotifyService.EXTRA_SENDER))
                .setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            startActivity(in);
        } catch (Throwable ignored) {}
        finish();
    }
}
