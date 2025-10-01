package com.brothre.chatterpals;

import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.provider.Settings;

import androidx.annotation.Nullable;

import com.brothre.chatterpals.overlay.FloatingPetPlugin;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.JSObject;

public class MainActivity extends BridgeActivity {
  private static final int OVERLAY_PERMISSION_REQ_CODE = 1101;

  @Override
  public void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    handleIncomingIntent(getIntent());
  }

  @Override
  protected void onNewIntent(Intent intent) {
    super.onNewIntent(intent);
    setIntent(intent);
    handleIncomingIntent(intent);
  }

  public boolean hasOverlayPermission() {
    return Settings.canDrawOverlays(this);
  }

  public void requestOverlayPermissionFlow() {
    if (hasOverlayPermission()) {
      return;
    }
    Intent intent = new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:" + getPackageName()));
    startActivityForResult(intent, OVERLAY_PERMISSION_REQ_CODE);
  }

  private void handleIncomingIntent(@Nullable Intent intent) {
    if (intent == null) {
      return;
    }
    if (Intent.ACTION_SEND.equals(intent.getAction()) && intent.hasExtra(Intent.EXTRA_TEXT)) {
      String sharedText = intent.getStringExtra(Intent.EXTRA_TEXT);
      JSObject payload = new JSObject();
      payload.put("text", sharedText);
      FloatingPetPlugin.dispatchSharedData(getBridge(), payload);
      intent.removeExtra(Intent.EXTRA_TEXT);
    }
  }
}
