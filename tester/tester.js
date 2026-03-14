const channel = new BroadcastChannel('game_api');

// UI Elements: Connection & Stats
const connStatus = document.getElementById('connection-status');
const statLevel = document.getElementById('stat-level');
const statScore = document.getElementById('stat-score');

// UI Elements: Vision
const mapText = document.getElementById('map-text');
const mapImage = document.getElementById('map-image');

// UI Elements: Config
const apiKeyInput = document.getElementById('api-key');
const modelSearch = document.getElementById('model-search');
const modelList = document.getElementById('model-list');
const visionMode = document.getElementById('vision-mode');
const stepBtn = document.getElementById('step-btn');
const autoBtn = document.getElementById('auto-btn');

// UI Elements: Logs
const logTable = document.getElementById('command-log').getElementsByTagName('tbody')[0];
const brainConsole = document.getElementById('brain-console');

let gameState = null;
let autoPlayActive = false;
let isCallingAI = false;
let isMuted = false;
let allModels = [];
let selectedModelId = localStorage.getItem('selected_model') || '';
let movementHistory = [];

// Audio Context for the "beep"
let audioCtx = null;
function playNotificationSound() {
    if (isMuted) return;
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    
    const oscillator = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();

    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(880, audioCtx.currentTime); // A5 note
    gainNode.gain.setValueAtTime(0.1, audioCtx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.1);

    oscillator.connect(gainNode);
    gainNode.connect(audioCtx.destination);

    oscillator.start();
    oscillator.stop(audioCtx.currentTime + 0.1);
}

// --- MCP WebSocket Bridge (Browser Client) ---
let mcpSocket = null;
function connectMCP() {
    if (mcpSocket) return;
    
    mcpSocket = new WebSocket('ws://localhost:8080');
    
    mcpSocket.onopen = () => {
        console.log("[Tester] Conectado ao MCP Bridge!");
        document.body.classList.add('mcp-active');
        updateConsole("Conectado ao MCP Bridge.", "success");
    };
    
    mcpSocket.onmessage = (event) => {
        try {
            const cmd = JSON.parse(event.data);
            if (cmd.type === 'move') {
                updateConsole(`Comando MCP recebido: ${cmd.direction}`, "info");
                // Forward to Game via BroadcastChannel
                try { channel.postMessage(cmd); } catch (e) {}
                // Backup via LocalStorage
                localStorage.setItem('game_command_sync', JSON.stringify(cmd));
            }
        } catch (e) {
            console.error("[Tester] Erro MCP:", e);
        }
    };
    
    mcpSocket.onclose = () => {
        console.log("[Tester] MCP Bridge desconectado. Tentando reconectar...");
        mcpSocket = null;
        document.body.classList.remove('mcp-active');
        setTimeout(connectMCP, 3000);
    };
}
connectMCP();

// --- INITIALIZATION ---
const lastModel = localStorage.getItem('selected_model');
if (lastModel) {
    selectedModelId = lastModel;
    modelSearch.value = selectedModelId;
    updateConsole(`Modelo restaurado: ${selectedModelId}`);
}

fetchModels();
updateConsole("Sistema 'Cliente Testador iA' carregado. Aguardando conexão com o jogo...");

// --- UI HELPERS ---

function updateConsole(msg, type = 'info') {
    const time = new Date().toLocaleTimeString();
    const entry = document.createElement('div');
    entry.className = `console-entry ${type} recent-command`;
    entry.innerHTML = `<span class="time">[${time}]</span> ${msg}`;
    brainConsole.prepend(entry);
    
    // Highlight effect (fades out)
    setTimeout(() => entry.classList.remove('recent-command'), 2000);

    // Limit entries
    if (brainConsole.children.length > 50) brainConsole.lastChild.remove();
}

function addLogEntry(action, detail) {
    const row = document.createElement('tr');
    const time = new Date().toLocaleTimeString();
    
    row.innerHTML = `
        <td>${time}</td>
        <td><strong>${action}</strong></td>
        <td><code>${detail}</code></td>
    `;
    
    // Highlight effect
    row.classList.add('recent-command');
    logTable.prepend(row);
    
    // Play sound for AI moves
    if (action === "Move AI") playNotificationSound();

    // Remove highlight after a delay
    setTimeout(() => row.classList.remove('recent-command'), 2000);

    // Limit log size
    if (logTable.children.length > 50) logTable.lastChild.remove();
}

// --- MODEL FETCHING & SEARCH ---

async function fetchModels() {
    updateConsole("Buscando lista de modelos do OpenRouter...");
    try {
        const response = await fetch("https://openrouter.ai/api/v1/models");
        const data = await response.json();
        allModels = data.data;
        updateConsole(`${allModels.length} modelos disponíveis.`);
    } catch (error) {
        updateConsole("Erro ao carregar modelos.", "error");
    }
}

modelSearch.addEventListener('input', () => {
    const query = modelSearch.value.toLowerCase();
    const filtered = allModels.filter(m => 
        (m.name && m.name.toLowerCase().includes(query)) || 
        (m.id && m.id.toLowerCase().includes(query))
    ).slice(0, 100);
    renderModelList(filtered);
});

modelSearch.addEventListener('focus', () => {
    if (allModels.length === 0) fetchModels();
    else renderModelList(allModels.filter(m => m.id.toLowerCase().includes(modelSearch.value.toLowerCase())).slice(0, 50));
});

document.addEventListener('click', (e) => {
    if (!e.target.closest('.searchable-dropdown')) modelList.classList.remove('visible');
});

function renderModelList(models) {
    modelList.innerHTML = '';
    if (models.length === 0) {
        modelList.classList.remove('visible');
        return;
    }
    models.forEach(model => {
        const li = document.createElement('li');
        li.className = 'dropdown-item';
        
        // Formatar preço de entrada/saída (preço por 1M de tokens)
        const priceIn = (parseFloat(model.pricing?.prompt || 0) * 1000000).toFixed(2);
        const priceOut = (parseFloat(model.pricing?.completion || 0) * 1000000).toFixed(2);

        li.innerHTML = `
            <strong>${model.name || 'Sem Nome'} <span class="price-tag">i:$${priceIn}/M | o:$${priceOut}/M</span></strong>
            <span class="model-id">${model.id}</span>
        `;
        li.addEventListener('click', (e) => {
            e.stopPropagation();
            modelSearch.value = model.id;
            selectedModelId = model.id;
            localStorage.setItem('selected_model', selectedModelId);
            modelList.classList.remove('visible');
            updateConsole(`Modelo selecionado: ${model.id}`);
            displayModelPricing(model);
        });
        modelList.appendChild(li);
    });
    modelList.classList.add('visible');
}

function displayModelPricing(model) {
    const infoDiv = document.getElementById('model-info');
    if (!model || !model.pricing) {
        infoDiv.classList.remove('visible');
        return;
    }

    const priceIn = (parseFloat(model.pricing.prompt) * 1000000).toFixed(4);
    const priceOut = (parseFloat(model.pricing.completion) * 1000000).toFixed(4);
    const context = model.context_length ? (model.context_length / 1024).toFixed(0) + 'k' : 'N/A';

    infoDiv.innerHTML = `<strong>Preço (1M tokens):</strong> i:$${priceIn} | o:$${priceOut} <br> <strong>Contexto:</strong> ${context}`;
    infoDiv.classList.add('visible');
}

// --- GAME COMMUNICATION & SYNC ---

// 1. BroadcastChannel (Modern/Fast)
channel.onmessage = (event) => {
    if (event.data.type === 'update') {
        processUpdate(event.data);
    }
};

// 2. LocalStorage Fallback (For file:// protocol)
window.addEventListener('storage', (e) => {
    if (e.key === 'game_state_sync' && e.newValue) {
        try {
            processUpdate(JSON.parse(e.newValue));
        } catch (err) {}
    }
});

let lastUpdateSeq = 0;
const levelSelect = document.getElementById('level-select');
const gotoLevelBtn = document.getElementById('goto-level-btn');

function processUpdate(data) {
    if (!data) return;
    console.log(`[Tester] Update #${data.seq} | Map: ${data.map?.length} chars | Image: ${data.image?.length || 0} chars`);
    
    // Use sequence for de-duplication
    if (data.seq && data.seq <= lastUpdateSeq) return;
    if (data.seq) lastUpdateSeq = data.seq;

    // Reset history on level change
    if (gameState && data.levelIdx !== gameState.levelIdx) {
        movementHistory = [];
        updateConsole(`Mudança de fase detectada: Memória limpa.`, "info");
    }

    gameState = data;
    
    // Populate Level Select if names are provided and it's empty
    if (gameState.levelNames && levelSelect && levelSelect.children.length === 0) {
        gameState.levelNames.forEach((name, idx) => {
            const opt = document.createElement('option');
            opt.value = idx;
            opt.textContent = name;
            levelSelect.appendChild(opt);
        });
    }

    // Update Observation Immediately
    if (mapText && gameState.map) {
        mapText.textContent = gameState.map;
    }

    // Capture Real
    if (mapImage) {
        if (gameState.image) {
            mapImage.src = gameState.image;
        } else {
            mapImage.src = ""; // Clear if no image
            mapImage.alt = "Screenshot indisponível (Segurança do Navegador)";
        }
    }

    // Stats
    if (statLevel) statLevel.innerText = gameState.levelIdx || '-';
    if (statScore) statScore.innerText = gameState.score || '0';

    // Log coordinates for debug
    if (gameState.player) {
        const p = gameState.player;
    }

    connStatus.innerText = "Jogo Conectado";
    connStatus.className = "connected";

    if (gameState.win) {
        updateConsole("Objetivo final alcançado! Simulação concluída.", "success");
        stopAutoPlay();
    }
}

function refreshObservation() {
    if (gameState && gameState.map && mapText) {
        mapText.textContent = gameState.map;
    }
}

function sendCommand(cmd) {
    // Add player name and unique sequence for de-duplication
    cmd.playerName = selectedModelId || "AI Indefinida";
    cmd.timestamp = Date.now();
    cmd.seq = Date.now(); // Use timestamp as sequence for absolute uniqueness

    // Attempt via BroadcastChannel
    try { channel.postMessage(cmd); } catch (e) {}

    // Backup via LocalStorage
    localStorage.setItem('game_command_sync', JSON.stringify(cmd));
}

function stopAutoPlay() {
    autoPlayActive = false;
    autoBtn.innerText = "🤖 Auto-Play";
    autoBtn.classList.remove('active');
}

// --- AI LOGIC (OPENROUTER) ---

async function callOpenRouter() {
    if (!gameState || isCallingAI) return;
    
    // Force UI refresh with the state we are about to use
    refreshObservation();
    
    const apiKey = apiKeyInput.value;
    if (!apiKey) {
        updateConsole("ERRO: Chave de API ausente.", "error");
        alert("Por favor, insira sua API Key do OpenRouter!");
        return;
    }

    isCallingAI = true;
    updateConsole(`Solicitando movimento ao modelo ${selectedModelId}...`);

    const model = selectedModelId;
    const mode = visionMode.value;

    let systemPrompt = "";
    const userMessage = { role: "user", content: [] };
    const historyText = movementHistory.length > 0 
        ? `\nSeus movimentos anteriores NESTA FASE (do mais antigo ao mais recente): ${movementHistory.map(m => {
            const trans = { up: 'cima', down: 'baixo', left: 'esquerda', right: 'direita' };
            return trans[m] || m;
        }).join(', ')}.`
        : "\nEsta é sua primeira jogada nesta fase.";

    if (mode === 'text') {
        systemPrompt = `Você é o player 'P' em um labirinto ASCII. Seu objetivo é chegar no prêmio 'R' evitando as paredes '#'. ${historyText}
Responda APENAS com uma das direções: up, down, left, right.`;
        userMessage.content.push({ type: "text", text: `Mapa atual:\n${gameState.map}` });
    } else {
        systemPrompt = `Você é um agente controlando o player em um labirinto visual. Seu objetivo é chegar no prêmio. ${historyText}
A imagem enviada é uma visão esquemática do jogo onde:
- QUADRADO AZUL (Blue): Você (Player).
- QUADRADO VERMELHO (Red): O prêmio (Reward).
- QUADRADOS PRETOS (Black): Parede/Obstáculo.
- FUNDO BRANCO (White): Caminho livre.

Analise a posição dos elementos e responda APENAS com uma das direções: up, down, left, right.`;
        userMessage.content.push({ type: "text", text: "Analise a imagem e decida seu próximo passo." });
        console.log("[Tester] Enviando imagem Vision. Header:", gameState.image?.substring(0, 30));
        userMessage.content.push({ type: "image_url", image_url: { url: gameState.image, detail: "low" } });
    }

    // Display prompt in UI
    const promptDisplay = document.getElementById('live-prompt');
    if (promptDisplay) promptDisplay.textContent = systemPrompt;

    try {
        const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${apiKey}`,
                "Content-Type": "application/json",
                "X-Title": "Cliente Testador iA"
            },
            body: JSON.stringify({
                model: model,
                messages: [{ role: "system", content: systemPrompt }, userMessage],
                max_tokens: 100
            })
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            const errorMsg = errorData.error?.message || response.statusText;
            throw new Error(`API Error ${response.status}: ${errorMsg}`);
        }

        const data = await response.json();
        const choice = data.choices?.[0];
        const rawContent = choice?.message?.content;
        
        if (!rawContent) {
            console.error("[Tester] AI Refusal or Empty Response:", data);
            const reason = choice?.finish_reason;
            const refusal = choice?.message?.refusal;
            
            if (reason === "length") {
                throw new Error("A resposta da IA foi cortada por ser muito longa (mais de 100 tokens).");
            }
            throw new Error(refusal || reason || "A IA não retornou conteúdo. Verifique o console do navegador.");
        }

        const move = rawContent.trim().toLowerCase();
        
        const validMoves = ['up', 'down', 'left', 'right'];
        const cleanMove = validMoves.find(m => move.includes(m));

        if (cleanMove) {
            updateConsole(`Movimento decidido: ${cleanMove}`, "success");
            addLogEntry("Move AI", cleanMove);
            
            // Record in history (last 15 moves)
            movementHistory.push(cleanMove);
            if (movementHistory.length > 15) movementHistory.shift();
            
            sendCommand({ type: 'move', direction: cleanMove });
        } else {
            updateConsole(`Resposta inválida: "${move}"`, "error");
            addLogEntry("Erro AI", move);
        }

    } catch (error) {
        updateConsole(`Falha: ${error.message}`, "error");
    } finally {
        isCallingAI = false;
    }
}

// --- UI EVENTS ---

stepBtn.addEventListener('click', callOpenRouter);

autoBtn.addEventListener('click', () => {
    autoPlayActive = !autoPlayActive;
    autoBtn.innerText = `🤖 ${autoPlayActive ? 'Parar' : 'Auto-Play'}`;
    autoBtn.classList.toggle('active', autoPlayActive);
    
    if (autoPlayActive) {
        updateConsole("Modo Auto-Play ativado.");
        autoLoop();
    } else {
        updateConsole("Modo Auto-Play desativado.");
    }
});

gotoLevelBtn.addEventListener('click', () => {
    const idx = parseInt(levelSelect.value);
    const levelName = levelSelect.options[levelSelect.selectedIndex].text;
    movementHistory = []; // Clear memory
    updateConsole(`Pulando para a fase: ${levelName}. Memória limpa.`);
    addLogEntry("Level Jump", levelName);
    sendCommand({ type: 'goto_level', levelIdx: idx });
});

const resetGameBtn = document.getElementById('reset-game-btn');
resetGameBtn.addEventListener('click', () => {
    movementHistory = []; // Clear memory
    updateConsole("Reiniciando jogo completo. Memória limpa.");
    addLogEntry("Reset Total", "Jogo Reiniciado");
    sendCommand({ type: 'start' });
});

async function autoLoop() {
    if (!autoPlayActive) return;
    
    if (gameState && gameState.active) {
        await callOpenRouter();
    } else if (gameState && !gameState.active) {
        updateConsole("Iniciando nova partida...");
        sendCommand({ type: 'start' });
    }

    if (autoPlayActive) {
        setTimeout(autoLoop, 2000);
    }
}

// Handshake & Rehydration
(function initializeHandshake() {
    // 1. Try to rehydrate from LocalStorage (F5 Persistence)
    const savedState = localStorage.getItem('game_state_sync');
    if (savedState) {
        try {
            console.log("[Tester] Rehidratando estado do LocalStorage...");
            processUpdate(JSON.parse(savedState));
        } catch (e) {
            console.warn("Falha ao reidratar estado:", e);
        }
    }

    // 2. Request fresh update from Game
    sendCommand({ type: 'request_update' });
})();

// Mute Toggle
const muteBtn = document.getElementById('mute-btn');
muteBtn.addEventListener('click', () => {
    isMuted = !isMuted;
    muteBtn.innerText = isMuted ? '🔇' : '🔊';
    muteBtn.classList.toggle('muted', isMuted);
    updateConsole(`Som ${isMuted ? 'desativado' : 'ativado'}.`);
});
