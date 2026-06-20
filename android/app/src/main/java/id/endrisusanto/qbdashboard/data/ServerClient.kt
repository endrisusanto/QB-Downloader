package id.endrisusanto.qbdashboard.data

import android.content.Context
import android.content.SharedPreferences
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import okhttp3.*
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.TimeUnit

data class PcJob(
    val artifactId: String,
    val name: String,
    val status: String,
    val downloaded: Long,
    val total: Long?,
)

data class PcState(
    val pcId: String,
    val pcName: String,
    val os: String,
    val online: Boolean,
    val lastSeen: String,
    val jobs: List<PcJob>,
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
        get() = prefs.getString(PREF_SERVER_URL, "") ?: ""
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
    fun sendRemoteDownload(pcId: String, qbId: String, artifactTypes: List<String>) {
        val payload = JSONObject().apply {
            put("type", "remote_download")
            put("pcId", pcId)
            put("qbId", qbId)
            put("artifactTypes", JSONArray(artifactTypes))
        }
        ws?.send(payload.toString())
    }

    private fun parseStateUpdate(msg: JSONObject) {
        val arr = msg.getJSONArray("pcs")
        val list = (0 until arr.length()).map { i ->
            val pc = arr.getJSONObject(i)
            val jobsArr = pc.optJSONArray("jobs") ?: JSONArray()
            val jobs = (0 until jobsArr.length()).map { j ->
                val job = jobsArr.getJSONObject(j)
                PcJob(
                    artifactId = job.optString("artifactId", ""),
                    name = job.optString("name", ""),
                    status = job.optString("status", ""),
                    downloaded = job.optLong("downloaded", 0),
                    total = job.optLong("total", -1).takeIf { it >= 0 },
                )
            }
            PcState(
                pcId = pc.getString("pcId"),
                pcName = pc.optString("pcName", pc.getString("pcId").take(8)),
                os = pc.optString("os", "Windows"),
                online = pc.optBoolean("online", false),
                lastSeen = pc.optString("lastSeen", ""),
                jobs = jobs,
            )
        }
        pcs.value = list
    }

    private fun buildWsUrl(base: String, path: String): String {
        val b = base.trimEnd('/').replace(Regex("^http"), "ws")
        val key = apiKey
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
