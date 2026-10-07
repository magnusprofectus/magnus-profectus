package com.magnusprofectus.app;

import android.os.Bundle;
import android.webkit.WebSettings;
import android.webkit.WebView;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
  @Override
  public void onStart() {
    super.onStart();
    if (this.bridge == null) return;
    WebView webView = this.bridge.getWebView();
    if (webView == null) return;
    WebSettings settings = webView.getSettings();
    // text zoom 100% ignores the system font-scale that inflates text blocks
    // wider than the screen (the web layer sets text-size-adjust: 100% too).
    settings.setTextZoom(100);
    settings.setUseWideViewPort(false);
    settings.setLoadWithOverviewMode(false);
    // Android 15+ (targetSdk 35/36) forces edge-to-edge; on Android 16 the
    // opt-out attribute is ignored, so handle insets the modern way: pad the
    // WebView by the system bars + display cutout on every device, which keeps
    // the app between the bars regardless of screen size or navigation mode.
    ViewCompat.setOnApplyWindowInsetsListener(webView, (v, windowInsets) -> {
      Insets bars = windowInsets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
      v.setPadding(bars.left, bars.top, bars.right, bars.bottom);
      return WindowInsetsCompat.CONSUMED;
    });
  }
}
