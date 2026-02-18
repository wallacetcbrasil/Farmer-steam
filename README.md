# Steam Farmer 🚜

Uma ferramenta visual e robusta para farmar horas de jogo e cartas na Steam. Desenvolvida em Node.js com TypeScript.

![License](https://img.shields.io/badge/license-MIT-blue.svg)

## 🚀 Funcionalidades

- **Modo Cliente (Steam Aberta):** Farma jogos utilizando a instalação local da Steam. Permite jogar outros títulos simultaneamente sem conflitos (o farm roda em background).
- **Modo Credenciais (Headless):** Farma em servidores ou PC sem Steam instalada (requer login/senha).
- **Modo QR Code:** Login seguro via aplicativo móvel da Steam, sem necessidade de digitar a senha.
- **Interface Web:** Controle visual amigável para buscar jogos, ver capas e gerenciar o farm.
- **Reconexão Inteligente:** Detecta se você abriu um jogo e pausa o farm automaticamente para evitar desconexões.

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

3. (Opcional) Configure as variáveis de ambiente:
   - Renomeie o arquivo `.env.example` para `.env`.
   - Preencha com seu usuário e senha se quiser usar o login automático.

## 🎮 Como Usar

1. Inicie a aplicação:

   ```bash
   npm start
   ```

2. Abra o navegador em:
   `http://localhost:3000`

3. Pesquise o nome do jogo, selecione-o e clique em **Iniciar Farm**.

## ⚠️ Aviso Legal

Esta ferramenta foi desenvolvida para fins educacionais e de aprendizado. O uso de softwares de automação pode violar os Termos de Serviço da Steam. O autor não se responsabiliza por quaisquer consequências do uso desta ferramenta.

## 📄 Licença

Distribuído sob a licença MIT. Veja `LICENSE` para mais informações.
