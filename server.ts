import * as bodyParser from 'body-parser';
import express from 'express';
import * as path from 'path';
import { GameService } from './game_service';
import { SteamIdler } from './idler';
import { SteamAPIService } from './steam_api_service';

const app = express();
const port = process.env.PORT || 3000;

// Serviços
const steamApiService = new SteamAPIService();
const gameService = new GameService();
const idler = new SteamIdler(gameService);

app.use(bodyParser.json());
const publicPath = path.join(__dirname, 'public');
console.log(`[INFO] Servindo arquivos do frontend em: ${publicPath}`);
app.use(express.static(publicPath));

// --- Rota de Eventos (Server-Sent Events) para Logs no Navegador ---
app.get('/api/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // Função para enviar dados para este cliente específico
    const sendLog = (data: any) => {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    // Inscreve este cliente para receber logs do Idler
    idler.on('log-event', sendLog);

    // Quando o navegador fechar a aba, removemos a inscrição
    req.on('close', () => {
        idler.removeListener('log-event', sendLog);
    });
});
// ------------------------------------------------------------------

// Rota para buscar jogos
app.get('/api/search', async (req, res) => {
    const query = req.query.q as string;
    console.log(`[API] Recebida busca por: "${query}"`);
    if (!query) return res.json([]);
    
    const results = await gameService.searchGame(query);
    res.json(results);
});

// Rota para buscar conquistas de um jogo
app.get('/api/achievements/:appId', async (req, res) => {
    const appId = parseInt(req.params.appId);
    const apiKey = req.headers['x-steam-api-key'] as string;

    if (isNaN(appId)) {
        return res.status(400).json({ success: false, message: 'AppID inválido.' });
    }

    try {
        const achievements = await steamApiService.getGameSchema(appId, apiKey);
        if (achievements) {
            res.json({ success: true, data: achievements });
        } else {
            res.status(404).json({ success: false, message: 'Não foi possível encontrar conquistas para este jogo ou a API falhou.' });
        }
    } catch (e: any) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// Rota para iniciar o Farm de Conquistas
app.post('/api/start-achievement-farm', (req, res) => {
    const { appId, achievements, minMinutes, maxMinutes } = req.body as {
        appId: number;
        achievements: string[]; // Array de apiNames das conquistas, na ordem desejada
        minMinutes: number;
        maxMinutes: number;
    };
    console.log(`[API] Solicitação de Farm de Conquistas recebida para AppID: ${appId}`);
    try {
        idler.startAchievementFarm(appId, achievements, minMinutes, maxMinutes);
        res.json({ success: true, message: 'Farm de conquistas agendado!' });
    } catch (e: any) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// Rota para iniciar o Farm de Cartas (Estilo Idle Master)
app.post('/api/start-card-farm', (req, res) => {
    const { steamId64, sessionid, steamLoginSecure } = req.body;
    if (!steamId64 || !sessionid || !steamLoginSecure) {
        return res.status(400).json({ success: false, message: 'SteamID64 e cookies (sessionid, steamLoginSecure) são obrigatórios.' });
    }
    console.log(`[API] Solicitação de Farm de Cartas recebida para SteamID: ${steamId64}`);
    try {
        // A resposta é enviada imediatamente, pois a busca pode demorar
        idler.startCardFarm(steamId64, sessionid, steamLoginSecure);
        res.json({ success: true, message: 'Busca por jogos com drops de cartas iniciada! Acompanhe o log para ver o progresso.' });
    } catch (e: any) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// Rota para iniciar o Farm (Modo Cliente - Steam Aberta)
app.post('/api/start-client', (req, res) => {
    // O body pode vir com IDs como string ou número, então garantimos a conversão.
    const { appIds, duration } = req.body as { appIds: (string | number)[], duration?: number };
    console.log(`[API] Solicitação de Farm (Cliente) recebida. Jogos: ${appIds}, Duração: ${duration}`);
    try {
        const numericAppIds = appIds.map(id => Number(id));
        idler.startIdlingWithClient(numericAppIds, duration || 60);
        res.json({ success: true, message: 'Farm iniciado em modo Cliente!' });
    } catch (e: any) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// Rota para parar
app.post('/api/stop', (req, res) => {
    console.log('[API] Solicitação de PARADA recebida.');
    try {
        // Enviamos a resposta antes de parar, caso o stopIdling encerre o processo do node
        res.json({ success: true, message: 'Parando serviços...' });
        
        idler.stopIdling(); // Isso vai matar o processo do servidor também na implementação atual
    } catch (e) {
        // Ignora erro se já estiver parado
        res.json({ success: true });
    }
});

app.listen(port, () => {
    console.log(`
    --------------------------------------------------
    APP VISUAL RODANDO EM: http://localhost:${port}
    --------------------------------------------------
    `);
});