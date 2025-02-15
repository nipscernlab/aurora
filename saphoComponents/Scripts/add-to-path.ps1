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

# Verifica se os caminhos já estão no PATH
$pathsToAdd = @($iverilogPath, $gtkwavePath, $7zPath)
$pathsAlreadyExist = $true

foreach ($path in $pathsToAdd) {
    if ($oldPath -notlike "*$path*") {
        $pathsAlreadyExist = $false
        $oldPath = "$oldPath;$path"
        Write-Host "Adicionado: $path"
    }
}

# Se houver novos caminhos a serem adicionados, atualiza a variável de ambiente Path
if (-not $pathsAlreadyExist) {
    [Environment]::SetEnvironmentVariable("Path", $oldPath, [EnvironmentVariableTarget]::Machine)
    Write-Host "PATH atualizado com sucesso."
} else {
    # Se os caminhos já existirem, exibe mensagem de que o terminal será fechado
    Write-Host "Todos os caminhos já estão no PATH. O terminal será fechado."
}

# Adiciona o delay antes de fechar o terminal
Start-Sleep -Seconds 3

# Notifica o sistema sobre a alteração no PATH
$signature = '[DllImport("user32.dll")]public static extern int SendMessageTimeout(IntPtr hWnd, uint Msg, IntPtr wParam, string lParam, uint fuFlags, uint uTimeout, out IntPtr lpdwResult);'
$SendMessageTimeout = Add-Type -MemberDefinition $signature -Name 'Win32SendMessageTimeout' -Namespace 'Win32Functions' -PassThru
$HWND_BROADCAST = [IntPtr] 0xffff
$WM_SETTINGCHANGE = 0x1A
$SMTO_ABORTIFHUNG = 0x2
$null = $SendMessageTimeout::SendMessageTimeout($HWND_BROADCAST, $WM_SETTINGCHANGE, [IntPtr]::Zero, 'Environment', $SMTO_ABORTIFHUNG, 100, [ref] [IntPtr]::Zero)

# Fecha o terminal (após o delay)
exit
