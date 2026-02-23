import * as cheerio from 'cheerio';

export interface GameWithDrops {
    appId: number;
    name: string;
    dropsRemaining: number;
    playtime: number;
}

/**
 * Lida com a raspagem de dados (web scraping) das páginas da Comunidade Steam.
 * Requer cookies de autenticação para acessar dados do perfil do usuário.
 */
export class SteamCommunityService {
    private cookies: string;
    private steamId64: string;

    constructor(steamId64: string, sessionid: string, steamLoginSecure: string) {
        if (!steamId64 || !sessionid || !steamLoginSecure) {
            throw new Error('SteamID64, sessionid e steamLoginSecure são necessários.');
        }
        this.steamId64 = steamId64;
        // Monta o cabeçalho de cookie necessário para as requisições
        this.cookies = `sessionid=${sessionid}; steamLoginSecure=${steamLoginSecure};`;
    }

    /**
     * Raspa a página "Todos os Jogos" do usuário para obter a lista completa.
     * Este é o método mais confiável, pois a API pode não listar tudo.
     */
    private async getOwnedGames(): Promise<{appId: number, name: string, playtime: number}[]> {
        const url = `https://steamcommunity.com/profiles/${this.steamId64}/games/?tab=all`;
        const response = await fetch(url, { headers: { 'Cookie': this.cookies } });
        const html = await response.text();
        const $ = cheerio.load(html);

        // Os dados dos jogos estão em uma variável JavaScript 'rgGames' no HTML da página
        const scriptContent = $('script').filter((i, el) => {
            return $(el).html()?.includes('var rgGames = ') || false;
        }).html();

        if (!scriptContent) {
            throw new Error('Não foi possível encontrar a lista de jogos (rgGames) na página. Os cookies podem estar inválidos, o perfil pode ser privado ou a estrutura da página da Steam mudou.');
        }

        // Extrai o JSON de dentro da tag <script>
        const jsonString = scriptContent.substring(scriptContent.indexOf('var rgGames = ') + 'var rgGames = '.length, scriptContent.lastIndexOf(';'));
        const gamesData = JSON.parse(jsonString);

        return gamesData.map((game: any) => ({
            appId: game.appid,
            name: game.name,
            playtime: game.hours_forever ? parseFloat(game.hours_forever.replace(',', '.')) : 0,
        }));
    }

    /**
     * Raspa a página de cartas de um jogo para descobrir quantos drops restam.
     * @returns O número de drops restantes. Retorna 0 se não houver mais ou se o jogo não tiver cartas.
     */
    public async getDropsRemaining(appId: number): Promise<number> {
        const url = `https://steamcommunity.com/my/gamecards/${appId}/`;
        const response = await fetch(url, { headers: { 'Cookie': this.cookies } });
        const html = await response.text();
        const $ = cheerio.load(html);

        // O texto está em uma div com a classe .game_card_drops_remaining
        const dropText = $('.game_card_drops_remaining').text(); // Ex: "You have 3 card drops remaining"

        if (!dropText) return 0;

        const match = dropText.match(/(\d+)/); // Extrai o primeiro número encontrado no texto
        return match ? parseInt(match[1], 10) : 0;
    }

    /**
     * Varre todos os jogos do usuário para encontrar aqueles que ainda têm drops de cartas.
     * Esta é uma operação lenta e intensiva em requisições.
     */
    public async findAllGamesWithDrops(): Promise<GameWithDrops[]> {
        const ownedGames = await this.getOwnedGames();
        const gamesWithDrops: GameWithDrops[] = [];

        console.log(`[CommunityService] Verificando ${ownedGames.length} jogos por drops de cartas...`);

        for (const [index, game] of ownedGames.entries()) {
            const dropsRemaining = await this.getDropsRemaining(game.appId);
            if (dropsRemaining > 0) {
                gamesWithDrops.push({ ...game, dropsRemaining });
                console.log(`[CommunityService] Jogo encontrado: ${game.name} (${dropsRemaining} drops)`);
            }
            // Delay para não sobrecarregar os servidores da Steam
            await new Promise(resolve => setTimeout(resolve, 300));
        }
        return gamesWithDrops;
    }
}