package com.brothre.chatterpals.overlay

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.PixelFormat
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.IBinder
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.Toast
import androidx.core.app.NotificationCompat
import com.brothre.chatterpals.MainActivity
import com.brothre.chatterpals.R

class OverlayService : Service() {
  private lateinit var windowManager: WindowManager
  private var bubbleView: View? = null
  private lateinit var layoutParams: WindowManager.LayoutParams

  override fun onCreate() {
    super.onCreate()
    windowManager = getSystemService(Context.WINDOW_SERVICE) as WindowManager
    createNotificationChannel()
    startForegroundService()
    createBubble()
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent?.action == ACTION_UPDATE_POSITION) {
      val x = intent.getIntExtra(EXTRA_X, layoutParams.x)
      val y = intent.getIntExtra(EXTRA_Y, layoutParams.y)
      layoutParams.x = x
      layoutParams.y = y
      bubbleView?.let { windowManager.updateViewLayout(it, layoutParams) }
    }
    return START_STICKY
  }

  override fun onDestroy() {
    super.onDestroy()
    bubbleView?.let {
      try {
        windowManager.removeView(it)
      } catch (_: Exception) {
      }
    }
    bubbleView = null
  }

  override fun onBind(intent: Intent?): IBinder? = null

  private fun startForegroundService() {
    val notification = buildNotification()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
      startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
    } else {
      startForeground(NOTIFICATION_ID, notification)
    }
  }

  private fun buildNotification(): Notification {
    val intent = Intent(this, MainActivity::class.java)
    val pendingIntent = PendingIntent.getActivity(
      this,
      0,
      intent,
      PendingIntent.FLAG_UPDATE_CURRENT or
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) PendingIntent.FLAG_IMMUTABLE else 0
    )

    return NotificationCompat.Builder(this, CHANNEL_ID)
      .setContentTitle(getString(R.string.app_name))
      .setContentText("화면 친구가 옆에 있어요")
      .setSmallIcon(R.mipmap.ic_launcher_round)
      .setOngoing(true)
      .setContentIntent(pendingIntent)
      .setCategory(NotificationCompat.CATEGORY_SERVICE)
      .setPriority(NotificationCompat.PRIORITY_MIN)
      .build()
  }

  private fun createBubble() {
    if (bubbleView != null) return
    layoutParams = WindowManager.LayoutParams(
      WindowManager.LayoutParams.WRAP_CONTENT,
      WindowManager.LayoutParams.WRAP_CONTENT,
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
        WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
      else
        WindowManager.LayoutParams.TYPE_PHONE,
      WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
        WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
      PixelFormat.TRANSLUCENT
    )
    layoutParams.gravity = Gravity.TOP or Gravity.START
    layoutParams.x = 100
    layoutParams.y = 400

    val container = FrameLayout(this)
    val imageView = ImageView(this)
    imageView.setImageResource(R.mipmap.ic_launcher_round)
    imageView.contentDescription = getString(R.string.app_name)
    val size = (72 * resources.displayMetrics.density).toInt()
    val params = FrameLayout.LayoutParams(size, size)
    imageView.layoutParams = params
    container.addView(imageView)

    val background = GradientDrawable()
    background.shape = GradientDrawable.RECTANGLE
    background.cornerRadius = size / 2f
    background.colors = intArrayOf(0xFF6366F1.toInt(), 0xFFA855F7.toInt())
    container.background = background
    container.elevation = 16f
    val padding = (8 * resources.displayMetrics.density).toInt()
    container.setPadding(padding, padding, padding, padding)

    container.setOnClickListener {
      val launchIntent = packageManager.getLaunchIntentForPackage(packageName)
      if (launchIntent != null) {
        launchIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        startActivity(launchIntent)
      } else {
        Toast.makeText(this, "앱을 실행하지 못했어요", Toast.LENGTH_SHORT).show()
      }
    }

    container.setOnTouchListener(object : View.OnTouchListener {
      private var initialX = 0
      private var initialY = 0
      private var touchX = 0f
      private var touchY = 0f
      private var moving = false

      override fun onTouch(v: View?, event: MotionEvent): Boolean {
        when (event.action) {
          MotionEvent.ACTION_DOWN -> {
            initialX = layoutParams.x
            initialY = layoutParams.y
            touchX = event.rawX
            touchY = event.rawY
            moving = false
            return true
          }
          MotionEvent.ACTION_MOVE -> {
            val deltaX = (event.rawX - touchX).toInt()
            val deltaY = (event.rawY - touchY).toInt()
            if (!moving && (kotlin.math.abs(deltaX) > 6 || kotlin.math.abs(deltaY) > 6)) {
              moving = true
            }
            layoutParams.x = initialX + deltaX
            layoutParams.y = initialY + deltaY
            bubbleView?.let { windowManager.updateViewLayout(it, layoutParams) }
            return true
          }
          MotionEvent.ACTION_UP -> {
            if (!moving) {
              v?.performClick()
            }
            return true
          }
        }
        return false
      }
    })

    bubbleView = container
    windowManager.addView(container, layoutParams)
  }

  private fun createNotificationChannel() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val channel = NotificationChannel(
        CHANNEL_ID,
        "Floating Pet",
        NotificationManager.IMPORTANCE_MIN
      )
      val manager = getSystemService(NotificationManager::class.java)
      manager.createNotificationChannel(channel)
    }
  }

  companion object {
    const val ACTION_UPDATE_POSITION = "com.brothre.chatterpals.UPDATE_OVERLAY"
    const val EXTRA_X = "extra_x"
    const val EXTRA_Y = "extra_y"
    private const val CHANNEL_ID = "floating_pet_channel"
    private const val NOTIFICATION_ID = 4040
  }
}