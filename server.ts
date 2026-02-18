import * as bodyParser from 'body-parser';
import express from 'express';
import * as path from 'path';
import { GameService } from './game_service';
import { SteamIdler } from './idler';

const app = express();
const port = 3000;

// Serviços
const gameService = new GameService();
const idler = new SteamIdler(gameService);

app.use(bodyParser.json());
const publicPath = path.join(__dirname, 'public');
console.log(`[INFO] Servindo arquivos do frontend em: ${publicPath}`);
app.use(express.static(publicPath));

// Rota de fallback para ajudar a identificar erro de pasta
app.get('/', (req, res) => {
    res.status(404).send(`
        <h1>Erro: Site não encontrado</h1>
        <p>O servidor esperava encontrar o arquivo <code>index.html</code> dentro da pasta <code>public</code>.</p>
        <p>Verifique se você criou a pasta <b>public</b> na raiz do projeto e moveu o arquivo <b>index.html</b> para dentro dela.</p>
    `);
});

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

// Rota para iniciar o Farm (Modo Cliente - Steam Aberta)
app.post('/api/start-client', (req, res) => {
    const { appIds, duration } = req.body;
    console.log(`[API] Solicitação de Farm (Cliente) recebida. Jogos: ${appIds}, Duração: ${duration}`);
    try {
        idler.startIdlingWithClient(appIds, duration || 60);
        res.json({ success: true, message: 'Farm iniciado em modo Cliente!' });
    } catch (e: any) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// Rota para iniciar o Farm (Modo Credenciais)
app.post('/api/start-credentials', (req, res) => {
    const { username, password, appIds, duration } = req.body;
    console.log(`[API] Solicitação de Farm (Credenciais) recebida para usuário: ${username}`);
    try {
        // Nota: O Steam Guard ainda será pedido no terminal do servidor nesta versão simples
        idler.startIdlingWithCredentials(username, password, appIds, duration || 60);
        res.json({ success: true, message: 'Login iniciado! Verifique o terminal para Steam Guard se necessário.' });
    } catch (e: any) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// Rota para iniciar o Farm (Modo QR Code)
app.post('/api/start-qr', (req, res) => {
    const { appIds, duration } = req.body;
    console.log(`[API] Solicitação de Farm (QR Code) recebida.`);
    // Iniciamos o processo em background (sem await) para liberar a resposta
    idler.startIdlingWithQR(appIds, duration || 60).catch(e => console.error(e));
    res.json({ success: true, message: 'Gerando QR Code...' });
});

// Rota para obter a URL do QR Code atual
app.get('/api/qr-code', (req, res) => {
    // Retorna a URL se existir, ou null se não estiver aguardando login
    res.json({ url: idler.qrUrl });
});

// Rota para parar
app.post('/api/stop', (req, res) => {
    console.log('[API] Solicitação de PARADA recebida.');
    try {
        idler.stopIdling(); // Isso vai matar o processo do servidor também na implementação atual
        res.json({ success: true });
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