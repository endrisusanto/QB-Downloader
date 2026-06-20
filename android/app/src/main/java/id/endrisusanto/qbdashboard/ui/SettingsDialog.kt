package id.endrisusanto.qbdashboard.ui

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import id.endrisusanto.qbdashboard.data.ServerClient

@Composable
fun SettingsDialog(serverClient: ServerClient, onDismiss: () -> Unit) {
    var url by remember { mutableStateOf(serverClient.serverUrl) }
    var key by remember { mutableStateOf(serverClient.apiKey) }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Settings") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                OutlinedTextField(
                    value = url,
                    onValueChange = { url = it },
                    label = { Text("Server URL") },
                    placeholder = { Text("https://qd.endrisusanto.my.id") },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true,
                )
                OutlinedTextField(
                    value = key,
                    onValueChange = { key = it },
                    label = { Text("API Key (optional)") },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true,
                )
            }
        },
        confirmButton = {
            Button(onClick = {
                serverClient.serverUrl = url.trim()
                serverClient.apiKey = key.trim()
                serverClient.connect()
                onDismiss()
            }) { Text("Save & Connect") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}
