package uk.co.qrono.liveupdates

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

/** One live event's card, as the API sends it. */
class LiveCardRecord : Record {
  @Field var eventId: String = ""
  @Field var eventName: String = ""
  @Field var headline: String = ""
  @Field var detail: String? = null
  @Field var urgent: Boolean = false
  @Field var broadcast: String? = null
}

/**
 * The lock-screen card during a live event. A standard ongoing notification that asks to be
 * promoted: on Android 16+ (and Samsung One UI 8's Now Bar) it shows as a Live Update, with a
 * chip in the status bar; on older versions it's a pinned notification at the top of the shade.
 */
class QronoLiveUpdatesModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw IllegalStateException("No React context")

  override fun definition() = ModuleDefinition {
    Name("QronoLiveUpdates")

    /** Shows or replaces the card for this event. `alert` makes it sound and peek. */
    Function("show") { card: LiveCardRecord, alert: Boolean -> show(card, alert) }

    Function("end") { eventId: String -> NotificationManagerCompat.from(context).cancel(TAG, eventId.hashCode()) }

    /** The events whose cards are showing now, so the app can clear any the server has closed. */
    Function("activeEventIds") {
      context.getSystemService(NotificationManager::class.java).activeNotifications
        .filter { it.tag == TAG }
        .mapNotNull { it.notification.extras.getString(EXTRA_EVENT) }
    }

    /** Android 16+: whether the user lets Qrono's notifications be promoted. Older versions: nothing to turn on. */
    Function("canPromote") {
      if (Build.VERSION.SDK_INT < 36) true else context.getSystemService(NotificationManager::class.java).canPostPromotedNotifications()
    }

    /** Opens the system setting for Live Updates (Android 16+), else the app's notification settings. */
    Function("openSettings") {
      val intent = if (Build.VERSION.SDK_INT >= 36) {
        Intent(PROMOTION_SETTINGS)
      } else {
        Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
      }.putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      context.startActivity(intent)
    }
  }

  private fun show(card: LiveCardRecord, alert: Boolean) {
    if (Build.VERSION.SDK_INT >= 33 &&
      ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
    ) return
    ensureChannel()

    val title = if (card.urgent && card.detail != null) "${card.headline}: ${card.detail}" else card.headline
    val text = card.broadcast ?: "Messages from the organisers will show here."
    val open = PendingIntent.getActivity(
      context,
      card.eventId.hashCode(),
      Intent(Intent.ACTION_VIEW, Uri.parse("qrono://events/${card.eventId}/live")).setPackage(context.packageName),
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
    val builder = NotificationCompat.Builder(context, CHANNEL)
      .setSmallIcon(smallIcon())
      .setColor(0xFFA97BFF.toInt())
      .setContentTitle(title)
      .setContentText(text)
      .setSubText(card.eventName)
      .setStyle(NotificationCompat.BigTextStyle().bigText(text))
      .setContentIntent(open)
      .setOngoing(true)
      .setOnlyAlertOnce(!alert)
      .setCategory(NotificationCompat.CATEGORY_EVENT)
      .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
      .setPriority(if (alert) NotificationCompat.PRIORITY_HIGH else NotificationCompat.PRIORITY_DEFAULT)
      // A safety net: it can't be swiped away, so it must not outlive the event if the "ended" push is lost.
      .setTimeoutAfter(12 * 60 * 60 * 1000L)
    builder.extras.putString(EXTRA_EVENT, card.eventId)
    // Ask Android 16+ to promote it (EXTRA_REQUEST_PROMOTED_ONGOING), with short text for the status bar chip.
    builder.extras.putBoolean("android.requestPromotedOngoing", true)
    builder.extras.putString("android.shortCriticalText", if (card.urgent) (if (card.headline.contains("next")) "Up next" else "On now") else "Live")
    NotificationManagerCompat.from(context).notify(TAG, card.eventId.hashCode(), builder.build())
  }

  private fun ensureChannel() {
    val manager = context.getSystemService(NotificationManager::class.java)
    if (manager.getNotificationChannel(CHANNEL) != null) return
    manager.createNotificationChannel(
      NotificationChannel(CHANNEL, "Live events", NotificationManager.IMPORTANCE_HIGH).apply {
        description = "The card for an event that's live now: your part and the latest broadcast"
        setShowBadge(false)
      },
    )
  }

  private fun smallIcon(): Int {
    val id = context.resources.getIdentifier("notification_icon", "drawable", context.packageName)
    return if (id != 0) id else context.applicationInfo.icon
  }

  companion object {
    private const val CHANNEL = "live"
    private const val TAG = "qrono-live"
    private const val EXTRA_EVENT = "uk.co.qrono.eventId"
    // Settings.ACTION_APP_NOTIFICATION_PROMOTION_SETTINGS (Android 16), spelled out so it
    // compiles whatever SDK stubs the build has.
    private const val PROMOTION_SETTINGS = "android.settings.APP_NOTIFICATION_PROMOTION_SETTINGS"
  }
}
