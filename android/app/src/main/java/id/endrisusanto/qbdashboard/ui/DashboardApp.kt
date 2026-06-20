package id.endrisusanto.qbdashboard.ui

import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import id.endrisusanto.qbdashboard.data.ConnectionStatus
import id.endrisusanto.qbdashboard.data.ServerClient

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DashboardApp(serverClient: ServerClient) {
    val navController = rememberNavController()
    val connectionStatus by serverClient.connectionStatus.collectAsState()
    var showSettings by remember { mutableStateOf(false) }

    LaunchedEffect(serverClient.serverUrl) {
        if (serverClient.serverUrl.isNotBlank()) serverClient.connect()
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("QB Remote Dashboard") },
                actions = {
                    ConnectionBadge(connectionStatus)
                    Spacer(Modifier.width(8.dp))
                    IconButton(onClick = { showSettings = true }) {
                        Icon(Icons.Default.Settings, "Settings")
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.surface,
                    titleContentColor = MaterialTheme.colorScheme.onSurface,
                )
            )
        }
    ) { padding ->
        Box(Modifier.padding(padding).fillMaxSize()) {
            NavHost(navController = navController, startDestination = "pcs") {
                composable("pcs") {
                    PcListScreen(
                        serverClient = serverClient,
                        onPcClick = { pcId -> navController.navigate("pc/$pcId") },
                    )
                }
                composable(
                    "pc/{pcId}",
                    arguments = listOf(navArgument("pcId") { type = NavType.StringType })
                ) { back ->
                    PcDetailScreen(
                        pcId = back.arguments?.getString("pcId") ?: "",
                        serverClient = serverClient,
                        onBack = { navController.popBackStack() },
                    )
                }
            }
        }
    }

    if (showSettings) {
        SettingsDialog(serverClient = serverClient, onDismiss = { showSettings = false })
    }
}

@Composable
fun ConnectionBadge(status: ConnectionStatus) {
    val (label, color) = when (status) {
        ConnectionStatus.CONNECTED -> "Online" to MaterialTheme.colorScheme.primary
        ConnectionStatus.CONNECTING -> "Connecting" to MaterialTheme.colorScheme.tertiary
        ConnectionStatus.DISCONNECTED -> "Offline" to MaterialTheme.colorScheme.error
    }
    Surface(
        color = color.copy(alpha = 0.15f),
        shape = MaterialTheme.shapes.small,
    ) {
        Text(
            text = label,
            modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp),
            style = MaterialTheme.typography.labelSmall,
            color = color,
        )
    }
}
