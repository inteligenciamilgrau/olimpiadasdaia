const { Server } = require("@modelcontextprotocol/sdk/server/index.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} = require("@modelcontextprotocol/sdk/types.js");
const { WebSocketServer, WebSocket } = require("ws");
const MAP_DATA = require("../maps.js");

// --- Game State Store ---
let lastGameState = {
    map: "Aguardando conexão do jogo...",
    image: null,
    score: 0,
    levelIdx: 0,
    active: false
};

// --- WebSocket Bridge (Shared Mode) ---
let isBridgeMaster = false;
let bridgeConn = null; // Used if we are a slave
const clients = new Set(); // Used if we are a master

function setupBridge() {
    const wss = new WebSocketServer({ port: 8080 });

    wss.on('listening', () => {
        isBridgeMaster = true;
        console.error("[MCP Bridge] Modo MESTRE (Porta 8080 aberta)");
    });

    wss.on('connection', (ws) => {
        clients.add(ws);
        
        // Solicita uma atualização de estado ao jogo para garantir que o novo cliente receba os dados atuais
        const reqUpdate = JSON.stringify({ type: 'request_update' });
        clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) client.send(reqUpdate);
        });

        ws.on('message', (message) => {
            try {
                const data = JSON.parse(message);
                if (data.type === 'update') {
                    lastGameState = data;
                }
                
                // Broadcast para todos os outros (agentes escravos e o próprio browser)
                clients.forEach(client => {
                    if (client !== ws && client.readyState === WebSocket.OPEN) {
                        client.send(message.toString());
                    }
                });
            } catch (e) {
                console.error("[MCP Bridge] Erro ao processar mensagem no mestre:", e);
            }
        });

        ws.on('close', () => clients.delete(ws));
    });

    wss.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
            console.error("[MCP Bridge] Porta 8080 em uso. Operando em modo ESCRAVO (conectando ao mestre)...");
            setupSlaveConnection();
        } else {
            console.error("[MCP Bridge] Erro crítico no WebSocket:", err);
        }
    });
}

function setupSlaveConnection() {
    bridgeConn = new WebSocket('ws://localhost:8080');
    
    bridgeConn.on('open', () => {
        console.error("[MCP Bridge] Conectado ao bridge mestre.");
    });

    bridgeConn.on('message', (data) => {
        try {
            const parsed = JSON.parse(data.toString());
            if (parsed.type === 'update') {
                lastGameState = parsed;
            }
        } catch (e) { }
    });

    bridgeConn.on('close', () => {
        console.error("[MCP Bridge] Conexão com mestre perdida. Reconectando...");
        bridgeConn = null;
        setTimeout(setupSlaveConnection, 2000);
    });

    bridgeConn.on('error', () => {
        // Silently retry via close handler
    });
}

function sendBridgeMessage(msg) {
    if (isBridgeMaster) {
        clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) client.send(msg);
        });
    } else if (bridgeConn && bridgeConn.readyState === WebSocket.OPEN) {
        bridgeConn.send(msg);
    } else {
        throw new Error("Não há conexão ativa com o bridge (mestre ou escravo).");
    }
}

setupBridge();

// --- MCP Server Logic ---
class GameMcpServer {
    constructor() {
        this.server = new Server(
            {
                name: "olimpiadas-ia-server",
                version: "1.1.0",
            },
            {
                capabilities: {
                    tools: {},
                },
            }
        );

        this.setupToolHandlers();
        
        this.server.onerror = (error) => console.error("[MCP Error]", error);
        process.on("SIGINT", async () => {
            await this.server.close();
            process.exit(0);
        });
    }

    setupToolHandlers() {
        this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
            tools: [
                {
                    name: "get_objective",
                    description: "Returns the current objective of the game. Use this to understand what the AI needs to achieve.",
                    inputSchema: { type: "object", properties: {} },
                },
                {
                    name: "get_rules",
                    description: "Returns the movement rules and explanation of map elements (walls, player, reward).",
                    inputSchema: { type: "object", properties: {} },
                },
                {
                    name: "get_observation",
                    description: "Returns the current state of the level, including an ASCII map, image, and game status (active/inactive).",
                    inputSchema: { type: "object", properties: {} },
                },
                {
                    name: "send_move",
                    description: "Sends a movement command to the player in the game.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            direction: {
                                type: "string",
                                enum: ["up", "down", "left", "right"],
                                description: "The direction to move the player.",
                            },
                            playerName: {
                                type: "string",
                                description: "Your AI model name (e.g., 'gpt-4o', 'claude-3-5-sonnet') to be used in the records.",
                            }
                        },
                        required: ["direction", "playerName"],
                    },
                },
                {
                    name: "send_command",
                    description: "Sends administrative commands to the game (e.g., start or reset).",
                    inputSchema: {
                        type: "object",
                        properties: {
                            command: {
                                type: "string",
                                enum: ["start", "reset_level", "clear_records", "goto_level"],
                                description: "The command to execute. Use 'start' to begin, 'reset_level' to restart current level, 'clear_records' to wipe the leaderboard, or 'goto_level' to jump to a specific level (requires levelIdx).",
                            },
                            levelIdx: {
                                type: "number",
                                description: "The index of the level to jump to (0-based). Only used with 'goto_level'.",
                            },
                            playerName: {
                                type: "string",
                                description: "Your AI model name to identify you in the game session.",
                            }
                        },
                        required: ["command", "playerName"],
                    },
                },
            ],
        }));

        this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
            switch (request.params.name) {
                case "get_objective":
                    return {
                        content: [{ type: "text", text: "OBJETIVO: Navegue pelo labirinto e alcance o prêmio 'R' (Red/Vermelho)." }],
                    };

                case "get_rules":
                    return {
                        content: [{ 
                            type: "text", 
                            text: "REGRAS:\n- Movimentos: up, down, left, right.\n- Você é o 'P' (AZUL).\n- O prêmio é o 'R' (VERMELHO).\n- Paredes são '#' (PRETO) e bloqueiam movimento." 
                        }],
                    };

                case "get_observation":
                    let statusText = lastGameState.active 
                        ? `STATUS: Em jogo (Fase: ${lastGameState.levelName || lastGameState.levelIdx})`
                        : "STATUS: Menu Principal / Tela de Vitória (O jogo ainda não começou ou terminou)";
                    
                    const obs = [
                        { type: "text", text: `${statusText}\n\nMapa ASCII:\n${lastGameState.map}\n\nIMPORTANTE: Ao enviar sua jogada em 'send_move', identifique-se obrigatoriamente usando seu nome técnico de modelo (ex: 'claude-3-5-sonnet', 'gpt-4o', etc) no campo 'playerName'.` }
                    ];
                    
                    if (lastGameState.image) {
                        try {
                            const base64Data = lastGameState.image.includes(',') 
                                ? lastGameState.image.split(',')[1] 
                                : lastGameState.image;
                            obs.push({
                                type: "image",
                                data: base64Data,
                                mimeType: "image/png"
                            });
                        } catch (e) {
                            console.error("[MCP] Erro ao processar imagem para o agente:", e);
                        }
                    }
                    return { content: obs };

                case "send_move": {
                    const { direction, playerName } = request.params.arguments;
                    
                    try {
                        const moveCmd = JSON.stringify({ 
                            type: 'move', 
                            direction, 
                            playerName: playerName || "IA Misteriosa",
                            source: 'ws',
                            seq: Date.now() 
                        });
                        
                        sendBridgeMessage(moveCmd);

                        return {
                            content: [{ type: "text", text: `Comando '${direction}' enviado com sucesso.` }],
                        };
                    } catch (e) {
                        throw new McpError(ErrorCode.InternalError, `Erro ao enviar comando para o bridge: ${e.message}`);
                    }
                }

                case "send_command": {
                    const { command, playerName, levelIdx } = request.params.arguments;
                    try {
                        const cmd = JSON.stringify({ 
                            type: command, 
                            playerName: playerName || "IA Misteriosa",
                            levelIdx: levelIdx,
                            source: 'ws',
                            seq: Date.now() 
                        });
                        
                        sendBridgeMessage(cmd);

                        const msgSuffix = command === 'goto_level' ? ` (Fase ${levelIdx})` : '';
                        return {
                            content: [{ type: "text", text: `Comando administrativo '${command}'${msgSuffix} enviado com sucesso.` }],
                        };
                    } catch (e) {
                        throw new McpError(ErrorCode.InternalError, `Erro ao enviar comando administrativo: ${e.message}`);
                    }
                }

                default:
                    throw new McpError(ErrorCode.MethodNotFound, `Ferramenta desconhecida: ${request.params.name}`);
            }
        });
    }

    async run() {
        const transport = new StdioServerTransport();
        await this.server.connect(transport);
        console.error(`Olimpiadas IA MCP Server rodando via stdio (${isBridgeMaster ? 'MESTRE' : 'ESCRAVO'})`);
    }
}

const server = new GameMcpServer();
server.run().catch(console.error);
