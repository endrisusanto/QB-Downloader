package id.endrisusanto.qbdashboard.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
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
            onDismiss = { downloadTarget = null },
            onConfirm = { qbId, types ->
                serverClient.sendRemoteDownload(pc.pcId, qbId, types)
                downloadTarget = null
            },
        )
    }
}

@Composable
fun PcCard(pc: PcState, onClick: () -> Unit, onRemoteDownload: () -> Unit) {
    val active = pc.jobs.count { it.status in listOf("queued", "downloading", "retrying") }
    val completed = pc.jobs.count { it.status == "completed" }

    Card(
        modifier = Modifier.fillMaxWidth().clickable(onClick = onClick),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
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

            Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                StatChip("Active", "$active")
                StatChip("Done", "$completed")
                StatChip("Total", "${pc.jobs.size}")
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
fun StatChip(label: String, value: String) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Text(value, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold)
        Text(label, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}
