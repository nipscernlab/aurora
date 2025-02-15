$ErrorActionPreference = "Stop"

# Caminho do diretório onde o script está localizado
$scriptPath = $PSScriptRoot
$rootPath = Split-Path -Path $scriptPath -Parent

# Caminhos relativos ao diretório raiz
$iverilogPath = Join-Path -Path $rootPath -ChildPath "Packages\iverilog\bin"
$gtkwavePath = Join-Path -Path $rootPath -ChildPath "Packages\iverilog\gtkwave\bin"
$7zPath = Join-Path -Path $rootPath -ChildPath "Packages\7-Zip"

# Obtém o PATH atual
$oldPath = [Environment]::GetEnvironmentVariable("Path", [EnvironmentVariableTarget]::Machine)

# Verifica se os caminhos já estão no PATH e adiciona se necessário
if ($oldPath -notlike "*$iverilogPath*") {
    $newPath = "$oldPath;$iverilogPath"
    [Environment]::SetEnvironmentVariable("Path", $newPath, [EnvironmentVariableTarget]::Machine)
    Write-Host "Adicionado: $iverilogPath"
}

if ($oldPath -notlike "*$gtkwavePath*") {
    $newPath = "$newPath;$gtkwavePath"
    [Environment]::SetEnvironmentVariable("Path", $newPath, [EnvironmentVariableTarget]::Machine)
    Write-Host "Adicionado: $gtkwavePath"
}

if ($oldPath -notlike "*$7zPath*") {
    $newPath = "$newPath;$7zPath"
    [Environment]::SetEnvironmentVariable("Path", $newPath, [EnvironmentVariableTarget]::Machine)
    Write-Host "Adicionado: $7zPath"
}

Write-Host "PATH atualizado com sucesso."

# Notifica o sistema sobre a alteração no PATH
$signature = '[DllImport("user32.dll")]public static extern int SendMessageTimeout(IntPtr hWnd, uint Msg, IntPtr wParam, string lParam, uint fuFlags, uint uTimeout, out IntPtr lpdwResult);'
$SendMessageTimeout = Add-Type -MemberDefinition $signature -Name 'Win32SendMessageTimeout' -Namespace 'Win32Functions' -PassThru
$HWND_BROADCAST = [IntPtr] 0xffff
$WM_SETTINGCHANGE = 0x1A
$SMTO_ABORTIFHUNG = 0x2
$null = $SendMessageTimeout::SendMessageTimeout($HWND_BROADCAST, $WM_SETTINGCHANGE, [IntPtr]::Zero, 'Environment', $SMTO_ABORTIFHUNG, 100, [ref] [IntPtr]::Zero)
