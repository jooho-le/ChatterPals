package com.brothre.chatterpals;

import android.app.ActivityManager;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;

import androidx.annotation.Nullable;

import com.brothre.chatterpals.overlay.FloatingPetPlugin;
import com.brothre.chatterpals.overlay.OverlayService;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.JSObject;

public class MainActivity extends BridgeActivity {
  private static final int OVERLAY_PERMISSION_REQ_CODE = 1101;
  private boolean overlayBootstrapAttempted = false;

  @Override
  public void onCreate(Bundle savedInstanceState) {
    registerPlugin(FloatingPetPlugin.class);
    super.onCreate(savedInstanceState);
    handleIncomingIntent(getIntent());
  }

  @Override
  public void onResume() {
    super.onResume();
    overlayBootstrapAttempted = false;
    ensureOverlayVisible();
  }

  @Override
  protected void onNewIntent(Intent intent) {
    super.onNewIntent(intent);
    setIntent(intent);
    handleIncomingIntent(intent);
  }

  @Override
  protected void onActivityResult(int requestCode, int resultCode, @Nullable Intent data) {
    super.onActivityResult(requestCode, resultCode, data);
    if (requestCode == OVERLAY_PERMISSION_REQ_CODE) {
      overlayBootstrapAttempted = false;
      new Handler(Looper.getMainLooper()).postDelayed(this::ensureOverlayVisible, 300);
    }
  }

  public boolean hasOverlayPermission() {
    return Settings.canDrawOverlays(this);
  }

  public void requestOverlayPermissionFlow() {
    Intent intent = new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:" + getPackageName()));
    startActivityForResult(intent, OVERLAY_PERMISSION_REQ_CODE);
  }

  private void ensureOverlayVisible() {
    if (overlayBootstrapAttempted) {
      return;
    }
    overlayBootstrapAttempted = true;
    if (!hasOverlayPermission()) {
      requestOverlayPermissionFlow();
      return;
    }
    if (!isOverlayServiceRunning()) {
      startOverlayService();
    }
  }

  private boolean isOverlayServiceRunning() {
    ActivityManager manager = (ActivityManager) getSystemService(Context.ACTIVITY_SERVICE);
    if (manager == null) {
      return false;
    }
    for (ActivityManager.RunningServiceInfo serviceInfo : manager.getRunningServices(Integer.MAX_VALUE)) {
      if (OverlayService.class.getName().equals(serviceInfo.service.getClassName())) {
        return true;
      }
    }
    return false;
  }

  private void startOverlayService() {
    Intent serviceIntent = new Intent(this, OverlayService.class);
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      startForegroundService(serviceIntent);
    } else {
      startService(serviceIntent);
    }
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