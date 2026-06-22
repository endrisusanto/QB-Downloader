package id.endrisusanto.qbdashboard.ui

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateContentSize
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.tween
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
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
        val artifacts = group.artifacts
        val hasActiveOrFinished = artifacts.any { a ->
            val status = rows[a.id]?.status
            status in listOf("queued", "downloading", "retrying", "completed", "failed")
        }
        if (!hasActiveOrFinished) {
            fetched.add(group)
        }

        val failedSelected = artifacts.filter { rows[it.id]?.status == "failed" }
        if (failedSelected.isNotEmpty()) {
            failed.add(group.copy(artifacts = failedSelected))
        }

        val progressSelected = artifacts.filter { rows[it.id]?.status in listOf("queued", "downloading", "retrying") }
        if (progressSelected.isNotEmpty()) {
            progress.add(group.copy(artifacts = progressSelected))
        }

        val completedSelected = artifacts.filter { rows[it.id]?.status == "completed" }
        if (completedSelected.isNotEmpty()) {
            completed.add(group.copy(artifacts = completedSelected))
        }
    }

    return ClassifiedGroups(fetched, progress, completed, failed)
}

@OptIn(ExperimentalFoundationApi::class, ExperimentalMaterial3Api::class)
@Composable
fun PcDetailScreen(pcId: String, serverClient: ServerClient) {
    val pcs by serverClient.pcs.collectAsState()
    val pc = pcs.firstOrNull { it.pcId == pcId }
    var showDownload by remember { mutableStateOf(false) }

    var fetchedExpanded by remember { mutableStateOf(true) }
    var progressExpanded by remember { mutableStateOf(true) }
    var completedExpanded by remember { mutableStateOf(true) }
    var failedExpanded by remember { mutableStateOf(true) }
    var confirmDeleteFetched by remember { mutableStateOf(false) }
    var confirmCancelAll by remember { mutableStateOf(false) }

    Box(Modifier.fillMaxSize()) {
        if (pc == null) {
            Box(Modifier.fillMaxSize()) {
                Text("PC not found", modifier = Modifier.padding(16.dp))
            }
        } else {
            val classified = remember(pc.groups, pc.rows) { classifyPcGroups(pc.groups, pc.rows) }
            val listState = rememberLazyListState()
            val headerPinned by remember { derivedStateOf { listState.firstVisibleItemIndex > 0 || listState.firstVisibleItemScrollOffset > 0 } }

            LazyColumn(
                modifier = Modifier.fillMaxSize().statusBarsPadding(),
                state = listState,
                contentPadding = PaddingValues(top = 16.dp, bottom = 16.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                stickyHeader {
                    val headerInset by animateDpAsState(if (headerPinned) 0.dp else 16.dp, label = "header inset")
                    AnimatedVisibility(
                        visible = true,
                        enter = fadeIn(tween(220)) + expandVertically(tween(220)),
                    ) {
                        Card(
                            modifier = Modifier.fillMaxWidth().padding(horizontal = headerInset).animateContentSize(),
                            shape = if (headerPinned) RoundedCornerShape(0.dp) else MaterialTheme.shapes.medium,
                            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant),
                        ) {
                            Column(Modifier.padding(12.dp)) {
                                Text(pc.pcName, modifier = Modifier.fillMaxWidth(), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, textAlign = TextAlign.Center)
                                Spacer(Modifier.height(8.dp))
                                Button(
                                    onClick = { showDownload = true },
                                    enabled = pc.online,
                                    modifier = Modifier.fillMaxWidth(),
                                ) { Text("Remote Download") }
                                pc.sysStats?.let { stats ->
                                    Spacer(Modifier.height(10.dp))
                                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                        ResourceBadge("CPU", "${String.format(java.util.Locale.US, "%.1f", stats.cpuUsage)}%")
                                        ResourceBadge("RAM", "${formatBytes(stats.ramUsed)} / ${formatBytes(stats.ramTotal)}")
                                    }
                                    Spacer(Modifier.height(8.dp))
                                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                        ResourceBadge("Storage", "${formatBytes(stats.diskAvailable)} free")
                                        ResourceBadge("Speed", "${formatBytes(stats.totalSpeed)}/s")
                                    }
                                }
                            }
                        }
                    }
                }

                item {
                    AccordionSection("Fetched Builds", classified.fetched.size, fetchedExpanded, { fetchedExpanded = !fetchedExpanded }) {
                        if (classified.fetched.isEmpty()) EmptyAccordionMessage() else {
                            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                Button({ classified.fetched.forEach { serverClient.sendRemoteStartGroup(pc.pcId, it.id) } }, Modifier.weight(1f)) { Text("Download all") }
                                OutlinedButton({ confirmDeleteFetched = true }, Modifier.weight(1f), colors = ButtonDefaults.outlinedButtonColors(contentColor = MaterialTheme.colorScheme.error)) { Text("Delete all") }
                            }
                            classified.fetched.forEach { FetchedGroupCard(pc.pcId, it, pc.presetTypes, serverClient) }
                        }
                    }
                }
                item {
                    AccordionSection("Progress", classified.progress.size, progressExpanded, { progressExpanded = !progressExpanded }) {
                        if (classified.progress.isEmpty()) EmptyAccordionMessage() else {
                            OutlinedButton({ confirmCancelAll = true }, Modifier.fillMaxWidth(), colors = ButtonDefaults.outlinedButtonColors(contentColor = MaterialTheme.colorScheme.error), border = BorderStroke(1.dp, MaterialTheme.colorScheme.error.copy(alpha = 0.5f))) { Text("Cancel all") }
                            classified.progress.forEach { ProgressGroupCard(pc.pcId, it, pc.rows, serverClient) }
                        }
                    }
                }
                item {
                    AccordionSection("Completed", classified.completed.size, completedExpanded, { completedExpanded = !completedExpanded }) {
                        if (classified.completed.isEmpty()) EmptyAccordionMessage() else classified.completed.forEach { CompletedGroupCard(pc.pcId, it, serverClient) }
                    }
                }
                item {
                    AccordionSection("Failed", classified.failed.size, failedExpanded, { failedExpanded = !failedExpanded }) {
                        if (classified.failed.isEmpty()) EmptyAccordionMessage() else classified.failed.forEach { FailedGroupCard(pc.pcId, it, pc.rows, serverClient) }
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
            onConfirm = { qbIds, types, autoStart ->
                serverClient.sendRemoteDownload(pc.pcId, qbIds, types, autoStart)
                showDownload = false
            },
        )
    }
    if (confirmDeleteFetched && pc != null) {
        val fetched = classifyPcGroups(pc.groups, pc.rows).fetched
        AlertDialog(
            onDismissRequest = { confirmDeleteFetched = false },
            title = { Text("Delete fetched builds?") },
            text = { Text("This removes ${fetched.size} fetched build(s).") },
            confirmButton = {
                TextButton(onClick = {
                    fetched.forEach { serverClient.sendRemoteDeleteGroup(pc.pcId, it.id) }
                    confirmDeleteFetched = false
                }) { Text("Delete") }
            },
            dismissButton = { TextButton(onClick = { confirmDeleteFetched = false }) { Text("Cancel") } },
        )
    }
    if (confirmCancelAll && pc != null) {
        AlertDialog(
            onDismissRequest = { confirmCancelAll = false },
            title = { Text("Cancel all downloads?") },
            text = { Text("This cancels every active download on ${pc.pcName}.") },
            confirmButton = {
                TextButton(onClick = {
                    serverClient.sendRemoteCancelAll(pc.pcId)
                    confirmCancelAll = false
                }) { Text("Cancel all") }
            },
            dismissButton = { TextButton(onClick = { confirmCancelAll = false }) { Text("Keep downloading") } },
        )
    }
}

@Composable
private fun RowScope.ResourceBadge(label: String, value: String) {
    Surface(
        modifier = Modifier.weight(1f),
        color = MaterialTheme.colorScheme.surface,
        shape = MaterialTheme.shapes.small,
    ) {
        Column(Modifier.padding(horizontal = 10.dp, vertical = 8.dp)) {
            Text(label, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text(value, style = MaterialTheme.typography.bodySmall, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
    }
}

@Composable
private fun AccordionSection(
    title: String,
    count: Int,
    isExpanded: Boolean,
    onToggle: () -> Unit,
    content: @Composable ColumnScope.() -> Unit,
) {
    Card(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
    ) {
        Column {
            AccordionHeader(title, count, isExpanded, onToggle)
            if (isExpanded) Column(
                Modifier.fillMaxWidth().padding(12.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
                content = content,
            )
        }
    }
}

@Composable
private fun AccordionHeader(
    title: String,
    count: Int,
    isExpanded: Boolean,
    onToggle: () -> Unit,
) {
    val color = when (title) {
        "Fetched Builds" -> MaterialTheme.colorScheme.secondaryContainer
        "Progress" -> MaterialTheme.colorScheme.primaryContainer
        "Completed" -> MaterialTheme.colorScheme.tertiaryContainer
        else -> MaterialTheme.colorScheme.errorContainer
    }
    Surface(
        modifier = Modifier.fillMaxWidth().clickable(onClick = onToggle),
        color = color,
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
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.secondaryContainer)
    ) {
        Column(Modifier.padding(12.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                CopyableBuildId(group.buildId ?: group.input)
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
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.primaryContainer)
    ) {
        Column(Modifier.padding(12.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                CopyableBuildId(group.buildId ?: group.input)
                OutlinedButton(
                    onClick = { serverClient.sendRemoteCancelGroup(pcId, group.id) },
                    contentPadding = PaddingValues(horizontal = 12.dp, vertical = 4.dp),
                    colors = ButtonDefaults.outlinedButtonColors(contentColor = MaterialTheme.colorScheme.error),
                    border = BorderStroke(1.dp, MaterialTheme.colorScheme.error.copy(alpha = 0.5f)),
                    modifier = Modifier.height(32.dp)
                ) {
                    Text("Cancel", style = MaterialTheme.typography.labelMedium)
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
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Checkbox(
                            checked = a.selected,
                            onCheckedChange = { selected -> serverClient.sendRemoteSetArtifactSelected(pcId, group.id, a.id, selected) },
                            modifier = Modifier.size(32.dp),
                        )
                        ArtifactName(a.name, Modifier.weight(1f))
                    }
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
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.tertiaryContainer)
    ) {
        Column(Modifier.padding(12.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                CopyableBuildId(group.buildId ?: group.input)
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
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.errorContainer)
    ) {
        Column(Modifier.padding(12.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                CopyableBuildId(group.buildId ?: group.input)
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
    val context = LocalContext.current
    Text(name, style = MaterialTheme.typography.bodySmall, maxLines = 1, softWrap = false, overflow = TextOverflow.Clip, modifier = modifier.clickable { copyToClipboard(context, name) }.horizontalScroll(rememberScrollState()))
}

@Composable
private fun CopyableBuildId(value: String) {
    val context = LocalContext.current
    Text(value, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold, modifier = Modifier.clickable { copyToClipboard(context, value) })
}

private fun copyToClipboard(context: Context, value: String) {
    (context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager)
        .setPrimaryClip(ClipData.newPlainText("QuickBuild value", value))
}

private fun downloadPercent(row: DownloadEvent?): Int =
    if ((row?.total ?: 0L) > 0L) min(100, ((row!!.downloaded * 100) / row.total).toInt()) else 0
