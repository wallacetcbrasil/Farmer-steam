const steamworks = require('steamworks.js');

const appId = parseInt(process.env.SteamAppId);

if (!appId) {
    console.error('[Worker/Ach] SteamAppId não fornecido.');
    process.exit(1);
}

try {
    const client = steamworks.init(appId);
    console.log(`[Worker/Ach] Jogo ${appId} inicializado para farm de conquistas.`);

    // Escuta por mensagens do processo pai (idler.ts)
    process.on('message', (command) => {
        if (command.type === 'UNLOCK_ACHIEVEMENT') {
            const achievementApiName = command.payload;
            if (!achievementApiName) return;

            console.log(`[Worker/Ach] Recebido comando para desbloquear: ${achievementApiName}`);
            
            try {
                // Ativa a conquista usando a API do steamworks.js
                const success = client.achievement.set(achievementApiName);

                if (success) {
                    console.log(`[Worker/Ach] Conquista '${achievementApiName}' ativada com sucesso.`);
                    
                    // É crucial salvar as estatísticas para que a mudança seja enviada para os servidores da Steam
                    client.userStats.store();
                    console.log(`[Worker/Ach] Estatísticas salvas na Steam Cloud para ${appId}.`);
                } else {
                    console.error(`[Worker/Ach] Falha ao ativar a conquista '${achievementApiName}'. A API retornou 'false'.`);
                }
            } catch (e) {
                console.error(`[Worker/Ach] Erro ao tentar desbloquear a conquista '${achievementApiName}':`, e.message);
            }
        }
    });

} catch (e) {
    console.error(`[Worker/Ach] Erro ao iniciar jogo ${appId}:`, e.message);
    console.error('[Worker/Ach] Certifique-se de que a Steam está aberta e logada.');
    process.exit(1);
}