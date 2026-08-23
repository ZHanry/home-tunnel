@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)

package io.github.zhanry.hometunnel.ui

import android.Manifest
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatDelegate
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.CloudOff
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Language
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Security
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Stop
import androidx.compose.material.icons.filled.Tune
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CenterAlignedTopAppBar
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedCard
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.core.os.LocaleListCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.github.zhanry.hometunnel.BuildConfig
import io.github.zhanry.hometunnel.R
import io.github.zhanry.hometunnel.model.AgentState
import io.github.zhanry.hometunnel.model.ProxyKind
import io.github.zhanry.hometunnel.model.TunnelConnection
import io.github.zhanry.hometunnel.repository.AppScreen
import io.github.zhanry.hometunnel.repository.AppUiState
import io.github.zhanry.hometunnel.repository.HomeTunnelRepository
import io.github.zhanry.hometunnel.service.TunnelService
import kotlinx.coroutines.launch

@Composable
fun HomeTunnelApp(
    repository: HomeTunnelRepository,
    notificationPermissionRequired: Boolean,
) {
    val state by repository.uiState.collectAsStateWithLifecycle()
    val context = LocalContext.current
    val snackbar = remember { SnackbarHostState() }
    var pendingTunnelStart by remember { mutableStateOf(false) }
    val permissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) {
        if (pendingTunnelStart) {
            pendingTunnelStart = false
            TunnelService.start(context)
        }
    }

    LaunchedEffect(state.error) {
        state.error?.let {
            snackbar.showSnackbar(it)
            repository.clearError()
        }
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(
                Brush.verticalGradient(
                    listOf(
                        MaterialTheme.colorScheme.surface,
                        MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.18f),
                        MaterialTheme.colorScheme.surface,
                    ),
                ),
            ),
    ) {
        AnimatedContent(targetState = state.screen, label = "screen") { screen ->
            when (screen) {
                AppScreen.LOADING -> LoadingScreen()
                AppScreen.LOGIN -> LoginScreen(state, repository)
                AppScreen.PASSWORD_CHANGE -> PasswordChangeScreen(state, repository)
                AppScreen.HOME -> HomeScreen(
                    state = state,
                    repository = repository,
                    snackbar = snackbar,
                    startTunnel = {
                        if (notificationPermissionRequired && Build.VERSION.SDK_INT >= 33) {
                            pendingTunnelStart = true
                            permissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
                        } else {
                            TunnelService.start(context)
                        }
                    },
                    stopTunnel = { TunnelService.stop(context) },
                    syncTunnel = { TunnelService.sync(context) },
                )
            }
        }
        SnackbarHost(
            hostState = snackbar,
            modifier = Modifier.align(Alignment.BottomCenter).navigationBarsPadding(),
        )
    }
}

@Composable
private fun LoadingScreen() {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(16.dp)) {
            BrandMark()
            CircularProgressIndicator()
            Text(stringResource(R.string.loading), color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun LoginScreen(state: AppUiState, repository: HomeTunnelRepository) {
    var server by rememberSaveable { mutableStateOf("") }
    var username by rememberSaveable { mutableStateOf("") }
    // Passwords deliberately use remember, not rememberSaveable: they must not
    // enter the Activity saved-state bundle or survive process recreation.
    var password by remember { mutableStateOf("") }
    AuthFrame {
        BrandMark()
        Spacer(Modifier.height(20.dp))
        Text(
            stringResource(R.string.app_name),
            style = MaterialTheme.typography.headlineLarge,
            fontWeight = FontWeight.Bold,
            color = MaterialTheme.colorScheme.onSurface,
            modifier = Modifier.semantics { heading() },
        )
        Text(
            stringResource(R.string.tagline),
            style = MaterialTheme.typography.bodyLarge,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Spacer(Modifier.height(28.dp))
        OutlinedTextField(
            value = server,
            onValueChange = { server = it },
            modifier = Modifier.fillMaxWidth(),
            enabled = !state.busy,
            label = { Text(stringResource(R.string.server_address)) },
            placeholder = { Text(stringResource(R.string.server_hint)) },
            singleLine = true,
            leadingIcon = { Icon(Icons.Default.Security, contentDescription = null) },
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = ImeAction.Next),
        )
        OutlinedTextField(
            value = username,
            onValueChange = { username = it },
            modifier = Modifier.fillMaxWidth(),
            enabled = !state.busy,
            label = { Text(stringResource(R.string.username)) },
            singleLine = true,
            leadingIcon = { Icon(Icons.Default.Home, contentDescription = null) },
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next),
        )
        OutlinedTextField(
            value = password,
            onValueChange = { password = it },
            modifier = Modifier.fillMaxWidth(),
            enabled = !state.busy,
            label = { Text(stringResource(R.string.password)) },
            singleLine = true,
            visualTransformation = PasswordVisualTransformation(),
            leadingIcon = { Icon(Icons.Default.Lock, contentDescription = null) },
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Done),
        )
        Button(
            onClick = { repository.login(server, username, password) },
            modifier = Modifier.fillMaxWidth().height(52.dp),
            enabled = !state.busy && server.isNotBlank() && username.isNotBlank() && password.isNotEmpty(),
        ) {
            if (state.busy) {
                CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
                Spacer(Modifier.width(10.dp))
                Text(stringResource(R.string.signing_in))
            } else {
                Text(stringResource(R.string.sign_in))
            }
        }
        OutlinedCard(colors = CardDefaults.outlinedCardColors(containerColor = MaterialTheme.colorScheme.surface.copy(alpha = 0.7f))) {
            Row(Modifier.padding(16.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Icon(Icons.Default.Security, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
                Text(
                    stringResource(R.string.secure_discovery_note),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        LanguageMenu(compact = true)
    }
}

@Composable
private fun PasswordChangeScreen(state: AppUiState, repository: HomeTunnelRepository) {
    var current by remember { mutableStateOf("") }
    var next by remember { mutableStateOf("") }
    var confirm by remember { mutableStateOf("") }
    AuthFrame {
        Icon(
            Icons.Default.Lock,
            contentDescription = null,
            modifier = Modifier.size(48.dp),
            tint = MaterialTheme.colorScheme.primary,
        )
        Text(
            stringResource(R.string.change_password),
            style = MaterialTheme.typography.headlineMedium,
            fontWeight = FontWeight.Bold,
            color = MaterialTheme.colorScheme.onSurface,
            modifier = Modifier.semantics { heading() },
        )
        Text(
            stringResource(R.string.password_change_required),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        OutlinedTextField(
            value = current,
            onValueChange = { current = it },
            modifier = Modifier.fillMaxWidth(),
            label = { Text(stringResource(R.string.current_password)) },
            visualTransformation = PasswordVisualTransformation(),
            singleLine = true,
        )
        OutlinedTextField(
            value = next,
            onValueChange = { next = it },
            modifier = Modifier.fillMaxWidth(),
            label = { Text(stringResource(R.string.new_password)) },
            supportingText = { Text(stringResource(R.string.password_minimum)) },
            isError = next.isNotEmpty() && next.length < 12,
            visualTransformation = PasswordVisualTransformation(),
            singleLine = true,
        )
        OutlinedTextField(
            value = confirm,
            onValueChange = { confirm = it },
            modifier = Modifier.fillMaxWidth(),
            label = { Text(stringResource(R.string.confirm_password)) },
            supportingText = {
                if (confirm.isNotEmpty() && confirm != next) Text(stringResource(R.string.passwords_do_not_match))
            },
            isError = confirm.isNotEmpty() && confirm != next,
            visualTransformation = PasswordVisualTransformation(),
            singleLine = true,
        )
        Button(
            onClick = { repository.changeRequiredPassword(current, next) },
            modifier = Modifier.fillMaxWidth().height(52.dp),
            enabled = !state.busy && current.isNotEmpty() && next.length >= 12 && next == confirm,
        ) {
            if (state.busy) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
            else Text(stringResource(R.string.save_password))
        }
        TextButton(onClick = repository::cancelPasswordChange, enabled = !state.busy) {
            Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = null)
            Spacer(Modifier.width(8.dp))
            Text(stringResource(R.string.cancel))
        }
    }
}

@Composable
private fun AuthFrame(content: @Composable ColumnScope.() -> Unit) {
    BoxWithConstraints(Modifier.fillMaxSize().statusBarsPadding().imePadding()) {
        val horizontal = if (maxWidth > 600.dp) 48.dp else 22.dp
        Column(
            modifier = Modifier
                .align(Alignment.Center)
                .widthIn(max = 520.dp)
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(horizontal, 32.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
            horizontalAlignment = Alignment.Start,
            content = content,
        )
    }
}

@Composable
private fun HomeScreen(
    state: AppUiState,
    repository: HomeTunnelRepository,
    snackbar: SnackbarHostState,
    startTunnel: () -> Unit,
    stopTunnel: () -> Unit,
    syncTunnel: () -> Unit,
) {
    var editor by remember { mutableStateOf<ConnectionEdit?>(null) }
    var settings by remember { mutableStateOf(false) }
    var deleteTarget by remember { mutableStateOf<TunnelConnection?>(null) }
    val scope = rememberCoroutineScope()
    Scaffold(
        containerColor = Color.Transparent,
        topBar = {
            CenterAlignedTopAppBar(
                title = { Text(stringResource(R.string.app_name), fontWeight = FontWeight.SemiBold) },
                actions = {
                    IconButton(onClick = { settings = true }) {
                        Icon(Icons.Default.Settings, contentDescription = stringResource(R.string.settings))
                    }
                },
            )
        },
        floatingActionButton = {
            ExtendedFloatingActionButton(
                onClick = { editor = ConnectionEdit(newHttpConnection(state), true) },
                icon = { Icon(Icons.Default.Add, contentDescription = null) },
                text = { Text(stringResource(R.string.add_connection)) },
            )
        },
    ) { padding ->
        LazyColumn(
            modifier = Modifier.fillMaxSize().padding(padding),
            contentPadding = PaddingValues(start = 18.dp, end = 18.dp, top = 10.dp, bottom = 104.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            item {
                Text(
                    stringResource(R.string.home_title),
                    style = MaterialTheme.typography.headlineMedium,
                    fontWeight = FontWeight.Bold,
                    modifier = Modifier.semantics { heading() },
                )
                Text(
                    stringResource(R.string.home_subtitle),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(top = 4.dp),
                )
            }
            item {
                TunnelStatusCard(state, startTunnel, stopTunnel, syncTunnel)
            }
            if (state.connections.isEmpty()) {
                item { EmptyConnectionsCard() }
            } else {
                items(state.connections, key = { it.id }) { connection ->
                    ConnectionCard(
                        connection = connection,
                        onEdit = { editor = ConnectionEdit(connection, false) },
                    )
                }
            }
        }
    }

    editor?.let { edit ->
        ConnectionEditor(
            edit = edit,
            busy = state.busy,
            onDismiss = { editor = null },
            onSave = { value ->
                repository.saveConnection(value, edit.isNew)
                editor = null
                if (state.persisted.desiredRunning) syncTunnel()
            },
            onDelete = if (edit.isNew || edit.value.kind == ProxyKind.UNKNOWN) null else {
                { deleteTarget = edit.value }
            },
        )
    }
    deleteTarget?.let { value ->
        AlertDialog(
            onDismissRequest = { deleteTarget = null },
            title = { Text(stringResource(R.string.delete_connection)) },
            text = { Text(stringResource(R.string.delete_confirmation, value.name)) },
            confirmButton = {
                Button(onClick = {
                    repository.deleteConnection(value)
                    deleteTarget = null
                    editor = null
                }) { Text(stringResource(R.string.delete)) }
            },
            dismissButton = { TextButton(onClick = { deleteTarget = null }) { Text(stringResource(R.string.cancel)) } },
        )
    }
    if (settings) {
        SettingsSheet(
            state = state,
            onDismiss = { settings = false },
            onLogout = {
                settings = false
                repository.logout(stopTunnel)
            },
        )
    }
}

@Composable
private fun TunnelStatusCard(
    state: AppUiState,
    startTunnel: () -> Unit,
    stopTunnel: () -> Unit,
    syncTunnel: () -> Unit,
) {
    val status = state.persisted.agentState
    val (label, color) = when (status) {
        AgentState.ONLINE -> stringResource(R.string.status_online) to MaterialTheme.colorScheme.primary
        AgentState.STARTING -> stringResource(R.string.status_starting) to MaterialTheme.colorScheme.tertiary
        AgentState.DEGRADED -> stringResource(R.string.status_degraded) to MaterialTheme.colorScheme.tertiary
        AgentState.ERROR -> stringResource(R.string.status_error) to MaterialTheme.colorScheme.error
        AgentState.EXPIRED -> stringResource(R.string.status_expired) to MaterialTheme.colorScheme.error
        AgentState.REVOKED -> stringResource(R.string.status_revoked) to MaterialTheme.colorScheme.error
        AgentState.OFFLINE -> stringResource(R.string.status_offline) to MaterialTheme.colorScheme.onSurfaceVariant
    }
    Card(
        modifier = Modifier.fillMaxWidth().semantics {
            liveRegion = LiveRegionMode.Polite
            contentDescription = "$label. ${state.persisted.agentMessage}"
        },
        shape = RoundedCornerShape(28.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.68f)),
    ) {
        Column(Modifier.padding(22.dp), verticalArrangement = Arrangement.spacedBy(18.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(12.dp).clip(CircleShape).background(color))
                Spacer(Modifier.width(10.dp))
                Text(label, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
            }
            Text(
                state.persisted.agentMessage.ifBlank {
                    if (status == AgentState.OFFLINE) stringResource(R.string.status_stopped_by_user)
                    else stringResource(R.string.status_waiting)
                },
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                if (state.persisted.desiredRunning) {
                    Button(onClick = stopTunnel, modifier = Modifier.weight(1f)) {
                        Icon(Icons.Default.Stop, contentDescription = null)
                        Spacer(Modifier.width(8.dp))
                        Text(stringResource(R.string.stop_tunnel))
                    }
                } else {
                    Button(onClick = startTunnel, modifier = Modifier.weight(1f)) {
                        Icon(Icons.Default.PlayArrow, contentDescription = null)
                        Spacer(Modifier.width(8.dp))
                        Text(stringResource(R.string.start_tunnel))
                    }
                }
                FilledTonalButton(onClick = syncTunnel, enabled = state.persisted.desiredRunning) {
                    Icon(Icons.Default.Refresh, contentDescription = stringResource(R.string.sync_now))
                }
            }
        }
    }
}

@Composable
private fun EmptyConnectionsCard() {
    OutlinedCard(Modifier.fillMaxWidth(), shape = RoundedCornerShape(24.dp)) {
        Column(
            Modifier.fillMaxWidth().padding(28.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Icon(Icons.Default.CloudOff, contentDescription = null, modifier = Modifier.size(42.dp), tint = MaterialTheme.colorScheme.primary)
            Text(stringResource(R.string.no_connections), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
            Text(stringResource(R.string.no_connections_detail), color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun ConnectionCard(connection: TunnelConnection, onEdit: () -> Unit) {
    OutlinedCard(onClick = onEdit, modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(22.dp)) {
        Row(Modifier.padding(18.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(
                Modifier.size(46.dp).clip(RoundedCornerShape(15.dp)).background(MaterialTheme.colorScheme.primaryContainer),
                contentAlignment = Alignment.Center,
            ) {
                Icon(Icons.Default.Tune, contentDescription = null, tint = MaterialTheme.colorScheme.onPrimaryContainer)
            }
            Spacer(Modifier.width(14.dp))
            Column(Modifier.weight(1f)) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(connection.name, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    AssistChip(onClick = onEdit, label = { Text(connection.proxyType.uppercase()) })
                }
                Text(
                    connection.publicDisplayEndpoint.ifBlank { "${connection.localHost}:${connection.localPort}" },
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    if (connection.enabled) connection.state else stringResource(R.string.status_offline),
                    style = MaterialTheme.typography.labelMedium,
                    color = if (connection.enabled) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outline,
                )
            }
            Icon(Icons.Default.Edit, contentDescription = stringResource(R.string.edit_connection))
        }
    }
}

private data class ConnectionEdit(val value: TunnelConnection, val isNew: Boolean)

@Composable
private fun ConnectionEditor(
    edit: ConnectionEdit,
    busy: Boolean,
    onDismiss: () -> Unit,
    onSave: (TunnelConnection) -> Unit,
    onDelete: (() -> Unit)?,
) {
    var name by rememberSaveable(edit.value.id) { mutableStateOf(edit.value.name) }
    var subdomain by rememberSaveable(edit.value.id) { mutableStateOf(edit.value.subdomain) }
    var scheme by rememberSaveable(edit.value.id) { mutableStateOf(edit.value.localScheme) }
    var host by rememberSaveable(edit.value.id) { mutableStateOf(edit.value.localHost) }
    var port by rememberSaveable(edit.value.id) { mutableStateOf(edit.value.localPort.takeIf { it > 0 }?.toString().orEmpty()) }
    var enabled by rememberSaveable(edit.value.id) { mutableStateOf(edit.value.enabled) }
    val raw = edit.value.kind in setOf(ProxyKind.TCP, ProxyKind.UDP)
    val unknown = edit.value.kind == ProxyKind.UNKNOWN
    val validSubdomain = Regex("^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$").matches(subdomain)
    val parsedPort = port.toIntOrNull()
    val canSave = !unknown && name.isNotBlank() && validSubdomain && host.isNotBlank() && parsedPort in 1..65535
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(if (edit.isNew) stringResource(R.string.add_connection) else stringResource(R.string.edit_connection)) },
        text = {
            Column(
                Modifier.fillMaxWidth().verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                if (raw) WarningCard(stringResource(R.string.raw_mvp_warning, edit.value.proxyType.uppercase()))
                if (unknown) WarningCard(stringResource(R.string.unknown_type_warning))
                OutlinedTextField(
                    value = name,
                    onValueChange = { name = it },
                    modifier = Modifier.fillMaxWidth(),
                    enabled = !busy && !raw && !unknown,
                    label = { Text(stringResource(R.string.connection_name)) },
                    singleLine = true,
                )
                OutlinedTextField(
                    value = subdomain,
                    onValueChange = { subdomain = it.lowercase() },
                    modifier = Modifier.fillMaxWidth(),
                    enabled = !busy && !raw && !unknown,
                    label = { Text(stringResource(R.string.public_subdomain)) },
                    isError = subdomain.isNotEmpty() && !validSubdomain,
                    singleLine = true,
                )
                if (!raw && !unknown) {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        listOf("http", "https").forEach { value ->
                            AssistChip(onClick = { scheme = value }, label = { Text(value) }, leadingIcon = {
                                if (scheme == value) Icon(Icons.Default.Security, contentDescription = null, modifier = Modifier.size(18.dp))
                            })
                        }
                    }
                }
                OutlinedTextField(
                    value = host,
                    onValueChange = { host = it },
                    modifier = Modifier.fillMaxWidth(),
                    enabled = !busy && !unknown,
                    label = { Text(stringResource(R.string.local_host)) },
                    singleLine = true,
                )
                OutlinedTextField(
                    value = port,
                    onValueChange = { port = it.filter(Char::isDigit).take(5) },
                    modifier = Modifier.fillMaxWidth(),
                    enabled = !busy && !unknown,
                    label = { Text(stringResource(R.string.local_port)) },
                    isError = port.isNotEmpty() && parsedPort !in 1..65535,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                    singleLine = true,
                )
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Checkbox(checked = enabled, onCheckedChange = { enabled = it }, enabled = !busy && !unknown)
                    Text(stringResource(R.string.enabled))
                }
                onDelete?.let {
                    OutlinedButton(onClick = it, enabled = !busy, modifier = Modifier.fillMaxWidth()) {
                        Icon(Icons.Default.Delete, contentDescription = null)
                        Spacer(Modifier.width(8.dp))
                        Text(stringResource(R.string.delete_connection))
                    }
                }
            }
        },
        confirmButton = {
            Button(
                onClick = {
                    onSave(edit.value.copy(
                        name = name.trim(),
                        subdomain = subdomain.trim(),
                        localScheme = if (raw) edit.value.localScheme else scheme,
                        localHost = host.trim(),
                        localPort = requireNotNull(parsedPort),
                        enabled = enabled,
                    ))
                },
                enabled = canSave && !busy,
            ) { Text(stringResource(R.string.save)) }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.cancel)) } },
    )
}

@Composable
private fun WarningCard(message: String) {
    Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.tertiaryContainer)) {
        Text(message, Modifier.padding(14.dp), color = MaterialTheme.colorScheme.onTertiaryContainer, style = MaterialTheme.typography.bodySmall)
    }
}

@Composable
private fun SettingsSheet(state: AppUiState, onDismiss: () -> Unit, onLogout: () -> Unit) {
    var confirmLogout by remember { mutableStateOf(false) }
    ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(
            Modifier.fillMaxWidth().navigationBarsPadding().padding(bottom = 24.dp),
        ) {
            Text(
                stringResource(R.string.settings),
                style = MaterialTheme.typography.headlineSmall,
                fontWeight = FontWeight.Bold,
                modifier = Modifier.padding(horizontal = 24.dp, vertical = 10.dp).semantics { heading() },
            )
            ListItem(
                headlineContent = { Text(state.persisted.userDisplayName ?: state.persisted.username.orEmpty()) },
                supportingContent = { Text(state.persisted.profile?.publicBaseUrl.orEmpty()) },
                leadingContent = { Icon(Icons.Default.Home, contentDescription = null) },
            )
            HorizontalDivider()
            ListItem(
                headlineContent = { Text(stringResource(R.string.language)) },
                supportingContent = { Text(stringResource(R.string.theme_system)) },
                leadingContent = { Icon(Icons.Default.Language, contentDescription = null) },
                trailingContent = { LanguageMenu(compact = false) },
            )
            ListItem(
                headlineContent = { Text(stringResource(R.string.release_identity)) },
                supportingContent = { Text(stringResource(R.string.release_fingerprint), style = MaterialTheme.typography.bodySmall) },
                leadingContent = { Icon(Icons.Default.Security, contentDescription = null) },
            )
            Text(
                stringResource(R.string.experimental_notice),
                modifier = Modifier.padding(horizontal = 24.dp, vertical = 12.dp),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                style = MaterialTheme.typography.bodySmall,
            )
            Text(
                stringResource(R.string.version_label, BuildConfig.VERSION_NAME),
                modifier = Modifier.padding(horizontal = 24.dp),
                color = MaterialTheme.colorScheme.outline,
                style = MaterialTheme.typography.labelMedium,
            )
            Spacer(Modifier.height(16.dp))
            OutlinedButton(
                onClick = { confirmLogout = true },
                modifier = Modifier.fillMaxWidth().padding(horizontal = 24.dp),
            ) { Text(stringResource(R.string.sign_out)) }
        }
    }
    if (confirmLogout) {
        AlertDialog(
            onDismissRequest = { confirmLogout = false },
            title = { Text(stringResource(R.string.sign_out)) },
            text = { Text(stringResource(R.string.sign_out_confirmation)) },
            confirmButton = { Button(onClick = onLogout) { Text(stringResource(R.string.sign_out)) } },
            dismissButton = { TextButton(onClick = { confirmLogout = false }) { Text(stringResource(R.string.cancel)) } },
        )
    }
}

@Composable
private fun LanguageMenu(compact: Boolean) {
    var expanded by remember { mutableStateOf(false) }
    Box {
        if (compact) {
            TextButton(onClick = { expanded = true }) {
                Icon(Icons.Default.Language, contentDescription = null)
                Spacer(Modifier.width(8.dp))
                Text(stringResource(R.string.language))
            }
        } else {
            IconButton(onClick = { expanded = true }) {
                Icon(Icons.Default.MoreVert, contentDescription = stringResource(R.string.language))
            }
        }
        DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
            listOf(
                "" to stringResource(R.string.language_system),
                "en" to stringResource(R.string.language_english),
                "zh-CN" to stringResource(R.string.language_chinese),
            ).forEach { (tag, label) ->
                DropdownMenuItem(
                    text = { Text(label) },
                    onClick = {
                        expanded = false
                        AppCompatDelegate.setApplicationLocales(
                            if (tag.isEmpty()) LocaleListCompat.getEmptyLocaleList()
                            else LocaleListCompat.forLanguageTags(tag),
                        )
                    },
                )
            }
        }
    }
}

@Composable
private fun BrandMark() {
    Box(
        Modifier.size(70.dp).clip(RoundedCornerShape(23.dp)).background(MaterialTheme.colorScheme.primary),
        contentAlignment = Alignment.Center,
    ) {
        Icon(
            Icons.Default.Home,
            contentDescription = null,
            tint = MaterialTheme.colorScheme.onPrimary,
            modifier = Modifier.size(36.dp),
        )
    }
}

private fun newHttpConnection(state: AppUiState): TunnelConnection = TunnelConnection(
    id = "",
    deviceId = state.persisted.deviceId.orEmpty(),
    name = "",
    subdomain = "",
    proxyType = "http",
    localScheme = "http",
    localHost = "127.0.0.1",
    localPort = 8080,
    enabled = true,
    version = 0,
)
