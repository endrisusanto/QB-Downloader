package id.endrisusanto.qbdashboard

import android.Manifest
import android.content.pm.PackageManager
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.CompositionLocalProvider
import id.endrisusanto.qbdashboard.data.ServerClient
import id.endrisusanto.qbdashboard.ui.DashboardApp
import id.endrisusanto.qbdashboard.ui.theme.QBDashboardTheme

class MainActivity : ComponentActivity() {

    private lateinit var serverClient: ServerClient

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        serverClient = ServerClient(applicationContext)
        if (android.os.Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 0)
        }
        enableEdgeToEdge()
        setContent {
            QBDashboardTheme {
                DashboardApp(serverClient = serverClient)
            }
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        serverClient.disconnect()
    }
}
