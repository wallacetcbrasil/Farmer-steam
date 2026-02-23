import { ChildProcess, spawn } from 'child_process';
import * as dotenv from 'dotenv';
import { EventEmitter } from 'events';
import * as path from 'path';
import { GameWithDrops, SteamCommunityService } from './steam_community_service';

dotenv.config(); // Carrega as variáveis do arquivo .env

import { GameService } from './game_service';

interface ActiveProcess {
    process: ChildProcess;
    appId: number;
}

interface ScheduledAchievement {
    achievementId: string;
    unlockTime: number; // Timestamp de quando desbloquear
}

export class SteamIdler extends EventEmitter {
    private activeProcesses: ActiveProcess[] = [];
    private mode: 'client' | 'achievement' | 'cards' | null = null;
    private idleTimer: NodeJS.Timeout | null = null; // Referência para o timer de parada
    private gameNames: Map<number, string> = new Map(); // Cache local de nomes para logs
    private achievementTimers: NodeJS.Timeout[] = []; // Timers para conquistas

    // Estado para o farm de cartas
    private cardFarmQueue: GameWithDrops[] = [];
    private currentCardFarmGame: GameWithDrops | null = null;
    private cardCheckInterval: NodeJS.Timeout | null = null;
    private communityService: SteamCommunityService | null = null;

    constructor(private gameService: GameService) {
        super();
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
        try {
            const gameDetailsMap = await this.gameService.getMultipleGameDetails(appIds);
            for (const id of appIds) {
                const details = gameDetailsMap.get(id);
                this.gameNames.set(id, details ? details.name : `AppID ${id}`);
            }
        } catch (error: any) {
            this.log(`Falha ao buscar detalhes dos jogos: ${error.message}. Usando AppIDs como nomes.`, 'error');
            // Se a busca falhar (ex: rate limit), continuamos usando os IDs como fallback.
            for (const id of appIds) {
                this.gameNames.set(id, `AppID ${id}`);
            }
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

    /**
     * MODO 3: Inicia o farm de conquistas com agendamento.
     * @param appId O ID do jogo.
     * @param achievementsToUnlock Lista de IDs das conquistas (ex: 'ACH_WIN_10_GAMES').
     * @param minMinutes Tempo mínimo em minutos para começar a desbloquear.
     * @param maxMinutes Tempo máximo em minutos para desbloquear tudo.
     */
    public async startAchievementFarm(appId: number, achievementsToUnlock: string[], minMinutes: number, maxMinutes: number) {
        this.stopIdling();
        this.mode = 'achievement'; // Modo dedicado para conquistas

        const gameName = (await this.gameService.getGameDetails(appId))?.name || `AppID ${appId}`;
        this.log(`Iniciando farm de conquistas para ${gameName}.`);
        this.log(`Agendando ${achievementsToUnlock.length} conquistas para desbloquear entre ${minMinutes} e ${maxMinutes} minutos.`);

        if (achievementsToUnlock.length === 0) {
            this.log('Nenhuma conquista selecionada para farmar. Operação cancelada.', 'warning');
            this.mode = null; // Reseta o modo para consistência da UI
            return;
        }

        // Inicia um worker para o jogo (usando um worker especial de conquistas)
        const workerPath = path.join(__dirname, 'client_worker_achievements.js');
        const child = spawn(process.execPath, [workerPath], {
            detached: false,
            stdio: ['pipe', 'pipe', 'pipe', 'ipc'], // Habilita IPC para comunicação
            env: { ...process.env, SteamAppId: appId.toString() }
        });

        // Redireciona logs do worker para o log principal
        child.stdout?.on('data', d => this.log(`[${gameName}/Ach]: ${d.toString().trim()}`));
        child.stderr?.on('data', d => this.log(`[Erro ${gameName}/Ach]: ${d.toString().trim()}`, 'error'));

        this.activeProcesses.push({ process: child, appId });

        // Lógica de agendamento sequencial e aleatório
        const now = Date.now();
        const minMs = minMinutes * 60 * 1000;
        const maxMs = maxMinutes * 60 * 1000;
        const totalTimeSpan = maxMs - minMs;
        const timePerAchievement = totalTimeSpan / achievementsToUnlock.length;

        achievementsToUnlock.forEach((achId, index) => {
            // Define o "slot" de tempo para esta conquista, garantindo a ordem
            const slotStart = minMs + (index * timePerAchievement);
            const slotEnd = slotStart + timePerAchievement;

            // Calcula um delay aleatório dentro do slot de tempo específico desta conquista
            const delay = Math.random() * (slotEnd - slotStart) + slotStart;
            const unlockTime = new Date(now + delay).toLocaleTimeString();

            this.log(`Conquista '${achId}' (nº ${index + 1}) agendada para desbloqueio por volta de ${unlockTime}.`);

            const timer = setTimeout(() => {
                this.log(`[DESBLOQUEANDO] Enviando comando para '${achId}'...`);
                // Envia o comando para o processo filho via IPC
                child.send({ type: 'UNLOCK_ACHIEVEMENT', payload: achId });
            }, delay);
            this.achievementTimers.push(timer);
        });
    }

    /**
     * MODO 4: Inicia o farm de cartas, no estilo Idle Master.
     * Requer cookies do usuário para raspar dados da comunidade Steam.
     */
    public async startCardFarm(steamId64: string, sessionid: string, steamLoginSecure: string) {
        this.stopIdling();
        this.mode = 'cards';
        this.log('Iniciando modo de Farm de Cartas (estilo Idle Master).');

        try {
            this.communityService = new SteamCommunityService(steamId64, sessionid, steamLoginSecure);
            this.log('Buscando jogos com drops de cartas restantes. Isso pode levar vários minutos...');
            this.cardFarmQueue = await this.communityService.findAllGamesWithDrops();

            if (this.cardFarmQueue.length === 0) {
                this.log('Nenhum jogo com drops de cartas encontrado. Verifique se seus cookies e SteamID64 estão corretos e se sua conta não é limitada.', 'warning');
                this.stopIdling(); // Limpa o modo e estado
                return;
            }

            this.log(`Encontrados ${this.cardFarmQueue.length} jogos para farmar. Iniciando a fila...`);
            this.processNextCardFarmGame();

        } catch (error: any) {
            this.log(`Erro ao iniciar o farm de cartas: ${error.message}`, 'error');
            this.stopIdling();
        }
    }

    private processNextCardFarmGame() {
        // Para qualquer processo de jogo que esteja rodando
        if (this.activeProcesses.length > 0) {
            this.activeProcesses.forEach(p => p.process.kill());
            this.activeProcesses = [];
        }
        if (this.cardCheckInterval) {
            clearInterval(this.cardCheckInterval);
            this.cardCheckInterval = null;
        }

        if (this.cardFarmQueue.length === 0) {
            this.log('Fila de farm de cartas concluída! Todos os drops foram coletados.', 'info');
            this.stopIdling();
            return;
        }

        this.currentCardFarmGame = this.cardFarmQueue.shift()!;
        const game = this.currentCardFarmGame;
        this.log(`Iniciando farm para ${game.name} (AppID: ${game.appId}). Drops restantes: ${game.dropsRemaining}`);

        // Inicia o worker para simular que está jogando
        const workerPath = path.join(__dirname, 'client_worker.js');
        const child = spawn(process.execPath, [workerPath], {
            detached: false,
            env: { ...process.env, SteamAppId: game.appId.toString() }
        });
        this.activeProcesses.push({ process: child, appId: game.appId });

        // Verifica periodicamente se um drop ocorreu
        this.cardCheckInterval = setInterval(async () => {
            if (!this.communityService || !this.currentCardFarmGame) return;

            try {
                const dropsNow = await this.communityService.getDropsRemaining(this.currentCardFarmGame.appId);
                if (dropsNow < this.currentCardFarmGame.dropsRemaining) {
                    this.log(`Drop recebido para ${this.currentCardFarmGame.name}! Restam ${dropsNow} drops.`, 'info');
                    this.currentCardFarmGame.dropsRemaining = dropsNow;
                }
                if (dropsNow === 0) {
                    this.log(`Todos os drops de ${this.currentCardFarmGame.name} foram coletados. Passando para o próximo jogo.`, 'info');
                    this.processNextCardFarmGame();
                }
            } catch (error: any) {
                this.log(`Erro ao verificar drops para ${this.currentCardFarmGame.name}: ${error.message}. Tentando novamente em breve.`, 'warning');
            }
        }, 15 * 60 * 1000); // Verifica a cada 15 minutos
    }

    public stopIdling(): void {
        if (this.mode === null) {
            this.log('Nenhum processo de farm ativo para parar.', 'warning');
            return;
        }

        this.log('Parando o farm e encerrando processos...');

        if (this.idleTimer) {
            clearTimeout(this.idleTimer);
            this.idleTimer = null;
        }

        // Limpa os timers de conquistas agendadas
        this.achievementTimers.forEach(timer => clearTimeout(timer));
        this.achievementTimers = [];
        this.log('Agendamentos de conquistas cancelados.');
        
        // Limpa o estado do farm de cartas
        if (this.cardCheckInterval) {
            clearInterval(this.cardCheckInterval);
            this.cardCheckInterval = null;
        }
        this.cardFarmQueue = [];
        this.currentCardFarmGame = null;
        this.communityService = null;

        if (this.mode === 'client' || this.mode === 'achievement' || this.mode === 'cards') {
            this.activeProcesses.forEach(item => {
                try {
                    item.process.kill();
                } catch (e) {
                    this.log(`Erro ao finalizar processo ${item.process.pid}: ${e}`, 'error');
                }
            });
            this.activeProcesses = [];
        }

        this.mode = null;
    }
}