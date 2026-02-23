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
        // 1. Verifica o cache primeiro para uma resposta rápida
        if (this.cache.has(appId)) {
            return this.cache.get(appId) || null;
        }

        // 2. Delega para a função de busca em lote para otimizar a requisição.
        // Mesmo para um único ID, isso centraliza a lógica de chamada da API.
        try {
            const results = await this.getMultipleGameDetails([appId]);
            return results.get(appId) || null;
        } catch (error) {
            // A função getMultipleGameDetails já loga o erro.
            // Retornamos null para manter a assinatura do método.
            return null;
        }
    }

    /**
     * Busca informações de vários jogos de uma vez, otimizando as requisições para evitar rate limits.
     * @param appIds Uma lista de IDs de jogos.
     * @returns Um Map onde a chave é o AppID e o valor é a informação do jogo.
     */
    public async getMultipleGameDetails(appIds: number[]): Promise<Map<number, GameInfo>> {
        const results = new Map<number, GameInfo>();
        const idsToFetch: number[] = [];

        // Separa os que já estão no cache dos que precisam ser buscados
        for (const appId of appIds) {
            if (this.cache.has(appId)) {
                results.set(appId, this.cache.get(appId)!);
            } else {
                idsToFetch.push(appId);
            }
        }

        if (idsToFetch.length === 0) {
            console.log(`[GameService] Detalhes de todos os jogos solicitados já estavam em cache.`);
            return results;
        }

        try {
            const appIdsString = idsToFetch.join(',');
            console.log(`[GameService] Buscando detalhes na API Steam para ${idsToFetch.length} AppIDs: ${appIdsString}...`);
            const response = await fetch(`https://store.steampowered.com/api/appdetails?appids=${appIdsString}`);

            if (response.status === 429) {
                // Lança um erro específico para que o chamador possa tratar o rate limit.
                throw new Error(`Muitas requisições (429). A API da Steam limitou o acesso. Tente novamente mais tarde ou com menos jogos.`);
            }
            if (!response.ok) {
                throw new Error(`Falha na requisição: ${response.status} ${response.statusText}`);
            }
            const data: any = await response.json();
            console.log(`[GameService] Resposta em lote recebida. Status: ${response.status}`);

            // Processa a resposta para cada ID que buscamos
            for (const appId of idsToFetch) {
                const appIdStr = appId.toString();
                if (data[appIdStr] && data[appIdStr].success) {
                    const gameData = data[appIdStr].data;
                    
                    const info: GameInfo = {
                        id: appId,
                        name: gameData.name,
                        imageUrl: gameData.header_image // URL da imagem de capa (banner)
                    };

                    // Salva no cache e no resultado
                    this.cache.set(appId, info);
                    results.set(appId, info);
                } else {
                    console.warn(`[GameService] Jogo ${appId} não encontrado ou falhou na resposta em lote.`);
                }
            }
        } catch (error) {
            console.error(`[GameService] Erro ao buscar dados de múltiplos jogos:`, error);
            // Re-lança o erro para que o chamador (ex: Idler) saiba que a operação falhou.
            throw error;
        }
        return results;
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