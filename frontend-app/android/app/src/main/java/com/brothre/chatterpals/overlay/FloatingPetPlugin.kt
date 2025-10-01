package com.brothre.chatterpals.overlay

import android.content.Intent
import android.os.Build
import android.provider.Settings
import com.brothre.chatterpals.MainActivity
import com.getcapacitor.Bridge
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.PluginMethod

@CapacitorPlugin(name = "FloatingPet")
class FloatingPetPlugin : Plugin() {
  override fun load() {
    super.load()
    instance = this
  }

  @PluginMethod
  fun enableOverlay(call: PluginCall) {
    if (!Settings.canDrawOverlays(context)) {
      call.reject("Overlay permission not granted")
      return
    }
    val intent = Intent(context, OverlayService::class.java)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      context.startForegroundService(intent)
    } else {
      context.startService(intent)
    }
    overlayEnabled = true
    val result = JSObject()
    result.put("value", true)
    call.resolve(result)
  }

  @PluginMethod
  fun disableOverlay(call: PluginCall) {
    val intent = Intent(context, OverlayService::class.java)
    context.stopService(intent)
    overlayEnabled = false
    val result = JSObject()
    result.put("value", true)
    call.resolve(result)
  }

  @PluginMethod
  fun isOverlayEnabled(call: PluginCall) {
    val result = JSObject()
    result.put("value", overlayEnabled)
    call.resolve(result)
  }

  @PluginMethod
  fun requestOverlayPermission(call: PluginCall) {
    val main = activity as? MainActivity
    if (main == null) {
      call.reject("Main activity unavailable")
      return
    }
    if (main.hasOverlayPermission()) {
      val result = JSObject()
      result.put("value", true)
      call.resolve(result)
      return
    }
    main.requestOverlayPermissionFlow()
    val result = JSObject()
    result.put("value", false)
    call.resolve(result)
  }

  @PluginMethod
  fun setOverlayPosition(call: PluginCall) {
    val x = call.getInt("x") ?: 0
    val y = call.getInt("y") ?: 0
    val intent = Intent(context, OverlayService::class.java)
    intent.action = OverlayService.ACTION_UPDATE_POSITION
    intent.putExtra(OverlayService.EXTRA_X, x)
    intent.putExtra(OverlayService.EXTRA_Y, y)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      context.startForegroundService(intent)
    } else {
      context.startService(intent)
    }
    call.resolve()
  }

  companion object {
    private var instance: FloatingPetPlugin? = null
    private var overlayEnabled = false

    fun dispatchSharedData(bridge: Bridge?, payload: JSObject) {
      val plugin = instance ?: return
      plugin.bridge?.webView?.post {
        plugin.notifyListeners("sharedData", payload, true)
      }
      bridge?.webView?.post {
        plugin.notifyListeners("sharedData", payload, true)
      }
    }
  }
}
