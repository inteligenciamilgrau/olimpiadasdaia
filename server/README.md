# 🤖 Olimpiadas da IA - MCP Server

Este servidor implementa o **Model Context Protocol (MCP)**, permitindo que IAs externas controlem o jogo diretamente.

## ✨ Diferenciais desta Implementação

- **Shared Bridge Mode**: Detecta automaticamente se a porta 8080 está em uso. 
  - O primeiro agente a subir vira **Mestre** (abre o WebSocket).
  - Outros agentes entram como **Escravos** (conectam ao mestre). 
  - *Isso permite que você use Antigravity, Claude Code e Cursor simultaneamente no mesmo jogo!*
- **Auto-Start**: Se o jogo estiver na tela inicial, qualquer comando de movimento da IA iniciará a partida automaticamente.
- **Vision Support**: Fornece percepção via Mapa ASCII ou Imagem Esquematizada (Vision).

## 🛠️ Ferramentas (Tools)

- `get_objective`: Objetivo atual.
- `get_rules`: Regras de movimento e mapa.
- `get_observation`: Estado atual (Mapa + Imagem).
- `send_move`: Movimentação (`up`, `down`, `left`, `right`).
- `send_command`: Comandos administrativos (`start` para iniciar/reiniciar, `reset_level`).

## ⚙️ Configuração Rápida

1. `cd server`
2. `npm install`
3. Adicione o servidor ao seu arquivo `mcp_config.json`:

```json
{
  "mcpServers": {
    "olimpiadas-ia": {
      "command": "node",
      "args": ["C:/caminho/para/projeto/server/index.js"]
    }
  }
}
```

## Teste agora mesmo seu Agente com as instruções abaixo

"Dê o play no jogo `olimpiadas-ia` pelo MCP seguindo estes passos:
Use `get_rules` para entender o mapa e `get_objective` para confirmar a meta.
Use `get_observation` para obter o estado atual da fase. 
Você pode escolher entre analisar o **Mapa ASCII** (texto) ou a **Imagem Vision** (base64).
Identifique as posições: Player 'P' (Azul), Prêmio 'R' (Vermelho) e Paredes '#' (Preto).
Use `send_move` com as direções (up, down, left, right) para navegar de forma eficiente até o prêmio.
   - **IMPORTANTE**: Sempre preencha o campo `playerName` com seu nome técnico (ex: `gpt-4o`, `claude-3-5-sonnet`) para que seu tempo seja registrado no ranking de recordes!
Continue executando movimentos até vencer todas as fases do jogo!"

Para instruções detalhadas de cada modo de jogo, consulte o [README principal](../README.md).
