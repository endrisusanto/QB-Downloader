package id.endrisusanto.qbdashboard.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import id.endrisusanto.qbdashboard.data.PcJob
import id.endrisusanto.qbdashboard.data.ServerClient
import kotlin.math.min
import kotlin.math.roundToInt

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PcDetailScreen(pcId: String, serverClient: ServerClient, onBack: () -> Unit) {
    val pcs by serverClient.pcs.collectAsState()
    val pc = pcs.firstOrNull { it.pcId == pcId }
    var showDownload by remember { mutableStateOf(false) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(pc?.pcName ?: pcId) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back")
                    }
                },
                actions = {
                    if (pc?.online == true) {
                        TextButton(onClick = { showDownload = true }) { Text("Remote Download") }
                    }
                },
            )
        }
    ) { padding ->
        if (pc == null) {
            Box(Modifier.padding(padding).fillMaxSize()) {
                Text("PC not found", modifier = Modifier.padding(16.dp))
            }
        } else {
            LazyColumn(
                contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = padding.calculateTopPadding() + 8.dp, bottom = 16.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                if (pc.jobs.isEmpty()) {
                    item { Text("No active downloads.", color = MaterialTheme.colorScheme.onSurfaceVariant) }
                } else {
                    items(pc.jobs, key = { it.artifactId }) { job ->
                        JobCard(job)
                    }
                }
            }
        }
    }

    if (showDownload && pc != null) {
        RemoteDownloadDialog(
            pcName = pc.pcName,
            onDismiss = { showDownload = false },
            onConfirm = { qbId, types ->
                serverClient.sendRemoteDownload(pc.pcId, qbId, types)
                showDownload = false
            },
        )
    }
}

@Composable
fun JobCard(job: PcJob) {
    val pct = when {
        job.status == "completed" -> 1f
        job.total != null && job.total > 0 -> min(1f, job.downloaded.toFloat() / job.total)
        else -> 0f
    }
    val statusColor = when (job.status) {
        "completed" -> MaterialTheme.colorScheme.primary
        "failed" -> MaterialTheme.colorScheme.error
        "downloading", "queued", "retrying" -> MaterialTheme.colorScheme.tertiary
        else -> MaterialTheme.colorScheme.onSurfaceVariant
    }

    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(14.dp)) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text(
                    job.name,
                    modifier = Modifier.weight(1f),
                    style = MaterialTheme.typography.bodyMedium,
                    fontWeight = FontWeight.Medium,
                    overflow = TextOverflow.Ellipsis,
                    maxLines = 1,
                )
                Spacer(Modifier.width(8.dp))
                Text(
                    job.status,
                    style = MaterialTheme.typography.labelSmall,
                    color = statusColor,
                    fontWeight = FontWeight.SemiBold,
                )
            }
            Spacer(Modifier.height(8.dp))
            LinearProgressIndicator(
                progress = { pct },
                modifier = Modifier.fillMaxWidth(),
                color = statusColor,
            )
            Spacer(Modifier.height(4.dp))
            Text(
                "${(pct * 100).roundToInt()}% · ${formatBytes(job.downloaded)} / ${job.total?.let(::formatBytes) ?: "?"}",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

private fun formatBytes(bytes: Long): String {
    if (bytes <= 0) return "0 B"
    val units = arrayOf("B", "KB", "MB", "GB")
    val i = min((Math.log(bytes.toDouble()) / Math.log(1024.0)).toInt(), units.size - 1)
    return "%.1f %s".format(bytes / Math.pow(1024.0, i.toDouble()), units[i])
}
