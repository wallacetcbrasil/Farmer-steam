import { ChildProcess, spawn } from 'child_process';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as readline from 'readline';
import { EAuthTokenPlatformType, LoginSession } from 'steam-session';
import SteamUser from 'steam-user';

dotenv.config(); // Carrega as variáveis do arquivo .env

interface ActiveProcess {
    process: ChildProcess;
    appId: number;
}

export class SteamIdler {
    private client: SteamUser;
    private rl: readline.Interface;
    private activeProcesses: ActiveProcess[] = [];
    private mode: 'credentials' | 'client' | null = null;
    public qrUrl: string | null = null;
    private lastLoginOptions: any = null; // Salva credenciais para reconectar
    private currentAppIds: number[] = []; // Salva os jogos atuais para retomar farm

    constructor() {
        this.client = new SteamUser();
        
        // Interface para entrada de dados no terminal (Steam Guard)
        this.rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });

        this.initializeEvents();
    }

    private initializeEvents(): void {
        // Evento disparado quando o login é bem-sucedido
        this.client.on('loggedOn', () => {
            console.log(`[${new Date().toLocaleTimeString()}] Conectado à Steam com sucesso!`);
            // Usamos 'Invisible' para não atrapalhar sua sessão principal nem notificar amigos
            this.client.setPersona(SteamUser.EPersonaState.Invisible);
            
            // Se houver jogos configurados, inicia/retoma o farm automaticamente
            if (this.currentAppIds.length > 0) {
                console.log(`Retomando farm nos AppIDs: ${this.currentAppIds.join(', ')}`);
                this.client.gamesPlayed(this.currentAppIds);
            }
        });

        // Evento para lidar com Steam Guard (Email ou Mobile)
        this.client.on('steamGuard', (domain, callback) => {
            console.log('Steam Guard solicitado.');
            const query = domain 
                ? `Código enviado para o email (${domain}): ` 
                : 'Código do autenticador móvel (2FA): ';
            
            this.rl.question(query, (code) => {
                callback(code.trim());
            });
        });

        this.client.on('error', (err) => {
            console.error(`[Erro] Ocorreu um problema: ${err.message}`);
            // Se der erro de login por já estar conectado
            if (err.message === 'LoggedInElsewhere' || err.message === 'LogonSessionReplaced') {
                this.handleConflict();
            }
        });

        // Evento disparado quando a conexão cai (ex: você abriu um jogo e a Steam chutou o bot)
        this.client.on('disconnected', (eresult, msg) => {
            console.log(`[Desconectado] Razão: ${msg} (${eresult})`);
            
            // EResult 6 = LoggedInElsewhere
            // EResult 34 = LogonSessionReplaced
            if (eresult === 6 || eresult === 34) {
                this.handleConflict();
            }
        });
    }

    /**
     * Gerencia o conflito de sessão: Espera 5 minutos e tenta voltar.
     */
    private handleConflict(): void {
        console.log('⚠ Detectado uso da Steam no PC (Você está jogando).');
        console.log('💤 O farm entrará em modo de espera por 5 minutos para não te atrapalhar.');
        
        setTimeout(() => {
            if (this.mode === 'credentials' && this.lastLoginOptions) {
                console.log('🔄 Tentando retomar o farm...');
                console.log('👀 Verificando se a conta está livre para voltar a farmar...');
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

        console.log(`Iniciando login para o usuário: ${username}`);
        
        this.client.logOn(this.lastLoginOptions);

        console.log(`Timer definido para encerrar em ${durationMinutes} minutos.`);
        // O timer encerra tudo definitivamente após o tempo estipulado
        setTimeout(() => { this.stopIdling(); }, durationMinutes * 60 * 1000);
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
                console.log('QR Code expirou.');
                this.qrUrl = null;
            });

            session.on('error', (err) => {
                console.error('Erro na sessão QR Code:', err);
                this.qrUrl = null;
            });

            const startResult = await session.startWithQR();
            
            // Salva a URL para o frontend exibir
            this.qrUrl = startResult.qrChallengeUrl;
            console.log('QR Code gerado. Aguardando leitura...');

            console.log(`Timer definido para encerrar em ${durationMinutes} minutos.`);
            setTimeout(() => { this.stopIdling(); }, durationMinutes * 60 * 1000);

        } catch (err) {
            console.error('Erro no processo de QR Code:', err);
            this.qrUrl = null;
        }
    }

    /**
     * MODO 2: Inicia o idling simulando processos (Requer Steam oficial aberta).
     * Cria processos "fantasmas" que herdam a variável SteamAppId.
     */
    public startIdlingWithClient(appIds: number[], durationMinutes: number): void {
        this.mode = 'client';
        console.log(`Iniciando modo Cliente (Steam deve estar aberta). AppIDs: ${appIds.join(', ')}`);
        
        // Caminho absoluto para o nosso script worker
        const workerPath = path.join(__dirname, 'client_worker.js');

        appIds.forEach(appId => {
            try {
                // Inicia o worker usando o próprio Node.js do sistema
                const child = spawn(process.execPath, [workerPath], {
                    detached: false,
                    // Passamos o ID via variável de ambiente, que o worker vai ler
                    env: { ...process.env, SteamAppId: appId.toString() }
                });
                
                // Redireciona logs do worker para o terminal principal para vermos erros
                child.stdout?.on('data', d => console.log(`[Jogo ${appId}]: ${d.toString().trim()}`));
                child.stderr?.on('data', d => console.error(`[Erro ${appId}]: ${d.toString().trim()}`));

                this.activeProcesses.push({ process: child, appId });
                console.log(`Processo iniciado para AppID: ${appId} (PID: ${child.pid})`);
            } catch (e) {
                console.error(`Erro ao iniciar AppID ${appId}:`, e);
            }
        });

        console.log(`Timer definido para encerrar em ${durationMinutes} minutos.`);
        setTimeout(() => {
            this.stopIdling();
        }, durationMinutes * 60 * 1000);
    }

    public stopIdling(): void {
        console.log('Tempo esgotado ou parada solicitada. Encerrando...');
        
        if (this.mode === 'credentials') {
            try { this.client.gamesPlayed([]); } catch (e) { /* Ignora se já caiu */ }
            try { this.client.logOff(); } catch (e) { /* Ignora se já caiu */ }
        } else if (this.mode === 'client') {
            this.activeProcesses.forEach(item => {
                try {
                    // Mata o processo
                    item.process.kill();
                } catch (e) {
                    console.error(`Erro ao finalizar processo ${item.process.pid}:`, e);
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