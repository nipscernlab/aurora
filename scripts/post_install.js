const { exec } = require('child_process');
const readline = require('readline');
const util = require('util');
const execPromise = util.promisify(exec);

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

const question = (query) => new Promise((resolve) => rl.question(query, resolve));

async function executeCommand(command, description) {
    console.log(`\n📝 ${description}`);
    console.log(`Executando: ${command}`);
    
    try {
        const { stdout, stderr } = await execPromise(command);
        console.log('Saída:', stdout);
        if (stderr) console.error('Erros:', stderr);
        return true;
    } catch (error) {
        console.error(`❌ Erro ao executar o comando: ${error.message}`);
        return false;
    }
}

async function checkWSL() {
    try {
        await execPromise('wsl --status');
        return true;
    } catch {
        return false;
    }
}

async function installDependencies() {
    try {
        console.log('\n🚀 Iniciando processo de instalação das dependências\n');
        
        // Verificar se o WSL já está instalado
        const wslInstalled = await checkWSL();
        if (!wslInstalled) {
            const installWsl = await question('WSL não encontrado. Deseja instalar o WSL? (s/n): ');
            if (installWsl.toLowerCase() !== 's') {
                console.log('Instalação cancelada pelo usuário.');
                return;
            }
            
            await executeCommand('dism.exe /online /enable-feature /featurename:Microsoft-Windows-Subsystem-Linux /all /norestart', 
                'Habilitando o recurso WSL');
            
            await executeCommand('dism.exe /online /enable-feature /featurename:VirtualMachinePlatform /all /norestart',
                'Habilitando a Plataforma de Máquina Virtual');
            
            await executeCommand('wsl --set-default-version 2',
                'Configurando WSL 2 como versão padrão');
            
            console.log('\n⚠️ Seu computador precisa ser reiniciado para continuar a instalação.');
            const reboot = await question('Deseja reiniciar agora? (s/n): ');
            if (reboot.toLowerCase() === 's') {
                await executeCommand('shutdown /r /t 0', 'Reiniciando o computador');
                return;
            }
            console.log('Por favor, reinicie o computador manualmente e execute este script novamente.');
            return;
        }

        // Instalar Ubuntu se não estiver instalado
        const installUbuntu = await question('\nDeseja instalar o Ubuntu no WSL? (s/n): ');
        if (installUbuntu.toLowerCase() === 's') {
            await executeCommand('wsl --install -d Ubuntu', 'Instalando Ubuntu');
            
            console.log('\n📝 Após a instalação do Ubuntu, você precisará configurar um nome de usuário e senha.');
            console.log('Por favor, aguarde a janela do Ubuntu abrir e siga as instruções.');
            
            // Aguardar configuração do usuário
            await question('\nPressione Enter depois de configurar o usuário no Ubuntu...');
        }

        // Instalar Verilator e dependências
        const installVerilator = await question('\nDeseja instalar o Verilator e suas dependências? (s/n): ');
        if (installVerilator.toLowerCase() === 's') {
            const commands = [
                'sudo apt update',
                'sudo apt install -y git make autoconf g++ flex bison libfl2 libfl-dev',
                'git clone https://github.com/verilator/verilator',
                'cd verilator && autoconf && ./configure && make -j `nproc`',
                'sudo make install'
            ];

            for (const cmd of commands) {
                const success = await executeCommand(`wsl -e bash -ic "${cmd}"`,
                    'Instalando Verilator e dependências');
                if (!success) {
                    console.log('❌ Ocorreu um erro durante a instalação do Verilator.');
                    break;
                }
            }
        }

        console.log('\n✅ Processo de instalação concluído!');
        
    } catch (error) {
        console.error('\n❌ Erro durante o processo de instalação:', error);
    } finally {
        rl.close();
    }
}

// Iniciar o processo
installDependencies();