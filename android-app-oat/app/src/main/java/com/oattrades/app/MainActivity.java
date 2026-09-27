package com.oattrades.app;

import android.annotation.SuppressLint;
import android.app.DownloadManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.IntentFilter;
import android.content.ActivityNotFoundException;
import android.content.ContentValues;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.speech.tts.TextToSpeech;
import android.provider.MediaStore;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.widget.Toast;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.view.View;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.ProgressBar;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.content.ContextCompat;
import androidx.core.content.FileProvider;
import androidx.webkit.WebSettingsCompat;
import androidx.webkit.WebViewFeature;

public class MainActivity extends AppCompatActivity {

    private static final String APP_URL = "https://wallet-masters.onrender.com/oat-app/";
    private static final int FILE_CHOOSER_REQUEST = 1001;
    private WebView webView;
    private ProgressBar progressBar;
    private ValueCallback<Uri[]> filePathCallback;
    private TextToSpeech tts; // native speech engine (cash-out voice announcement)
    private static final String VERSION_URL = "https://wallet-masters.onrender.com/api/oat-app/app-version";
    private static final String APK_MIME = "application/vnd.android.package-archive";
    private static final long VERSION_CHECK_INTERVAL_MS = 10 * 60 * 1000L;
    private long lastVersionCheck = 0L;
    private long updateDownloadId = -1L;
    private boolean installPending = false;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        // Native text-to-speech engine. The web layer's speechSynthesis does NOT work
        // inside Android WebView (no engine is exposed to WebView), so the webapp calls
        // OATNative.speak(text) through the JS bridge and we speak via the OS engine.
        tts = new TextToSpeech(this, status -> {
            if (status == TextToSpeech.SUCCESS) {
                try { tts.setLanguage(java.util.Locale.US); } catch (Exception ignored) {}
            }
        });

        webView = findViewById(R.id.webView);
        progressBar = findViewById(R.id.progressBar);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);          // keeps login sessions
        settings.setDatabaseEnabled(true);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setSupportZoom(false);
        settings.setLoadWithOverviewMode(true);
        settings.setUseWideViewPort(true);

        // Dark-safe: the webapp manages its own theme
        if (WebViewFeature.isFeatureSupported(WebViewFeature.ALGORITHMIC_DARKENING)) {
            WebSettingsCompat.setAlgorithmicDarkeningAllowed(settings, false);
        }

        // Native bridge: the webapp calls OATNative.saveReceipt(dataUrl) /
        // OATNative.shareReceipt(dataUrl) to store a canvas-rendered receipt PNG
        // into the phone gallery (and optionally fire the Android share sheet).
        webView.addJavascriptInterface(new OATNative(), "OATNative");

        // Route <a download> of data: URLs (receipt "Save to phone" fallback)
        // to the gallery too; http(s) downloads go to the system DownloadManager.
        webView.setDownloadListener((url, userAgent, contentDisposition, mimetype, contentLength) -> {
            if (url != null && url.startsWith("data:")) {
                saveReceiptPng(url, false);
            } else {
                try {
                    DownloadManager.Request req = new DownloadManager.Request(Uri.parse(url));
                    req.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                    DownloadManager dm = (DownloadManager) getSystemService(DOWNLOAD_SERVICE);
                    if (dm != null) dm.enqueue(req);
                } catch (Exception ignored) {}
            }
        });

        // File picker support: lets <input type="file" accept="image/*"> open the
        // gallery/camera chooser — required for profile pictures and KYC ID photos.
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback,
                                              FileChooserParams params) {
                if (filePathCallback != null) {
                    filePathCallback.onReceiveValue(null);
                }
                filePathCallback = callback;
                try {
                    Intent intent = params.createIntent();
                    intent.addCategory(Intent.CATEGORY_OPENABLE);
                    startActivityForResult(
                        Intent.createChooser(intent, "Select photo"), FILE_CHOOSER_REQUEST);
                } catch (ActivityNotFoundException e) {
                    filePathCallback = null;
                    return false;
                }
                return true;
            }
        });

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                String host = uri.getHost() != null ? uri.getHost() : "";
                // Keep the OAT Trades app inside the WebView; open anything else externally
                if (host.contains("wallet-masters.onrender.com") || host.contains("wallet-masters.com")) {
                    return false; // load in-app
                }
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, uri));
                } catch (Exception ignored) {}
                return true;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                progressBar.setVisibility(View.GONE);
            }
        });

        // In-app auto-update (Bammi, 2026-09-27): listen for the APK download to
        // finish so we can fire the installer, and check for a new version now.
        ContextCompat.registerReceiver(this, new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                long id = intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1);
                if (id == updateDownloadId && updateDownloadId != -1) launchApkInstall();
            }
        }, new IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE), ContextCompat.RECEIVER_NOT_EXPORTED);
        checkForUpdate();

        if (savedInstanceState != null) {
            webView.restoreState(savedInstanceState);
        } else {
            webView.loadUrl(APP_URL);
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        // User came back from the "install unknown apps" toggle with the APK ready:
        // continue the update automatically. Otherwise run the version check.
        if (installPending && canInstallPackages() && updateApkFile().exists()) {
            installPending = false;
            launchApkInstall();
        } else {
            checkForUpdate();
        }
    }

    /** Asks the server for the latest wrapper versionCode and pops the update dialog if newer. */
    private void checkForUpdate() {
        final long now = System.currentTimeMillis();
        if (now - lastVersionCheck < VERSION_CHECK_INTERVAL_MS) return;
        lastVersionCheck = now;
        new Thread(() -> {
            try {
                java.net.URL url = new java.net.URL(VERSION_URL);
                javax.net.ssl.HttpsURLConnection con =
                    (javax.net.ssl.HttpsURLConnection) url.openConnection();
                con.setConnectTimeout(8000);
                con.setReadTimeout(8000);
                java.util.Scanner sc = new java.util.Scanner(con.getInputStream())
                    .useDelimiter("\\A");
                String body = sc.hasNext() ? sc.next() : "";
                sc.close();
                con.disconnect();
                org.json.JSONObject o = new org.json.JSONObject(body);
                int latestCode = o.getInt("latestCode");
                String latestName = o.optString("latestName", "");
                String apkUrl = o.optString("apkUrl", "");
                if (latestCode > installedVersionCode() && !apkUrl.isEmpty()) {
                    runOnUiThread(() -> showUpdateDialog(latestName, apkUrl));
                }
            } catch (Exception ignored) {}
        }).start();
    }

    /** Non-cancelable "new version available" dialog — the user can never miss an update. */
    private void showUpdateDialog(String versionName, String apkUrl) {
        androidx.appcompat.app.AlertDialog.Builder b = new androidx.appcompat.app.AlertDialog.Builder(this);
        b.setCancelable(false);
        b.setTitle("Update Available");
        b.setMessage("A new version of OAT Trades" + (versionName.isEmpty() ? "" : " (v" + versionName + ")")
            + " is available.\n\nTap Update Now to download the new version, install it and the app will"
            + " reopen automatically.");
        b.setPositiveButton("Update Now", (d, w) -> startApkDownload(apkUrl));
        b.show();
    }

    /** Downloads the new APK inside the app (no browser, no file manager). */
    private void startApkDownload(String apkUrl) {
        try {
            DownloadManager.Request req = new DownloadManager.Request(Uri.parse(apkUrl));
            req.setTitle("OAT Trades update");
            req.setDescription("Downloading new version…");
            req.setMimeType(APK_MIME);
            req.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            req.setDestinationInExternalFilesDir(this, "Updates", "oat-update.apk");
            DownloadManager dm = (DownloadManager) getSystemService(DOWNLOAD_SERVICE);
            if (dm == null) throw new Exception("no DownloadManager");
            updateDownloadId = dm.enqueue(req);
            Toast.makeText(this, "Downloading update…", Toast.LENGTH_SHORT).show();
        } catch (Exception e) {
            // Fallback: open the APK link in the browser so the user can still update
            try {
                startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(apkUrl)));
            } catch (Exception ignored) {}
        }
    }

    /** The versionCode of THIS installed wrapper (from the OS package manager). */
    private int installedVersionCode() {
        try {
            return getPackageManager().getPackageInfo(getPackageName(), 0).versionCode;
        } catch (Exception e) {
            return Integer.MAX_VALUE; // never prompt if we can't read our own version
        }
    }

    /** Where the downloaded update APK lands (app-private, no storage permission needed). */
    private java.io.File updateApkFile() {
        java.io.File dir = getExternalFilesDir("Updates");
        return new java.io.File(dir != null ? dir : getFilesDir(), "oat-update.apk");
    }

    private boolean canInstallPackages() {
        return Build.VERSION.SDK_INT < 26 || getPackageManager().canRequestPackageInstalls();
    }

    /** Fires the Android installer on the downloaded APK. */
    private void launchApkInstall() {
        try {
            if (!canInstallPackages()) {
                // One-time Android security toggle: let this app install updates itself.
                installPending = true;
                Toast.makeText(this,
                    "Tap \"Allow from this source\", then the update continues automatically",
                    Toast.LENGTH_LONG).show();
                startActivity(new Intent(android.provider.Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    Uri.parse("package:" + getPackageName())));
                return;
            }
            java.io.File apk = updateApkFile();
            if (!apk.exists()) return;
            Uri uri = FileProvider.getUriForFile(this, "com.oattrades.app.fileprovider", apk);
            Intent i = new Intent(Intent.ACTION_VIEW);
            i.setDataAndType(uri, APK_MIME);
            i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(i);
        } catch (Exception e) {
            try {
                startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(
                    "https://github.com/bammifather-cmyk/wallet-masters/releases/download/oat-latest/app-release.apk")));
            } catch (Exception ignored) {}
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == FILE_CHOOSER_REQUEST) {
            if (filePathCallback != null) {
                filePathCallback.onReceiveValue(
                    WebChromeClient.FileChooserParams.parseResult(resultCode, data));
                filePathCallback = null;
            }
        } else {
            super.onActivityResult(requestCode, resultCode, data);
        }
    }

    @Override
    protected void onDestroy() {
        if (tts != null) {
            try { tts.stop(); tts.shutdown(); } catch (Exception ignored) {}
            tts = null;
        }
        super.onDestroy();
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        webView.saveState(outState);
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    /** JS bridge for the branded trade-receipt image. */
    private class OATNative {
        @JavascriptInterface
        public void saveReceipt(String dataUrl) {
            saveReceiptPng(dataUrl, false);
        }

        @JavascriptInterface
        public void shareReceipt(String dataUrl) {
            saveReceiptPng(dataUrl, true);
        }

        /** Speaks the cash-out line aloud, e.g. "Successfully cashed out 80,000 USDT". */
        @JavascriptInterface
        public void speak(final String text) {
            if (tts == null) return;
            try {
                runOnUiThread(() -> {
                    try {
                        tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, "oat_cashout");
                    } catch (Exception ignored) {}
                });
            } catch (Exception ignored) {}
        }
    }

    /** Decodes a data:image/png;base64 URL, saves it to the gallery, optionally opens the share sheet. */
    private void saveReceiptPng(String dataUrl, boolean share) {
        try {
            String b64;
            int comma = dataUrl.indexOf(',');
            if (comma < 0) return;
            b64 = dataUrl.substring(comma + 1);
            byte[] bytes = Base64.decode(b64, Base64.DEFAULT);
            final Bitmap bmp = BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
            if (bmp == null) return;

            final Uri uri = storeImage(bmp);
            if (uri == null) return;

            runOnUiThread(() -> {
                if (share) {
                    Intent send = new Intent(Intent.ACTION_SEND);
                    send.setType("image/png");
                    send.putExtra(Intent.EXTRA_STREAM, uri);
                    send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    startActivity(Intent.createChooser(send, "Share OAT Trades receipt"));
                } else {
                    Toast.makeText(MainActivity.this, "Receipt saved to your gallery", Toast.LENGTH_LONG).show();
                }
            });
        } catch (Exception e) {
            runOnUiThread(() -> Toast.makeText(MainActivity.this,
                    "Could not save receipt", Toast.LENGTH_SHORT).show());
        }
    }

    /** Saves a bitmap to Pictures/OATTrades; MediaStore on API 29+, legacy path below. */
    private Uri storeImage(Bitmap bmp) {
        String name = "OAT-Trades-Receipt-" + System.currentTimeMillis() + ".png";
        try {
            if (Build.VERSION.SDK_INT >= 29) {
                ContentValues cv = new ContentValues();
                cv.put(MediaStore.Images.Media.DISPLAY_NAME, name);
                cv.put(MediaStore.Images.Media.MIME_TYPE, "image/png");
                cv.put(MediaStore.Images.Media.RELATIVE_PATH, "Pictures/OATTrades");
                cv.put(MediaStore.Images.Media.IS_PENDING, 1);
                Uri dir = MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY);
                Uri uri = getContentResolver().insert(dir, cv);
                if (uri == null) return null;
                java.io.OutputStream os = getContentResolver().openOutputStream(uri);
                bmp.compress(Bitmap.CompressFormat.PNG, 100, os);
                if (os != null) os.close();
                cv.clear();
                cv.put(MediaStore.Images.Media.IS_PENDING, 0);
                getContentResolver().update(uri, cv, null, null);
                return uri;
            } else {
                java.io.File dir = new java.io.File(
                        getExternalFilesDir(Environment.DIRECTORY_PICTURES), "OATTrades");
                if (!dir.exists()) dir.mkdirs();
                java.io.File file = new java.io.File(dir, name);
                java.io.FileOutputStream fos = new java.io.FileOutputStream(file);
                bmp.compress(Bitmap.CompressFormat.PNG, 100, fos);
                fos.close();
                // make it visible in the gallery
                android.media.MediaScannerConnection.scanFile(this,
                        new String[]{file.getAbsolutePath()}, new String[]{"image/png"}, null);
                return FileProvider.getUriForFile(this, "com.oattrades.app.fileprovider", file);
            }
        } catch (Exception e) {
            return null;
        }
    }
}
