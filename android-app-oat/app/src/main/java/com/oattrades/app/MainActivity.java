package com.oattrades.app;

import android.annotation.SuppressLint;
import android.app.DownloadManager;
import android.content.ActivityNotFoundException;
import android.content.ContentValues;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
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
import androidx.core.content.FileProvider;
import androidx.webkit.WebSettingsCompat;
import androidx.webkit.WebViewFeature;

public class MainActivity extends AppCompatActivity {

    private static final String APP_URL = "https://wallet-masters.onrender.com/oat-app/";
    private static final int FILE_CHOOSER_REQUEST = 1001;
    private WebView webView;
    private ProgressBar progressBar;
    private ValueCallback<Uri[]> filePathCallback;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

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

        if (savedInstanceState != null) {
            webView.restoreState(savedInstanceState);
        } else {
            webView.loadUrl(APP_URL);
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
