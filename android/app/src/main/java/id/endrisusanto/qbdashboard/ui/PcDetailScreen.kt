package id.endrisusanto.qbdashboard.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import id.endrisusanto.qbdashboard.data.Artifact
import id.endrisusanto.qbdashboard.data.BuildArtifactGroup
import id.endrisusanto.qbdashboard.data.DownloadEvent
import id.endrisusanto.qbdashboard.data.ServerClient
import kotlin.math.min
import kotlin.math.roundToInt

data class ClassifiedGroups(
    val fetched: List<BuildArtifactGroup>,
    val progress: List<BuildArtifactGroup>,
    val completed: List<BuildArtifactGroup>,
    val failed: List<BuildArtifactGroup>
)

fun classifyPcGroups(groups: List<BuildArtifactGroup>, rows: Map<String, DownloadEvent>): ClassifiedGroups {
    val fetched = mutableListOf<BuildArtifactGroup>()
    val progress = mutableListOf<BuildArtifactGroup>()
    val completed = mutableListOf<BuildArtifactGroup>()
    val failed = mutableListOf<BuildArtifactGroup>()

    for (group in groups) {
        val selected = group.artifacts.filter { it.selected }
        val hasActiveOrFinished = selected.any { a ->
            val status = rows[a.id]?.status
            status in listOf("queued", "downloading", "retrying", "completed", "failed")
        }
        if (!hasActiveOrFinished) {
            fetched.add(group)
        }

        val failedSelected = selected.filter { rows[it.id]?.status == "failed" }
        if (failedSelected.isNotEmpty()) {
            failed.add(group.copy(artifacts = failedSelected))
        }

        val progressSelected = selected.filter { rows[it.id]?.status in listOf("queued", "downloading", "retrying") }
        if (progressSelected.isNotEmpty()) {
            progress.add(group.copy(artifacts = progressSelected))
        }

        val completedSelected = selected.filter { rows[it.id]?.status == "completed" }
        if (completedSelected.isNotEmpty()) {
            completed.add(group.copy(artifacts = completedSelected))
        }
    }

    return ClassifiedGroups(fetched, progress, completed, failed)
}

@OptIn(ExperimentalFoundationApi::class, ExperimentalMaterial3Api::class)
@Composable
fun PcDetailScreen(pcId: String, serverClient: ServerClient, onBack: () -> Unit) {
    val pcs by serverClient.pcs.collectAsState()
    val pc = pcs.firstOrNull { it.pcId == pcId }
    var showDownload by remember { mutableStateOf(false) }

    var fetchedExpanded by remember { mutableStateOf(true) }
    var progressExpanded by remember { mutableStateOf(true) }
    var completedExpanded by remember { mutableStateOf(true) }
    var failedExpanded by remember { mutableStateOf(true) }

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
            val classified = remember(pc.groups, pc.rows) { classifyPcGroups(pc.groups, pc.rows) }

            LazyColumn(
                modifier = Modifier.padding(padding),
                contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 8.dp, bottom = 16.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                if (pc.sysStats != null) {
                    stickyHeader {
                        Card(
                            modifier = Modifier.fillMaxWidth().padding(bottom = 8.dp),
                            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.3f))
                        ) {
                            Column(Modifier.padding(16.dp)) {
                                Text("System Resources", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold)
                                Spacer(Modifier.height(8.dp))
                                Row(
                                    modifier = Modifier.fillMaxWidth(),
                                    horizontalArrangement = Arrangement.SpaceBetween
                                ) {
                                    Column(Modifier.weight(1f)) {
                                        Text("💻 CPU: ${String.format(java.util.Locale.US, "%.1f", pc.sysStats.cpuUsage)}%", style = MaterialTheme.typography.bodySmall)
                                        Text("🧠 RAM: ${formatBytes(pc.sysStats.ramUsed)} / ${formatBytes(pc.sysStats.ramTotal)}", style = MaterialTheme.typography.bodySmall)
                                    }
                                    Column(Modifier.weight(1f)) {
                                        Text("💾 Storage: ${formatBytes(pc.sysStats.diskAvailable)} free", style = MaterialTheme.typography.bodySmall)
                                        Text("⚡ Speed: ${formatBytes(pc.sysStats.totalSpeed)}/s", style = MaterialTheme.typography.bodySmall)
                                    }
                                }
                            }
                        }
                    }
                }

                // 1. Fetched Builds Accordion
                item {
                    AccordionHeader("Fetched Builds", classified.fetched.size, fetchedExpanded) {
                        fetchedExpanded = !fetchedExpanded
                    }
                }
                if (fetchedExpanded) {
                    if (classified.fetched.isEmpty()) {
                        item { EmptyAccordionMessage() }
                    } else {
                        items(classified.fetched, key = { "fetched-" + it.id }) { g ->
                            FetchedGroupCard(pcId = pc.pcId, group = g, presetTypes = pc.presetTypes, serverClient = serverClient)
                        }
                    }
                }

                // 2. Progress Accordion
                item {
                    AccordionHeader("Progress", classified.progress.size, progressExpanded) {
                        progressExpanded = !progressExpanded
                    }
                }
                if (progressExpanded) {
                    if (classified.progress.isEmpty()) {
                        item { EmptyAccordionMessage() }
                    } else {
                        items(classified.progress, key = { "progress-" + it.id }) { g ->
                            ProgressGroupCard(pcId = pc.pcId, group = g, rows = pc.rows, serverClient = serverClient)
                        }
                    }
                }

                // 3. Completed Accordion
                item {
                    AccordionHeader("Completed", classified.completed.size, completedExpanded) {
                        completedExpanded = !completedExpanded
                    }
                }
                if (completedExpanded) {
                    if (classified.completed.isEmpty()) {
                        item { EmptyAccordionMessage() }
                    } else {
                        items(classified.completed, key = { "completed-" + it.id }) { g ->
                            CompletedGroupCard(pcId = pc.pcId, group = g, serverClient = serverClient)
                        }
                    }
                }

                // 4. Failed Accordion
                item {
                    AccordionHeader("Failed", classified.failed.size, failedExpanded) {
                        failedExpanded = !failedExpanded
                    }
                }
                if (failedExpanded) {
                    if (classified.failed.isEmpty()) {
                        item { EmptyAccordionMessage() }
                    } else {
                        items(classified.failed, key = { "failed-" + it.id }) { g ->
                            FailedGroupCard(pcId = pc.pcId, group = g, rows = pc.rows, serverClient = serverClient)
                        }
                    }
                }
            }
        }
    }

    if (showDownload && pc != null) {
        RemoteDownloadDialog(
            pcName = pc.pcName,
            presetTypes = pc.presetTypes,
            onDismiss = { showDownload = false },
            onConfirm = { qbId, types, autoStart ->
                serverClient.sendRemoteDownload(pc.pcId, qbId, types, autoStart)
                showDownload = false
            },
        )
    }
}

@Composable
fun AccordionHeader(
    title: String,
    count: Int,
    isExpanded: Boolean,
    onToggle: () -> Unit
) {
    val color = when (title) {
        "Fetched Builds" -> MaterialTheme.colorScheme.secondaryContainer
        "Progress" -> MaterialTheme.colorScheme.primaryContainer
        "Completed" -> MaterialTheme.colorScheme.tertiaryContainer
        else -> MaterialTheme.colorScheme.errorContainer
    }
    Card(
        modifier = Modifier.fillMaxWidth().clickable(onClick = onToggle),
        colors = CardDefaults.cardColors(containerColor = color)
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text("$title ($count)", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold)
            Text(if (isExpanded) "▼" else "▶", style = MaterialTheme.typography.labelSmall)
        }
    }
}

@Composable
fun EmptyAccordionMessage() {
    Text(
        "No builds in this category.",
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.6f),
        modifier = Modifier.padding(vertical = 4.dp, horizontal = 8.dp)
    )
}

@Composable
fun FetchedGroupCard(pcId: String, group: BuildArtifactGroup, presetTypes: List<String>, serverClient: ServerClient) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)
    ) {
        Column(Modifier.padding(12.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(group.buildId ?: group.input, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button(
                        onClick = { serverClient.sendRemoteStartGroup(pcId, group.id) },
                        contentPadding = PaddingValues(horizontal = 12.dp, vertical = 4.dp),
                        modifier = Modifier.height(32.dp)
                    ) {
                        Text("Download", style = MaterialTheme.typography.labelMedium)
                    }
                    OutlinedButton(
                        onClick = { serverClient.sendRemoteDeleteGroup(pcId, group.id) },
                        contentPadding = PaddingValues(horizontal = 12.dp, vertical = 4.dp),
                        colors = ButtonDefaults.outlinedButtonColors(contentColor = MaterialTheme.colorScheme.error),
                        border = BorderStroke(1.dp, MaterialTheme.colorScheme.error.copy(alpha = 0.5f)),
                        modifier = Modifier.height(32.dp)
                    ) {
                        Text("Delete", style = MaterialTheme.typography.labelMedium)
                    }
                }
            }
            Spacer(Modifier.height(8.dp))
            visibleArtifacts(group, presetTypes).forEach { a ->
                Row(Modifier.fillMaxWidth().padding(vertical = 2.dp), verticalAlignment = Alignment.CenterVertically) {
                    Checkbox(
                        checked = a.selected,
                        onCheckedChange = { selected -> serverClient.sendRemoteSetArtifactSelected(pcId, group.id, a.id, selected) },
                        modifier = Modifier.size(32.dp),
                    )
                    ArtifactName(a.name, Modifier.weight(1f))
                    TextButton(onClick = { serverClient.sendRemoteStartArtifact(pcId, group.id, a.id) }) { Text("Download") }
                    IconButton(onClick = { serverClient.sendRemoteDeleteArtifact(pcId, group.id, a.id) }, modifier = Modifier.size(32.dp)) {
                        Text("🗑️", style = MaterialTheme.typography.labelSmall)
                    }
                }
            }
        }
    }
}

@Composable
fun ProgressGroupCard(pcId: String, group: BuildArtifactGroup, rows: Map<String, DownloadEvent>, serverClient: ServerClient) {
    var totalSize = 0L
    var downloaded = 0L
    group.artifacts.forEach { a ->
        val row = rows[a.id]
        if (row != null) {
            totalSize += row.total
            downloaded += row.downloaded
        } else {
            totalSize += a.size
        }
    }
    val pct = if (totalSize > 0L) min(1f, downloaded.toFloat() / totalSize) else 0f

    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)
    ) {
        Column(Modifier.padding(12.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(group.buildId ?: group.input, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold)
                OutlinedButton(
                    onClick = { serverClient.sendRemoteDeleteGroup(pcId, group.id) },
                    contentPadding = PaddingValues(horizontal = 12.dp, vertical = 4.dp),
                    colors = ButtonDefaults.outlinedButtonColors(contentColor = MaterialTheme.colorScheme.error),
                    border = BorderStroke(1.dp, MaterialTheme.colorScheme.error.copy(alpha = 0.5f)),
                    modifier = Modifier.height(32.dp)
                ) {
                    Text("Delete", style = MaterialTheme.typography.labelMedium)
                }
            }
            Spacer(Modifier.height(8.dp))
            LinearProgressIndicator(
                progress = { pct },
                modifier = Modifier.fillMaxWidth(),
                color = MaterialTheme.colorScheme.primary
            )
            Spacer(Modifier.height(4.dp))
            Text(
                "${(pct * 100).roundToInt()}% · ${formatBytes(downloaded)} / ${formatBytes(totalSize)}",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            Spacer(Modifier.height(8.dp))
            group.artifacts.forEach { a ->
                val row = rows[a.id]
                val status = row?.status ?: "queued"
                Column(Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
                    ArtifactName(a.name)
                    Spacer(Modifier.height(4.dp))
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Surface(
                            color = MaterialTheme.colorScheme.primaryContainer,
                            contentColor = MaterialTheme.colorScheme.onPrimaryContainer,
                            shape = MaterialTheme.shapes.small
                        ) {
                            Text(
                                "${status.replaceFirstChar { it.uppercase() }} · ${downloadPercent(row)}%",
                                style = MaterialTheme.typography.labelSmall,
                                modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp)
                            )
                        }
                        OutlinedButton(
                            onClick = { serverClient.sendRemoteDeleteArtifact(pcId, group.id, a.id) },
                            contentPadding = PaddingValues(horizontal = 12.dp, vertical = 4.dp),
                            colors = ButtonDefaults.outlinedButtonColors(contentColor = MaterialTheme.colorScheme.error),
                            border = BorderStroke(1.dp, MaterialTheme.colorScheme.error.copy(alpha = 0.5f)),
                            modifier = Modifier.height(32.dp)
                        ) { Text("Cancel", style = MaterialTheme.typography.labelMedium) }
                    }
                }
            }
        }
    }
}

@Composable
fun CompletedGroupCard(pcId: String, group: BuildArtifactGroup, serverClient: ServerClient) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)
    ) {
        Column(Modifier.padding(12.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(group.buildId ?: group.input, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold)
                TextButton(
                    onClick = { serverClient.sendRemoteDeleteGroup(pcId, group.id) },
                    colors = ButtonDefaults.textButtonColors(contentColor = MaterialTheme.colorScheme.error),
                ) { Text("Delete") }
            }
            Spacer(Modifier.height(8.dp))
            group.artifacts.forEach { a ->
                Row(
                    modifier = Modifier.fillMaxWidth().padding(vertical = 2.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    ArtifactName(a.name, Modifier.weight(1f))
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        Text("completed", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.primary)
                        IconButton(
                            onClick = { serverClient.sendRemoteDeleteArtifact(pcId, group.id, a.id) },
                            modifier = Modifier.size(24.dp)
                        ) {
                            Text("🗑️", style = MaterialTheme.typography.labelSmall)
                        }
                    }
                }
            }
        }
    }
}

@Composable
fun FailedGroupCard(pcId: String, group: BuildArtifactGroup, rows: Map<String, DownloadEvent>, serverClient: ServerClient) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)
    ) {
        Column(Modifier.padding(12.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(group.buildId ?: group.input, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold)
                TextButton(
                    onClick = { serverClient.sendRemoteDeleteGroup(pcId, group.id) },
                    colors = ButtonDefaults.textButtonColors(contentColor = MaterialTheme.colorScheme.error),
                ) { Text("Delete") }
            }
            Spacer(Modifier.height(8.dp))
            group.artifacts.forEach { a ->
                val row = rows[a.id]
                Row(
                    modifier = Modifier.fillMaxWidth().padding(vertical = 2.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Column(modifier = Modifier.weight(1f)) {
                        ArtifactName(a.name)
                        if (row?.message != null) {
                            Text(row.message, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.error)
                        }
                    }
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(4.dp)
                    ) {
                        Text("failed", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.error)
                        IconButton(
                            onClick = { serverClient.sendRemoteStartArtifact(pcId, group.id, a.id) },
                            modifier = Modifier.size(32.dp)
                        ) {
                            Text("⬇", style = MaterialTheme.typography.labelSmall)
                        }
                        IconButton(
                            onClick = { serverClient.sendRemoteDeleteArtifact(pcId, group.id, a.id) },
                            modifier = Modifier.size(24.dp)
                        ) {
                            Text("🗑️", style = MaterialTheme.typography.labelSmall)
                        }
                    }
                }
            }
        }
    }
}

private fun visibleArtifacts(group: BuildArtifactGroup, presetTypes: List<String>): List<Artifact> {
    val filters = group.customFilters ?: presetTypes
    if (filters.isEmpty()) return group.artifacts
    return group.artifacts.filter { artifact ->
        filters.any { filter ->
            if (filter == "md5") artifact.name.endsWith(".md5", ignoreCase = true)
            else artifact.name.startsWith(filter, ignoreCase = true)
        }
    }
}

@Composable
private fun ArtifactName(name: String, modifier: Modifier = Modifier) {
    Text(name, style = MaterialTheme.typography.bodySmall, maxLines = 1, softWrap = false, overflow = TextOverflow.Clip, modifier = modifier.horizontalScroll(rememberScrollState()))
}

private fun downloadPercent(row: DownloadEvent?): Int =
    if ((row?.total ?: 0L) > 0L) min(100, ((row!!.downloaded * 100) / row.total).toInt()) else 0
