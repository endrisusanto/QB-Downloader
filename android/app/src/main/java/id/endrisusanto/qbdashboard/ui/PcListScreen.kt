package id.endrisusanto.qbdashboard.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import id.endrisusanto.qbdashboard.data.PcState
import id.endrisusanto.qbdashboard.data.ServerClient

fun formatBytes(bytes: Long): String {
    if (bytes <= 0) return "0 B"
    val units = listOf("B", "KB", "MB", "GB", "TB")
    val digitGroups = (Math.log10(bytes.toDouble()) / Math.log10(1024.0)).toInt()
    val value = bytes / Math.pow(1024.0, digitGroups.toDouble())
    return String.format(java.util.Locale.US, "%.1f %s", value, units[digitGroups])
}

@Composable
fun PcListScreen(serverClient: ServerClient, onPcClick: (String) -> Unit) {
    val pcs by serverClient.pcs.collectAsState()
    var downloadTarget by remember { mutableStateOf<PcState?>(null) }

    if (pcs.isEmpty()) {
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Text("📡", style = MaterialTheme.typography.displayMedium)
                Spacer(Modifier.height(16.dp))
                Text("No PCs connected", style = MaterialTheme.typography.titleLarge)
                Spacer(Modifier.height(8.dp))
                Text("Open QB Downloader on a Windows PC\nand configure the server URL.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    textAlign = androidx.compose.ui.text.style.TextAlign.Center,
                )
            }
        }
        return
    }

    LazyColumn(
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        items(pcs, key = { it.pcId }) { pc ->
            PcCard(pc = pc, onClick = { onPcClick(pc.pcId) }, onRemoteDownload = { downloadTarget = pc })
        }
    }

    downloadTarget?.let { pc ->
        RemoteDownloadDialog(
            pcName = pc.pcName,
            presetTypes = pc.presetTypes,
            onDismiss = { downloadTarget = null },
            onConfirm = { qbId, types, autoStart ->
                serverClient.sendRemoteDownload(pc.pcId, qbId, types, autoStart)
                downloadTarget = null
            },
        )
    }
}

@Composable
fun PcCard(pc: PcState, onClick: () -> Unit, onRemoteDownload: () -> Unit) {
    val total = pc.groups.flatMap { it.artifacts }.size
    val active = pc.rows.values.count { it.status in listOf("queued", "downloading", "retrying") }
    val completed = pc.rows.values.count { it.status == "completed" }

    ElevatedCard(
        modifier = Modifier.fillMaxWidth().clickable(onClick = onClick),
        colors = CardDefaults.elevatedCardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.elevatedCardElevation(defaultElevation = 2.dp),
    ) {
        Column(Modifier.padding(16.dp)) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(pc.pcName, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                    Text(pc.os, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                Surface(
                    color = if (pc.online) MaterialTheme.colorScheme.primary.copy(alpha = 0.15f)
                            else MaterialTheme.colorScheme.error.copy(alpha = 0.15f),
                    shape = MaterialTheme.shapes.small,
                ) {
                    Text(
                        if (pc.online) "Online" else "Offline",
                        modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp),
                        style = MaterialTheme.typography.labelSmall,
                        color = if (pc.online) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.error,
                    )
                }
            }

            Spacer(Modifier.height(12.dp))

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                StatChip("Active", "$active")
                StatChip("Done", "$completed")
                StatChip("Total", "$total")
            }

            if (pc.sysStats != null) {
                Spacer(Modifier.height(12.dp))
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.5f))
                Spacer(Modifier.height(12.dp))

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    Column(Modifier.weight(1f)) {
                        Text("CPU  ${String.format(java.util.Locale.US, "%.1f", pc.sysStats.cpuUsage)}%", style = MaterialTheme.typography.bodySmall)
                        Text("RAM  ${formatBytes(pc.sysStats.ramUsed)} / ${formatBytes(pc.sysStats.ramTotal)}", style = MaterialTheme.typography.bodySmall)
                    }
                    Column(Modifier.weight(1f)) {
                        Text("Storage  ${formatBytes(pc.sysStats.diskAvailable)} free", style = MaterialTheme.typography.bodySmall)
                        Text("Speed  ${formatBytes(pc.sysStats.totalSpeed)}/s", style = MaterialTheme.typography.bodySmall)
                    }
                }
            }

            Spacer(Modifier.height(12.dp))

            Button(
                onClick = onRemoteDownload,
                enabled = pc.online,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text("Remote Download")
            }
        }
    }
}

@Composable
fun RowScope.StatChip(label: String, value: String) {
    Surface(
        modifier = Modifier.weight(1f),
        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.65f),
        shape = MaterialTheme.shapes.small,
    ) {
        Column(
            modifier = Modifier.padding(vertical = 8.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text(value, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold)
            Text(label, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}
