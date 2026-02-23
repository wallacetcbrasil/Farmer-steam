import * as dotenv from 'dotenv';

dotenv.config();

export interface AchievementInfo {
    apiName: string; // Ex: 'ACH_WIN_ONE_GAME'
    displayName: string; // Ex: 'Primeira Vitória'
    description: string;
    icon: string;
    iconGray: string;
    hidden: boolean;
}

export class SteamAPIService {

    constructor() {
        // O construtor agora está vazio. A chave será passada por método.
    }

    /**
     * Busca o esquema de um jogo, incluindo todas as suas conquistas.
     * @param appId O ID do jogo.
     * @param apiKey A chave da API da Steam do usuário.
     */
    public async getGameSchema(appId: number, apiKey: string): Promise<AchievementInfo[] | null> {
        if (!apiKey) {
            throw new Error('Chave da API da Steam não fornecida na requisição.');
        }

        try {
            const url = `https://api.steampowered.com/ISteamUserStats/GetSchemaForGame/v2/?key=${apiKey}&appid=${appId}&l=brazilian`;
            const response = await fetch(url);
            if (!response.ok) throw new Error(`Falha ao buscar esquema do jogo: ${response.statusText}`);
            
            const data: any = await response.json();

            return data?.game?.availableGameStats?.achievements || [];
        } catch (error) {
            console.error(`[SteamAPIService] Erro ao buscar conquistas para o AppID ${appId}:`, error);
            return null;
        }
    }
}