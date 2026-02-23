const { app, BrowserWindow } = require('electron');
const path = require('path');
const { fork } = require('child_process');

// Mantém uma referência global para a janela para evitar que seja coletada pelo garbage collector.
let mainWindow;
let serverProcess;

function createWindow() {
    // Inicia o servidor Express em um processo separado.
    // Usamos 'fork' para que ele tenha seu próprio ambiente e não bloqueie o processo principal do Electron.
    // A flag '-r ts-node/register' garante que o TypeScript seja compilado em tempo de execução.
    serverProcess = fork(path.join(__dirname, 'server.ts'), [], {
        execArgv: ['-r', 'ts-node/register']
    });

    console.log('Processo do servidor iniciado.');

    // Cria a janela do navegador.
    mainWindow = new BrowserWindow({
        width: 900,
        height: 750,
        webPreferences: {
            nodeIntegration: false, // É mais seguro manter desativado
            contextIsolation: true,
        },
        icon: path.join(__dirname, 'public', 'icon.png') // Opcional: adicione um ícone
    });

    // Carrega a URL do servidor Express depois de um pequeno atraso para garantir que o servidor subiu.
    setTimeout(() => {
        mainWindow.loadURL('http://localhost:3000');
    }, 2000); // Atraso de 2 segundos

    // Opcional: Abre o DevTools.
    // mainWindow.webContents.openDevTools();
}

// Este método será chamado quando o Electron terminar a inicialização.
app.whenReady().then(createWindow);

// Encerra a aplicação quando todas as janelas forem fechadas.
app.on('window-all-closed', () => {
    console.log('Todas as janelas foram fechadas. Encerrando o servidor e a aplicação.');
    if (serverProcess) serverProcess.kill(); // Mata o processo do servidor
    app.quit();
});