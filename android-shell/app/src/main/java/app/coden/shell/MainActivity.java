package app.coden.shell;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.view.ViewGroup;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

/** Coden-Hülle: zeigt die App von ihrer Coden-Adresse. Änderungen aus Coden sind sofort da, ohne neue APK. */
public class MainActivity extends Activity {
    private static final int FILE_REQUEST = 41;
    private WebView web;
    private ValueCallback<Uri[]> fileCallback;
    private Uri home;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        home = Uri.parse(BuildConfig.APP_URL);
        int brand;
        try { brand = Color.parseColor(BuildConfig.APP_COLOR); } catch (IllegalArgumentException e) { brand = Color.BLACK; }
        getWindow().setStatusBarColor(brand);

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(brand);
        web = new WebView(this);
        web.setBackgroundColor(Color.WHITE);
        root.addView(web, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(root);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setSupportMultipleWindows(false);
        s.setUserAgentString(s.getUserAgentString() + " CodenShell/1.0");

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                Uri u = req.getUrl();
                // Eigene Seiten im WebView, alles andere (Links nach außen, mailto:, tel:) in der passenden App
                if (u.getHost() != null && u.getHost().equals(home.getHost()) && u.getPath() != null && u.getPath().startsWith(home.getPath())) return false;
                try { startActivity(new Intent(Intent.ACTION_VIEW, u)); } catch (ActivityNotFoundException e) { /* nichts zum Öffnen */ }
                return true;
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest req, WebResourceError err) {
                if (req.isForMainFrame()) {
                    view.loadDataWithBaseURL(null, "<html><head><meta name='viewport' content='width=device-width,initial-scale=1'></head>"
                        + "<body style='margin:0;height:100vh;display:flex;align-items:center;justify-content:center;font-family:sans-serif;text-align:center;color:#444'>"
                        + "<div><h2>Keine Verbindung</h2><p>Prüfe dein Internet.</p><button style='padding:12px 22px;border:0;border-radius:12px;background:" + BuildConfig.APP_COLOR + ";color:#fff;font-size:16px' onclick='location.href=\"" + BuildConfig.APP_URL + "\"'>Erneut versuchen</button></div></body></html>",
                        "text/html", "utf-8", null);
                }
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> cb, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = cb;
                try { startActivityForResult(params.createIntent(), FILE_REQUEST); } catch (ActivityNotFoundException e) { fileCallback = null; return false; }
                return true;
            }
        });

        if (state != null) web.restoreState(state); else web.loadUrl(BuildConfig.APP_URL);
    }

    @Override
    protected void onActivityResult(int request, int result, Intent data) {
        if (request == FILE_REQUEST && fileCallback != null) {
            fileCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result, data));
            fileCallback = null;
            return;
        }
        super.onActivityResult(request, result, data);
    }

    @Override
    protected void onSaveInstanceState(Bundle out) { super.onSaveInstanceState(out); web.saveState(out); }

    @Override
    public void onBackPressed() {
        if (web != null && web.canGoBack()) web.goBack(); else super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        if (web != null) { ((ViewGroup) web.getParent()).removeView(web); web.destroy(); web = null; }
        super.onDestroy();
    }

    @Override
    protected void onResume() { super.onResume(); if (web != null) web.onResume(); }

    @Override
    protected void onPause() { if (web != null) web.onPause(); super.onPause(); }
}
