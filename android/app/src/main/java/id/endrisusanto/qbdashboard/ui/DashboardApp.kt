package id.endrisusanto.qbdashboard.ui

import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
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
    val pcs by serverClient.pcs.collectAsState()
    var showSettings by remember { mutableStateOf(false) }
    var selectedPcId by remember { mutableStateOf<String?>(null) }
    val activePcId = selectedPcId?.takeIf { id -> pcs.any { it.pcId == id } } ?: pcs.firstOrNull()?.pcId

    LaunchedEffect(serverClient.serverUrl) {
        if (serverClient.serverUrl.isNotBlank()) serverClient.connect()
    }

    Surface(modifier = Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
        BoxWithConstraints(Modifier.fillMaxSize()) {
            // ponytail: 600.dp is standard Material 3 WindowWidthSizeClass.Medium (Foldables & Tablets)
            val isWide = maxWidth >= 600.dp
            val listWidth = if (maxWidth < 840.dp) 300.dp else 360.dp
            if (isWide) {
                Scaffold(topBar = { DashboardTopBar(connectionStatus) { showSettings = true } }) { padding ->
                    Row(Modifier.padding(padding).fillMaxSize()) {
                        PcListScreen(
                            serverClient = serverClient,
                            selectedPcId = activePcId,
                            onPcClick = { selectedPcId = it },
                            modifier = Modifier.width(listWidth).fillMaxHeight(),
                        )
                    VerticalDivider()
                    activePcId?.let {
                        PcDetailScreen(
                            pcId = it,
                            serverClient = serverClient,
                            modifier = Modifier.weight(1f),
                            statusBarsPadding = false,
                        )
                    } ?: Box(Modifier.weight(1f).fillMaxHeight(), contentAlignment = Alignment.Center) {
                        Text("No PCs connected")
                    }
                }
            }
        } else {
            NavHost(navController = navController, startDestination = "pcs") {
                composable("pcs") {
                    Scaffold(topBar = { DashboardTopBar(connectionStatus) { showSettings = true } }) { padding ->
                        Box(Modifier.padding(padding).fillMaxSize()) {
                            PcListScreen(
                                serverClient = serverClient,
                                onPcClick = { pcId -> navController.navigate("pc/$pcId") },
                            )
                        }
                    }
                }
                composable(
                    "pc/{pcId}",
                    arguments = listOf(navArgument("pcId") { type = NavType.StringType })
                ) { back ->
                    PcDetailScreen(
                        pcId = back.arguments?.getString("pcId") ?: "",
                        serverClient = serverClient,
                    )
                }
            }
        }
        }
    }

    if (showSettings) {
        SettingsDialog(serverClient = serverClient, onDismiss = { showSettings = false })
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun DashboardTopBar(status: ConnectionStatus, onSettingsClick: () -> Unit) {
    TopAppBar(
        title = { Text("QB Remote Dashboard") },
        actions = {
            ConnectionBadge(status)
            Spacer(Modifier.width(8.dp))
            IconButton(onClick = onSettingsClick) {
                Icon(Icons.Default.Settings, "Settings")
            }
        },
    )
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
