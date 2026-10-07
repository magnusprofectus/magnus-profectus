package com.magnusprofectus.app;

import android.os.Bundle;
import android.webkit.WebSettings;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
  @Override
  public void onStart() {
    super.onStart();
    if (this.bridge == null) return;
    WebView webView = this.bridge.getWebView();
    if (webView == null) return;
    WebSettings settings = webView.getSettings();
    // Deterministic fit on every device (2026-10-07, user report: content behind
    // system bars + bleeding past the right edge):
    //  - text zoom 100% ignores the system font-scale that inflates text blocks
    //    wider than the screen (the web layer also sets text-size-adjust: 100%).
    //  - useWideViewPort false pins the layout viewport to the screen width, so
    //    the page scales instead of requiring sideways scrolling.
    settings.setTextZoom(100);
    settings.setUseWideViewPort(false);
    settings.setLoadWithOverviewMode(false);
  }
}
