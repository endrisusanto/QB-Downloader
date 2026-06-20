package id.endrisusanto.qbdashboard.data

import android.content.Context
import android.content.SharedPreferences
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
    }

    private val prefs: SharedPreferences = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    private val http = OkHttpClient.Builder()
        .readTimeout(0, TimeUnit.MILLISECONDS) // keep-alive for WS
        .build()

    private var ws: WebSocket? = null
    private var reconnectJob: java.util.Timer? = null

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
    }

    /** Send a remote download command to a specific PC. */
    fun sendRemoteDownload(pcId: String, qbId: String, artifactTypes: List<String>, autoStart: Boolean) {
        val payload = JSONObject().apply {
            put("type", "remote_download")
            put("pcId", pcId)
            put("qbId", qbId)
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
                BuildArtifactGroup(
                    id = groupObj.optString("id", ""),
                    input = groupObj.optString("input", ""),
                    buildId = groupObj.optString("buildId", "").takeIf { it.isNotBlank() },
                    name = groupObj.optString("name", "").takeIf { it.isNotBlank() },
                    status = groupObj.optString("status", ""),
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
