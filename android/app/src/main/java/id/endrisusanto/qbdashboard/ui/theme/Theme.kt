package id.endrisusanto.qbdashboard.ui.theme

import android.os.Build
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.unit.dp

private val DarkColorScheme = darkColorScheme(
    primary = Color(0xFF60A5FA),
    secondary = Color(0xFF34D399),
    tertiary = Color(0xFFFBBF24),
    surface = Color(0xFF161B26),
    surfaceVariant = Color(0xFF252C3A),
    background = Color(0xFF0F1117),
)

private val LightColorScheme = lightColorScheme(
    primary = Color(0xFF6C8FF5),
    secondary = Color(0xFF63BFA5),
    tertiary = Color(0xFFE8AD72),
    error = Color(0xFFC76B7D),
    background = Color(0xFFF9FAFF),
    surface = Color(0xFFFFFCFA),
    surfaceVariant = Color(0xFFF0F3FF),
    primaryContainer = Color(0xFFE2E9FF),
    secondaryContainer = Color(0xFFE0F5EE),
    tertiaryContainer = Color(0xFFFFF0DD),
    errorContainer = Color(0xFFFFE9ED),
    outlineVariant = Color(0xFFD9DFEE),
)

@Composable
fun QBDashboardTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    dynamicColor: Boolean = false,
    content: @Composable () -> Unit,
) {
    val colorScheme = when {
        dynamicColor && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S -> {
            val ctx = LocalContext.current
            if (darkTheme) dynamicDarkColorScheme(ctx) else dynamicLightColorScheme(ctx)
        }
        darkTheme -> DarkColorScheme
        else -> LightColorScheme
    }
    MaterialTheme(
        colorScheme = colorScheme,
        shapes = Shapes(
            extraSmall = RoundedCornerShape(10.dp),
            small = RoundedCornerShape(14.dp),
            medium = RoundedCornerShape(18.dp),
            large = RoundedCornerShape(24.dp),
        ),
        content = content,
    )
}
