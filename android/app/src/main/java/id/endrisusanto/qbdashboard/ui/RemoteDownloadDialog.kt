package id.endrisusanto.qbdashboard.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

private val FILTER_OPTIONS = listOf("ALL_", "AP_", "BL_", "CP_", "CSC_", "md5", "USERDATA_", "HOME_")

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun RemoteDownloadDialog(
    pcName: String,
    presetTypes: List<String>,
    onDismiss: () -> Unit,
    onConfirm: (qbId: String, artifactTypes: List<String>, autoStart: Boolean) -> Unit,
) {
    var qbId by remember { mutableStateOf("") }
    var selectedTypes by remember {
        mutableStateOf(if (presetTypes.isNotEmpty()) presetTypes.toSet() else FILTER_OPTIONS.toSet())
    }
    var fetchOnly by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf("") }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Remote Download") },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                Text("Target: $pcName", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)

                OutlinedTextField(
                    value = qbId,
                    onValueChange = { qbId = it; error = "" },
                    label = { Text("QB Build ID or URL") },
                    placeholder = { Text("e.g. 12345678") },
                    isError = error.isNotBlank(),
                    supportingText = if (error.isNotBlank()) ({ Text(error) }) else null,
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true,
                )

                Text("Artifact Types", style = MaterialTheme.typography.labelMedium)
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    FILTER_OPTIONS.forEach { filter ->
                        val selected = filter in selectedTypes
                        FilterChip(
                            selected = selected,
                            onClick = {
                                selectedTypes = if (selected) selectedTypes - filter else selectedTypes + filter
                            },
                            label = { Text(filter) },
                            border = FilterChipDefaults.filterChipBorder(
                                enabled = true,
                                selected = selected,
                                borderColor = MaterialTheme.colorScheme.outline,
                                selectedBorderColor = MaterialTheme.colorScheme.primary,
                            ),
                        )
                    }
                }

                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable { fetchOnly = !fetchOnly }
                        .padding(vertical = 4.dp)
                ) {
                    Checkbox(
                        checked = fetchOnly,
                        onCheckedChange = { fetchOnly = it }
                    )
                    Text("Fetch only (do not auto-start)", style = MaterialTheme.typography.bodyMedium)
                }
            }
        },
        confirmButton = {
            Button(onClick = {
                when {
                    qbId.isBlank() -> error = "Enter a build ID or URL"
                    selectedTypes.isEmpty() -> error = "Select at least one artifact type"
                    else -> onConfirm(qbId.trim(), selectedTypes.toList(), !fetchOnly)
                }
            }) { Text("Start Download") }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text("Cancel") }
        },
    )
}
