import { ChildProcess, spawn } from 'child_process';
import * as dotenv from 'dotenv';
import { EventEmitter } from 'events';
import * as path from 'path';
import * as readline from 'readline';
import { EAuthTokenPlatformType, LoginSession } from 'steam-session';
import SteamUser from 'steam-user';

dotenv.config(); // Carrega as variáveis do arquivo .env

import { GameService } from './game_service';

interface ActiveProcess {
    process: ChildProcess;
    appId: number;
}

export class SteamIdler extends EventEmitter {
    private client: SteamUser;
    private rl: readline.Interface;
    private activeProcesses: ActiveProcess[] = [];
    private mode: 'credentials' | 'client' | null = null;
    public qrUrl: string | null = null;
    private lastLoginOptions: any = null; // Salva credenciais para reconectar
    private currentAppIds: number[] = []; // Salva os jogos atuais para retomar farm
    private idleTimer: NodeJS.Timeout | null = null; // Referência para o timer de parada
    private gameNames: Map<number, string> = new Map(); // Cache local de nomes para logs

    constructor(private gameService: GameService) {
        super();
        this.client = new SteamUser();
        
        // Interface para entrada de dados no terminal (Steam Guard)
        this.rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });

        this.initializeEvents();
    }

    /**
     * Centraliza os logs para enviar tanto para o terminal quanto para o navegador via evento.
     */
    private log(message: string, type: 'info' | 'error' | 'warning' = 'info'): void {
        const timestamp = new Date().toLocaleTimeString();
        const formattedMsg = `[${timestamp}] ${message}`;
        
        if (type === 'error') console.error(formattedMsg);
        else console.log(formattedMsg);

        // Emite o evento para o server.ts enviar ao frontend
        this.emit('log-event', { message: formattedMsg, type });
    }

    private initializeEvents(): void {
        // Evento disparado quando o login é bem-sucedido
        this.client.on('loggedOn', () => {
            this.log('Conectado à Steam com sucesso!');
            // Usamos 'Invisible' para não atrapalhar sua sessão principal nem notificar amigos
            this.client.setPersona(SteamUser.EPersonaState.Invisible);
            
            // Se houver jogos configurados, inicia/retoma o farm automaticamente
            if (this.currentAppIds.length > 0) {
                this.log(`Retomando farm nos AppIDs: ${this.currentAppIds.join(', ')}`);
                this.client.gamesPlayed(this.currentAppIds);
            }
        });

        // Evento para lidar com Steam Guard (Email ou Mobile)
        this.client.on('steamGuard', (domain, callback) => {
            this.log('Steam Guard solicitado.', 'warning');
            const query = domain 
                ? `Código enviado para o email (${domain}): ` 
                : 'Código do autenticador móvel (2FA): ';
            
            this.rl.question(query, (code) => {
                callback(code.trim());
            });
        });

        // Evento recomendado pela documentação para manter credenciais atualizadas
        this.client.on('refreshToken', (token) => {
            this.log('Nota: Refresh Token atualizado pela Steam.');
            if (this.mode === 'credentials') {
                if (!this.lastLoginOptions) this.lastLoginOptions = {};
                this.lastLoginOptions.refreshToken = token;
            }
        });

        this.client.on('error', (err) => {
            this.log(`Ocorreu um problema: ${err.message}`, 'error');
            // Se der erro de login por já estar conectado
            if (err.message === 'LoggedInElsewhere' || err.message === 'LogonSessionReplaced') {
                this.handleConflict();
            }
        });

        // Evento disparado quando a conexão cai (ex: você abriu um jogo e a Steam chutou o bot)
        this.client.on('disconnected', (eresult, msg) => {
            this.log(`[Desconectado] Razão: ${msg} (${eresult})`, 'warning');
            
            // EResult 6 = LoggedInElsewhere
            // EResult 34 = LogonSessionReplaced
            if (eresult === SteamUser.EResult.LoggedInElsewhere || eresult === SteamUser.EResult.LogonSessionReplaced) {
                this.handleConflict();
            }
        });
    }

    /**
     * Gerencia o conflito de sessão: Espera 5 minutos e tenta voltar.
     */
    private handleConflict(): void {
        this.log('⚠ Detectado uso da Steam no PC (Você está jogando).', 'warning');
        this.log('💤 O farm entrará em modo de espera por 5 minutos para não te atrapalhar.');
        
        setTimeout(() => {
            if (this.mode === 'credentials' && this.lastLoginOptions) {
                this.log('🔄 Tentando retomar o farm...');
                this.log('👀 Verificando se a conta está livre para voltar a farmar...');
                this.client.logOn(this.lastLoginOptions);
            }
        }, 5 * 60 * 1000);
    }

    /**
     * MODO 1: Inicia o idling usando credenciais (Steam Headless).
     */
    public startIdlingWithCredentials(username: string, password: string, appIds: number[], durationMinutes: number): void {
        this.mode = 'credentials';
        this.lastLoginOptions = { accountName: username, password: password };
        this.currentAppIds = appIds;

        this.log(`Iniciando login para o usuário: ${username}`);
        
        this.client.logOn(this.lastLoginOptions);

        this.log(`Timer definido para encerrar em ${durationMinutes} minutos.`);
        // O timer encerra tudo definitivamente após o tempo estipulado
        this.idleTimer = setTimeout(() => { this.stopIdling(); }, durationMinutes * 60 * 1000);
    }

    /**
     * MODO 3: Login via QR Code (Sem senha, usa app mobile).
     */
    public async startIdlingWithQR(appIds: number[], durationMinutes: number): Promise<void> {
        this.mode = 'credentials';
        this.qrUrl = null;
        this.currentAppIds = appIds;

        try {
            const session = new LoginSession(EAuthTokenPlatformType.MobileApp);
            
            // Configura listeners para o evento de autenticação
            session.on('authenticated', () => {
                this.qrUrl = null; // Limpa o QR pois já foi usado
                this.lastLoginOptions = { refreshToken: session.refreshToken as string };
                this.client.logOn(this.lastLoginOptions);
            });

            session.on('timeout', () => {
                this.log('QR Code expirou.', 'warning');
                this.qrUrl = null;
            });

            session.on('error', (err) => {
                this.log(`Erro na sessão QR Code: ${err.message}`, 'error');
                this.qrUrl = null;
            });

            const startResult = await session.startWithQR();
            
            // Salva a URL para o frontend exibir
            this.qrUrl = startResult.qrChallengeUrl;
            this.log('QR Code gerado. Aguardando leitura...');

            this.log(`Timer definido para encerrar em ${durationMinutes} minutos.`);
            this.idleTimer = setTimeout(() => { this.stopIdling(); }, durationMinutes * 60 * 1000);

        } catch (err) {
            this.log(`Erro no processo de QR Code: ${err}`, 'error');
            this.qrUrl = null;
        }
    }

    /**
     * MODO 2: Inicia o idling simulando processos (Requer Steam oficial aberta).
     * Cria processos "fantasmas" que herdam a variável SteamAppId.
     */
    public async startIdlingWithClient(appIds: number[], durationMinutes: number): Promise<void> {
        // Para processos anteriores para evitar duplicatas e limpar timers antigos
        this.stopIdling();

        this.mode = 'client';
        this.log(`Iniciando modo Cliente (Steam deve estar aberta). AppIDs: ${appIds.join(', ')}`);
        
        // Caminho absoluto para o nosso script worker
        const workerPath = path.join(__dirname, 'client_worker.js');

        // Busca os nomes dos jogos antes de iniciar
        this.log('Resolvendo nomes dos jogos...');
        for (const id of appIds) {
            const details = await this.gameService.getGameDetails(id);
            this.gameNames.set(id, details ? details.name : `AppID ${id}`);
        }

        appIds.forEach(appId => {
            try {
                // Inicia o worker usando o próprio Node.js do sistema
                const child = spawn(process.execPath, [workerPath], {
                    detached: false,
                    // Passamos o ID via variável de ambiente, que o worker vai ler
                    env: { ...process.env, SteamAppId: appId.toString() }
                });
                
                // Redireciona logs do worker para o terminal principal para vermos erros
                const gameName = this.gameNames.get(appId) || appId;
                
                child.stdout?.on('data', d => this.log(`[${gameName}]: ${d.toString().trim()}`));
                // Filtra erros comuns de minidump que poluem o log
                child.stderr?.on('data', d => {
                    const msg = d.toString().trim();
                    if (!msg.includes('minidump') && !msg.includes('Caching Steam ID')) {
                        this.log(`[Erro ${gameName}]: ${msg}`, 'error');
                    }
                });

                this.activeProcesses.push({ process: child, appId });
                this.log(`Processo iniciado para: ${gameName} (PID: ${child.pid})`);
            } catch (e) {
                this.log(`Erro ao iniciar AppID ${appId}: ${e}`, 'error');
            }
        });

        this.log(`Timer definido para encerrar em ${durationMinutes} minutos.`);
        this.idleTimer = setTimeout(() => { this.stopIdling(); }, durationMinutes * 60 * 1000);
    }

    public stopIdling(): void {
        this.log('Tempo esgotado ou parada solicitada. Encerrando...');
        
        if (this.idleTimer) {
            clearTimeout(this.idleTimer);
            this.idleTimer = null;
        }
        
        if (this.mode === 'credentials') {
            try { this.client.gamesPlayed([]); } catch (e) { /* Ignora se já caiu */ }
            try { this.client.logOff(); } catch (e) { /* Ignora se já caiu */ }
        } else if (this.mode === 'client') {
            this.activeProcesses.forEach(item => {
                try {
                    // Mata o processo
                    item.process.kill();
                } catch (e) {
                    this.log(`Erro ao finalizar processo ${item.process.pid}: ${e}`, 'error');
                }
            });
            this.activeProcesses = [];
        }

        // Resetamos o modo mas mantemos o servidor rodando
        this.mode = null;
        this.qrUrl = null;
        this.lastLoginOptions = null;
        this.currentAppIds = [];
    }
}