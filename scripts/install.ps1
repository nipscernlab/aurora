# Verificar se o WSL está instalado
if (-not (Get-Command "wsl" -ErrorAction SilentlyContinue)) {
    Write-Output "WSL não está instalado. Instalando..."
    Invoke-WebRequest -Uri https://aka.ms/wsl-installer -OutFile "wsl-installer.exe"
    Start-Process -FilePath ".\wsl-installer.exe" -ArgumentList "/install" -Wait
}

# Verificar se o Ubuntu está instalado
$ubuntuInstalled = wsl -l -v | Select-String -Pattern "Ubuntu"

if (-not $ubuntuInstalled) {
    Write-Output "Ubuntu não está instalado. Instalando..."
    wsl --install -d Ubuntu
} else {
    Write-Output "Ubuntu já está instalado."
}

# Aguardar a inicialização do Ubuntu (talvez isso seja necessário para o Ubuntu ser totalmente configurado)
Write-Output "Aguardando a inicialização do Ubuntu..."
Start-Sleep -Seconds 5

# Rodar os comandos no WSL para configurar o ambiente
Write-Output "Iniciando Ubuntu e configurando o ambiente..."

# Criação do usuário, se necessário, e configuração do Ubuntu sem interação
wsl bash -c "
    # Atualizar o Ubuntu
    sudo apt update -y && sudo apt upgrade -y

    # Criar usuário (caso ainda não exista) e configurar sudo
    if ! id 'sapholinux' &>/dev/null; then
        sudo useradd -m -s /bin/bash sapholinux
        echo 'sapholinux:saphopassword' | sudo chpasswd
        sudo usermod -aG sudo sapholinux
    fi

    # Instalar o Verilator
    sudo apt install -y verilator

    # Instalar outras dependências (se necessário)
    sudo apt install -y make gcc g++"

Write-Output "Configuração concluída."
