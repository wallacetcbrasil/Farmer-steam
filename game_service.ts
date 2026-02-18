export interface GameInfo {
    id: number;
    name: string;
    imageUrl: string;
}

export class GameService {
    // Cache simples em memória para evitar requisições repetidas
    private cache: Map<number, GameInfo> = new Map();

    /**
     * Busca informações de um jogo na API oficial da Steam Store.
     * @param appId O ID do jogo (ex: 730 para CS2)
     */
    public async getGameDetails(appId: number): Promise<GameInfo | null> {
        // 1. Verifica se já temos no cache
        if (this.cache.has(appId)) {
            return this.cache.get(appId) || null;
        }

        try {
            console.log(`[GameService] Buscando detalhes na API Steam para AppID: ${appId}...`);
            const response = await fetch(`https://store.steampowered.com/api/appdetails?appids=${appId}`);
            if (!response.ok) {
                throw new Error(`Falha na requisição: ${response.status} ${response.statusText}`);
            }
            const data: any = await response.json();
            console.log(`[GameService] Resposta recebida para ${appId}. Status: ${response.status}`);

            // A estrutura da resposta da Steam é: { "730": { success: true, data: { ... } } }
            if (data[appId] && data[appId].success) {
                const gameData = data[appId].data;
                
                const info: GameInfo = {
                    id: appId,
                    name: gameData.name,
                    imageUrl: gameData.header_image // URL da imagem de capa (banner)
                };

                // Salva no cache
                this.cache.set(appId, info);
                return info;
            } else {
                console.warn(`Jogo ${appId} não encontrado ou loja indisponível.`);
                return null;
            }
        } catch (error) {
            console.error(`Erro ao buscar dados do jogo ${appId}:`, error);
            return null;
        }
    }

    /**
     * Pesquisa jogos pelo nome usando a API de busca da loja Steam.
     */
    public async searchGame(query: string): Promise<GameInfo[]> {
        try {
            console.log(`[GameService] Consultando API de busca para: "${query}"`);
            const response = await fetch(`https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(query)}&l=english&cc=US`);
            if (!response.ok) {
                throw new Error(`Falha na busca: ${response.status}`);
            }
            const data: any = await response.json();
            console.log(`[GameService] Busca retornou ${data.items ? data.items.length : 0} resultados.`);

            if (data.items && Array.isArray(data.items)) {
                return data.items.map((item: any) => ({
                    id: item.id,
                    name: item.name,
                    // A API de busca retorna uma imagem pequena, vamos construir a URL da imagem de capa padrão
                    imageUrl: `https://cdn.cloudflare.steamstatic.com/steam/apps/${item.id}/header.jpg`
                }));
            }
            return [];
        } catch (error) {
            console.error('Erro na pesquisa:', error);
            return [];
        }
    }
}