# Steam Farmer 🚜

Uma ferramenta visual e robusta para farmar horas de jogo e cartas na Steam. Desenvolvida em Node.js com TypeScript.

![License](https://img.shields.io/badge/license-MIT-blue.svg)

## 🚀 Funcionalidades

- **Modo Cliente:** Farma horas de jogo utilizando a sua instalação local da Steam, que precisa estar aberta e logada.
- **Interface Web:** Controle visual amigável para buscar jogos, ver capas e gerenciar o farm.
- **Exportação de Lista:** Permite baixar uma lista de jogos selecionados para reutilização futura.
- **Farm por Arquivo:** Inicia o farm a partir de um arquivo `.txt` contendo uma lista de IDs de jogos.

## 📦 Instalação

1. Clone este repositório:

   ```bash
   git clone https://github.com/wallacetcbrasil/steam-farmer.git
   cd steam-farmer
   ```

2. Instale as dependências:

   ```bash
   npm install
   ```

## 🎮 Como Usar

1. Inicie a aplicação:

   ```bash
   npm start
   ```

   > **Dica (Debug):** Se quiser ver os logs do servidor nativamente no Console do Chrome (DevTools), rode com a flag de inspeção:
   >
   > ```bash
   > node --inspect -r ts-node/register server.ts
   > ```
   >
   > Depois acesse `chrome://inspect` no navegador e clique em "inspect".

2. Abra o navegador em:
   `http://localhost:3000`

3. Pesquise o nome do jogo, selecione-o e clique em **Iniciar Farm**.

## ⚠️ Aviso Legal

Esta ferramenta foi desenvolvida para fins educacionais e de aprendizado. O uso de softwares de automação pode violar os Termos de Serviço da Steam. O autor não se responsabiliza por quaisquer consequências do uso desta ferramenta.

## 📄 Licença

Distribuído sob a licença MIT. Veja `LICENSE` para mais informações.
