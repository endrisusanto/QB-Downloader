package id.endrisusanto.qbdashboard.data

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.content.SharedPreferences
import id.endrisusanto.qbdashboard.MainActivity
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import okhttp3.*
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.TimeUnit

data class SystemStats(
    val cpuUsage: Float,
    val ramTotal: Long,
    val ramUsed: Long,
    val diskTotal: Long,
    val diskAvailable: Long,
    val totalSpeed: Long,
)

data class Artifact(
    val id: String,
    val name: String,
    val size: Long,
    val selected: Boolean,
)

data class BuildArtifactGroup(
    val id: String,
    val input: String,
    val buildId: String?,
    val name: String?,
    val status: String,
    val customFilters: List<String>?,
    val artifacts: List<Artifact>,
)

data class DownloadEvent(
    val jobId: String,
    val artifactId: String,
    val buildId: String,
    val name: String,
    val status: String,
    val downloaded: Long,
    val total: Long,
    val message: String?,
)

data class PcState(
    val pcId: String,
    val pcName: String,
    val ip: String,
    val os: String,
    val online: Boolean,
    val lastSeen: String,
    val sysStats: SystemStats?,
    val presetTypes: List<String>,
    val groups: List<BuildArtifactGroup>,
    val rows: Map<String, DownloadEvent>,
)

enum class ConnectionStatus { DISCONNECTED, CONNECTING, CONNECTED }

/**
 * Manages a single WebSocket connection to the QB relay server.
 * Exposes StateFlows for reactive Compose UI consumption.
 */
class ServerClient(private val context: Context) {

    companion object {
        private const val PREFS_NAME = "qb_dashboard_prefs"
        private const val PREF_SERVER_URL = "server_url"
        private const val PREF_API_KEY = "api_key"
        private const val DOWNLOAD_CHANNEL_ID = "download_progress"
        private const val DOWNLOAD_NOTIFICATION_ID = 1
        private const val RESULT_CHANNEL_ID = "download_results"
        private const val RESULT_NOTIFICATION_ID = 2
    }

    private val prefs: SharedPreferences = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    private val http = OkHttpClient.Builder()
        .readTimeout(0, TimeUnit.MILLISECONDS) // keep-alive for WS
        .build()

    private var ws: WebSocket? = null
    private var reconnectJob: java.util.Timer? = null
    private var previousStatuses = emptyMap<String, String>()
    private val notificationManager = context.getSystemService(NotificationManager::class.java)

    init {
        notificationManager.createNotificationChannel(
            NotificationChannel(DOWNLOAD_CHANNEL_ID, "Download progress", NotificationManager.IMPORTANCE_LOW)
        )
        notificationManager.createNotificationChannel(
            NotificationChannel(RESULT_CHANNEL_ID, "Download results", NotificationManager.IMPORTANCE_DEFAULT)
        )
    }

    val connectionStatus = MutableStateFlow(ConnectionStatus.DISCONNECTED)
    val pcs: MutableStateFlow<List<PcState>> = MutableStateFlow(emptyList())

    var serverUrl: String
        get() = prefs.getString(PREF_SERVER_URL, "https://qd.endrisusanto.my.id/") ?: "https://qd.endrisusanto.my.id/"
        set(v) { prefs.edit().putString(PREF_SERVER_URL, v).apply() }

    var apiKey: String
        get() = prefs.getString(PREF_API_KEY, "") ?: ""
        set(v) { prefs.edit().putString(PREF_API_KEY, v).apply() }

    fun connect() {
        val url = serverUrl.ifBlank { return }
        disconnect()
        connectionStatus.value = ConnectionStatus.CONNECTING

        val wsUrl = buildWsUrl(url, "/ws/client")
        val request = Request.Builder().url(wsUrl).build()

        ws = http.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                connectionStatus.value = ConnectionStatus.CONNECTED
                cancelReconnect()
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                runCatching {
                    val msg = JSONObject(text)
                    when (msg.getString("type")) {
                        "state_update" -> parseStateUpdate(msg)
                    }
                }
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                connectionStatus.value = ConnectionStatus.DISCONNECTED
                scheduleReconnect()
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                connectionStatus.value = ConnectionStatus.DISCONNECTED
                if (code != 1000) scheduleReconnect()
            }
        })
    }

    fun disconnect() {
        cancelReconnect()
        ws?.close(1000, "User disconnect")
        ws = null
        connectionStatus.value = ConnectionStatus.DISCONNECTED
        previousStatuses = emptyMap()
        notificationManager.cancel(DOWNLOAD_NOTIFICATION_ID)
    }

    /** Send a remote download command to a specific PC. */
    fun sendRemoteDownload(pcId: String, qbIds: List<String>, artifactTypes: List<String>, autoStart: Boolean) {
        val payload = JSONObject().apply {
            put("type", "remote_download")
            put("pcId", pcId)
            put("qbIds", JSONArray(qbIds))
            put("artifactTypes", JSONArray(artifactTypes))
            put("autoStart", autoStart)
        }
        ws?.send(payload.toString())
    }

    fun sendRemoteDeleteGroup(pcId: String, groupId: String) {
        val payload = JSONObject().apply {
            put("type", "remote_delete_group")
            put("pcId", pcId)
            put("groupId", groupId)
        }
        ws?.send(payload.toString())
    }

    fun sendRemoteCancelGroup(pcId: String, groupId: String, pin: String) {
        val payload = JSONObject().apply {
            put("type", "remote_cancel_group")
            put("pcId", pcId)
            put("groupId", groupId)
            put("pin", pin)
        }
        ws?.send(payload.toString())
    }

    fun sendRemoteCancelAll(pcId: String, pin: String) {
        val payload = JSONObject().apply {
            put("type", "remote_cancel_all")
            put("pcId", pcId)
            put("pin", pin)
        }
        ws?.send(payload.toString())
    }

    fun sendRemoteCancelArtifact(pcId: String, groupId: String, artifactId: String, pin: String) {
        val payload = JSONObject().apply {
            put("type", "remote_cancel_artifact")
            put("pcId", pcId)
            put("groupId", groupId)
            put("artifactId", artifactId)
            put("pin", pin)
        }
        ws?.send(payload.toString())
    }

    fun sendRemoteDeleteArtifact(pcId: String, groupId: String, artifactId: String) {
        val payload = JSONObject().apply {
            put("type", "remote_delete_artifact")
            put("pcId", pcId)
            put("groupId", groupId)
            put("artifactId", artifactId)
        }
        ws?.send(payload.toString())
    }

    fun sendRemoteRestartArtifact(pcId: String, groupId: String, artifactId: String) {
        val payload = JSONObject().apply {
            put("type", "remote_restart_artifact")
            put("pcId", pcId)
            put("groupId", groupId)
            put("artifactId", artifactId)
        }
        ws?.send(payload.toString())
    }

    fun sendRemoteStartArtifact(pcId: String, groupId: String, artifactId: String) {
        val payload = JSONObject().apply {
            put("type", "remote_start_artifact")
            put("pcId", pcId)
            put("groupId", groupId)
            put("artifactId", artifactId)
        }
        ws?.send(payload.toString())
    }

    fun sendRemoteSetArtifactSelected(pcId: String, groupId: String, artifactId: String, selected: Boolean) {
        val payload = JSONObject().apply {
            put("type", "remote_set_artifact_selected")
            put("pcId", pcId)
            put("groupId", groupId)
            put("artifactId", artifactId)
            put("selected", selected)
        }
        ws?.send(payload.toString())
    }

    fun sendRemoteStartGroup(pcId: String, groupId: String) {
        val payload = JSONObject().apply {
            put("type", "remote_start_group")
            put("pcId", pcId)
            put("groupId", groupId)
        }
        ws?.send(payload.toString())
    }

    private fun parseStateUpdate(msg: JSONObject) {
        val arr = msg.getJSONArray("pcs")
        val list = (0 until arr.length()).map { i ->
            val pc = arr.getJSONObject(i)
            
            val sysStatsObj = pc.optJSONObject("sysStats")
            val sysStats = if (sysStatsObj != null) {
                SystemStats(
                    cpuUsage = sysStatsObj.optDouble("cpuUsage", 0.0).toFloat(),
                    ramTotal = sysStatsObj.optLong("ramTotal", 0),
                    ramUsed = sysStatsObj.optLong("ramUsed", 0),
                    diskTotal = sysStatsObj.optLong("diskTotal", 0),
                    diskAvailable = sysStatsObj.optLong("diskAvailable", 0),
                    totalSpeed = sysStatsObj.optLong("totalSpeed", 0),
                )
            } else null

            val presetTypesArr = pc.optJSONArray("presetTypes") ?: JSONArray()
            val presetTypes = (0 until presetTypesArr.length()).map { presetTypesArr.getString(it) }

            val groupsArr = pc.optJSONArray("groups") ?: JSONArray()
            val groups = (0 until groupsArr.length()).map { g ->
                val groupObj = groupsArr.getJSONObject(g)
                val artifactsArr = groupObj.optJSONArray("artifacts") ?: JSONArray()
                val artifacts = (0 until artifactsArr.length()).map { a ->
                    val artObj = artifactsArr.getJSONObject(a)
                    Artifact(
                        id = artObj.optString("id", ""),
                        name = artObj.optString("name", ""),
                        size = artObj.optLong("size", 0),
                        selected = artObj.optBoolean("selected", true),
                    )
                }
                val customFiltersArr = groupObj.optJSONArray("customFilters")
                BuildArtifactGroup(
                    id = groupObj.optString("id", ""),
                    input = groupObj.optString("input", ""),
                    buildId = groupObj.optString("buildId", "").takeIf { it.isNotBlank() },
                    name = groupObj.optString("name", "").takeIf { it.isNotBlank() },
                    status = groupObj.optString("status", ""),
                    customFilters = customFiltersArr?.let { filters -> (0 until filters.length()).map(filters::getString) },
                    artifacts = artifacts,
                )
            }

            val rowsObj = pc.optJSONObject("rows") ?: JSONObject()
            val rows = mutableMapOf<String, DownloadEvent>()
            val keys = rowsObj.keys()
            while (keys.hasNext()) {
                val key = keys.next()
                val rowObj = rowsObj.getJSONObject(key)
                rows[key] = DownloadEvent(
                    jobId = rowObj.optString("jobId", ""),
                    artifactId = rowObj.optString("artifactId", ""),
                    buildId = rowObj.optString("buildId", ""),
                    name = rowObj.optString("name", ""),
                    status = rowObj.optString("status", ""),
                    downloaded = rowObj.optLong("downloaded", 0),
                    total = rowObj.optLong("total", 0),
                    message = rowObj.optString("message", "").takeIf { it.isNotBlank() },
                )
            }

            PcState(
                pcId = pc.getString("pcId"),
                pcName = pc.optString("pcName", pc.getString("pcId").take(8)),
                ip = pc.optString("ip", ""),
                os = pc.optString("os", "Windows"),
                online = pc.optBoolean("online", false),
                lastSeen = pc.optString("lastSeen", ""),
                sysStats = sysStats,
                presetTypes = presetTypes,
                groups = groups,
                rows = rows,
            )
        }
        pcs.value = list
        updateDownloadNotification(list)
        notifyDownloadResults(list)
    }

    private fun updateDownloadNotification(pcs: List<PcState>) {
        if (Build.VERSION.SDK_INT >= 33 && context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return
        val active = pcs.flatMap { it.rows.values }.filter { it.status in listOf("queued", "downloading", "retrying") }
        if (active.isEmpty()) {
            notificationManager.cancel(DOWNLOAD_NOTIFICATION_ID)
            return
        }

        val downloaded = active.sumOf { it.downloaded }
        val total = active.sumOf { it.total }
        val percent = if (total > 0) ((downloaded * 100) / total).toInt().coerceAtMost(100) else 0
        val fileLines = active.sortedBy { if (it.status == "downloading") 0 else 1 }.map {
            val filePercent = if (it.total > 0) ((it.downloaded * 100) / it.total).toInt().coerceAtMost(100) else 0
            "$filePercent% · ${it.name} · ${it.status}"
        }
        val detailStyle = Notification.InboxStyle().setBigContentTitle("Remote downloads in progress")
        fileLines.forEach { detailStyle.addLine(it) }
        val intent = PendingIntent.getActivity(
            context,
            0,
            Intent(context, MainActivity::class.java).apply { flags = Intent.FLAG_ACTIVITY_SINGLE_TOP },
            PendingIntent.FLAG_IMMUTABLE,
        )
        val notification = Notification.Builder(context, DOWNLOAD_CHANNEL_ID)
            .setSmallIcon(android.R.drawable.stat_sys_download)
            .setContentTitle("Remote downloads in progress")
            .setContentText(fileLines.firstOrNull() ?: "${active.size} file(s) · $percent%")
            .setContentIntent(intent)
            .setOnlyAlertOnce(true)
            .setOngoing(true)
            .setAutoCancel(false)
            .setCategory(Notification.CATEGORY_PROGRESS)
            .setProgress(100, percent, total == 0L)
            .setStyle(detailStyle)
            .build()
        notificationManager.notify(DOWNLOAD_NOTIFICATION_ID, notification)
    }

    private fun notifyDownloadResults(pcs: List<PcState>) {
        val activeStatuses = setOf("queued", "downloading", "retrying")
        val currentStatuses = pcs.flatMap { pc ->
            pc.rows.map { (artifactId, row) -> "${pc.pcId}:$artifactId" to row.status }
        }.toMap()
        val completed = currentStatuses.count { (id, status) -> status == "completed" && previousStatuses[id] in activeStatuses }
        val failed = currentStatuses.count { (id, status) -> status == "failed" && previousStatuses[id] in activeStatuses }
        previousStatuses = currentStatuses
        if (completed == 0 && failed == 0) return
        if (Build.VERSION.SDK_INT >= 33 && context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return

        val result = listOfNotNull(
            completed.takeIf { it > 0 }?.let { "$it completed" },
            failed.takeIf { it > 0 }?.let { "$it failed" },
        ).joinToString(" · ")
        val intent = PendingIntent.getActivity(
            context,
            RESULT_NOTIFICATION_ID,
            Intent(context, MainActivity::class.java).apply { flags = Intent.FLAG_ACTIVITY_SINGLE_TOP },
            PendingIntent.FLAG_IMMUTABLE,
        )
        notificationManager.notify(
            RESULT_NOTIFICATION_ID,
            Notification.Builder(context, RESULT_CHANNEL_ID)
                .setSmallIcon(android.R.drawable.stat_sys_download_done)
                .setContentTitle("Download update")
                .setContentText(result)
                .setContentIntent(intent)
                .setAutoCancel(true)
                .setCategory(Notification.CATEGORY_STATUS)
                .build()
        )
    }

    private fun buildWsUrl(base: String, path: String): String {
        val b = base.trim().trimEnd('/').replace(Regex("^http"), "ws")
        val key = apiKey.trim()
        return if (key.isNotBlank()) "$b$path?token=${key}" else "$b$path"
    }

    private fun scheduleReconnect() {
        cancelReconnect()
        reconnectJob = java.util.Timer().apply {
            schedule(object : java.util.TimerTask() {
                override fun run() { connect() }
            }, 5_000L)
        }
    }

    private fun cancelReconnect() {
        reconnectJob?.cancel()
        reconnectJob = null
    }
}
