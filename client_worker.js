const steamworks = require('steamworks.js');

// Pega o ID do jogo das variáveis de ambiente
const appId = parseInt(process.env.SteamAppId);

if (!appId) {
    console.error('SteamAppId não fornecido.');
    process.exit(1);
}

try {
    // Inicializa a conexão com a Steam para este AppID
    const client = steamworks.init(appId);
    console.log(`[Worker] Jogo ${appId} inicializado com sucesso!`);

    // Mantém o processo rodando para contar as horas
    setInterval(() => {
        // Loop infinito silencioso
    }, 1000 * 60);

} catch (e) {
    console.error(`[Worker] Erro ao iniciar jogo ${appId}:`, e.message);
    console.error('Certifique-se de que a Steam está aberta e logada.');
    process.exit(1);
}