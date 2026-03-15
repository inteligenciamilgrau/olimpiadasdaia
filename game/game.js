// MAP_DATA is now loaded from maps.js


const blockSize = 40;
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const scoreEl = document.getElementById('score');
const levelEl = document.getElementById('level-name');
const timerEl = document.getElementById('timer');
const recordsListEl = document.getElementById('records-list');
const overlay = document.getElementById('overlay');
const startBtn = document.getElementById('start-btn');
const overlayTitle = document.getElementById('overlay-title');
const overlayMsg = document.getElementById('overlay-msg');
const levelJumpSelect = document.getElementById('level-jump-select');

// Assets
const imgWall = new Image(); imgWall.src = 'assets/muralha.png';
const imgPlayer = new Image(); imgPlayer.src = 'assets/player.png';
const imgReward = new Image(); imgReward.src = 'assets/recompensa.png';
const imgTree = new Image(); imgTree.src = 'assets/arvore.png';

// --- Game API Communication ---
const channel = new BroadcastChannel('game_api');
let lastProcessedCmdSeq = 0;
let stateBroadcastSeq = Date.now();

// Handle remote commands
const processCommand = (data) => {
    if (!data || !window.game) return;
    
    const { type, direction, playerName, levelIdx } = data;

    // Use sequence for de-duplication for moves
    if (type === 'move' && data.seq && data.seq <= lastProcessedCmdSeq) {
        return; // Silently ignore Fallback duplicates
    }
    if (data.seq) lastProcessedCmdSeq = data.seq;

    console.log(`[Game] Comando Recebido: ${type} ${direction || ''} (${playerName || '?'})`);
    
    // If it came from MCP (WebSocket), let's notify the Tester Dashboard too
    if (data.source === 'ws' || playerName === "Agente MCP") {
        channel.postMessage({ type: 'remote_command', cmd: data });
    }

    if (type === 'move') {
        if (playerName) window.game.currentPlayerName = playerName;
        // Auto-start apenas se o jogo estiver inativo e não houver pontuação (tela inicial)
        if (!window.game.active && window.game.score === 0) {
            processCommand({ type: 'start' });
        }
        window.game.move(direction);
    } else if (type === 'start') {
        window.game.active = true;
        console.log("[Game] Iniciando partida via comando remoto...");
        const overlayEl = document.getElementById('overlay');
        if (overlayEl) {
            overlayEl.style.display = ''; // Limpa qualquer display: none residual
            overlayEl.classList.remove('visible');
        }
        window.game.start();
    } else if (type === 'reset_level') {
        window.game.loadLevel(window.game.levelIdx);
    } else if (type === 'goto_level') {
        window.game.active = true;
        overlay.classList.remove('visible');
        window.game.loadLevel(levelIdx);
    } else if (type === 'clear_records') {
        localStorage.removeItem('game_records');
        window.game.records = {};
        window.game.updateRecordsUI();
        console.log("[Game] Recordes limpos com sucesso!");
    } else if (type === 'request_update') {
        window.game.broadcast();
    }
};

channel.onmessage = (event) => processCommand(event.data);

// --- MCP WebSocket Bridge (Browser Client) ---
let mcpSocket = null;
function connectMCP() {
    if (mcpSocket) return;
    
    mcpSocket = new WebSocket('ws://localhost:8080');
    
    mcpSocket.onopen = () => {
        console.log("[Game] Conectado ao MCP Bridge!");
        document.body.classList.add('mcp-active');
        // Texto temporário no timer para feedback visual
        const oldTimer = timerEl.innerText;
        timerEl.innerText = "MCP OK!";
        timerEl.style.color = "#00f2ff";
        setTimeout(() => { timerEl.innerText = oldTimer; timerEl.style.color = ""; }, 2000);
    };
    
    mcpSocket.onmessage = (event) => {
        try {
            const cmd = JSON.parse(event.data);
            if (cmd.type === 'request_update') {
                window.game.broadcast();
            } else {
                processCommand(cmd);
            }
        } catch (e) {
            console.error("[Game] Erro MCP:", e);
        }
    };
    
    mcpSocket.onclose = () => {
        console.log("[Game] MCP Bridge desconectado. Tentando reconectar...");
        mcpSocket = null;
        document.body.classList.remove('mcp-active');
        setTimeout(connectMCP, 3000);
    };
}
connectMCP();

// LocalStorage Fallback for commands
window.addEventListener('storage', (e) => {
    if (e.key === 'game_command_sync' && e.newValue) {
        try {
            processCommand(JSON.parse(e.newValue));
        } catch (err) { }
    }
});

class Game {
    constructor() {
        this.levelIdx = 0;
        this.score = 0;
        this.levelScore = 0;
        this.active = false;
        this.playerPos = { x: 1, y: 1 };
        this.rewardPos = { x: 5, y: 5 };
        this.grid = [];
        this.currentPlayerName = "Jogador Local";

        // Timer
        this.startTime = 0;
        this.currentTime = 0;
        this.timerInterval = null;

        this.records = JSON.parse(localStorage.getItem('game_records')) || {};

        this.initEventListeners();
        this.render();
        this.updateRecordsUI();
        this.populateLevelSelector();

        // Load level 0 but keep inactive so it shows in the tester
        this.loadLevel(0);
    }

    broadcast() {
        if (!this.grid || this.grid.length === 0 || !canvas) return;
        stateBroadcastSeq++;
        try {
            let screenshot = null;
            try {
                // Try to take screenshot, but dont let it kill the sync
                screenshot = canvas.toDataURL('image/jpeg', 0.8);
            } catch (secErr) {
                // Use Schematic Vision if main canvas is tainted
                screenshot = this.getSchematicScreenshot();
            }

            const msg = {
                type: 'update',
                seq: stateBroadcastSeq,
                map: this.getMapText(),
                image: screenshot,
                score: this.score,
                player: this.playerPos,
                reward: this.rewardPos,
                levelIdx: this.levelIdx + 1,
                levelName: MAP_DATA[this.levelIdx]?.name || 'Final',
                levelNames: MAP_DATA.map(m => m.name), // Added for dropdown
                active: this.active,
                win: !this.active && this.score > 0,
                timestamp: Date.now()
            };

            channel.postMessage(msg);
            localStorage.setItem('game_state_sync', JSON.stringify(msg));

            // Send to MCP Bridge
            if (mcpSocket && mcpSocket.readyState === WebSocket.OPEN) {
                mcpSocket.send(JSON.stringify(msg));
            }
        } catch (e) {
            console.error("ERRO CRITICAL NO BROADCAST:", e);
        }
    }

    initEventListeners() {
        window.addEventListener('keydown', (e) => {
            if (!this.active) return;
            this.currentPlayerName = "Jogador Local";
            if (e.key === 'ArrowUp') this.move('up');
            if (e.key === 'ArrowDown') this.move('down');
            if (e.key === 'ArrowLeft') this.move('left');
            if (e.key === 'ArrowRight') this.move('right');
        });

        startBtn.addEventListener('click', () => this.start());

        levelJumpSelect.addEventListener('change', (e) => {
            const idx = parseInt(e.target.value);
            if (!isNaN(idx)) {
                processCommand({ type: 'goto_level', levelIdx: idx });
                // Reset select for next time
                e.target.value = "";
            }
        });
    }

    populateLevelSelector() {
        if (!levelJumpSelect) return;
        MAP_DATA.forEach((map, idx) => {
            const opt = document.createElement('option');
            opt.value = idx;
            opt.textContent = `${idx + 1}. ${map.name}`;
            levelJumpSelect.appendChild(opt);
        });
    }

    start() {
        this.score = 0;
        scoreEl.innerText = '0';
        this.active = true;
        overlay.classList.remove('visible');
        this.loadLevel(0); // Reset to first level on start
    }

    loadLevel(idx) {
        this.levelIdx = idx % MAP_DATA.length;
        const map = MAP_DATA[this.levelIdx];
        this.grid = map.layout.map(row => row.split(''));

        canvas.width = this.grid[0].length * blockSize;
        canvas.height = this.grid.length * blockSize;

        levelEl.innerText = map.name;
        this.levelScore = 0;

        // Find P and R
        for (let y = 0; y < this.grid.length; y++) {
            for (let x = 0; x < this.grid[y].length; x++) {
                if (this.grid[y][x] === 'P') {
                    this.playerPos = { x, y };
                    this.grid[y][x] = 'O';
                } else if (this.grid[y][x] === 'R') {
                    this.rewardPos = { x, y };
                    this.grid[y][x] = 'O';
                }
            }
        }

        // Start Timer
        this.startTime = Date.now();
        if (this.timerInterval) clearInterval(this.timerInterval);
        this.timerInterval = setInterval(() => {
            if (!this.active) return;
            this.currentTime = (Date.now() - this.startTime) / 1000;
            timerEl.innerText = this.currentTime.toFixed(1) + 's';
        }, 100);

        // Defer broadcast slightly to ensure all state is settled
        setTimeout(() => this.broadcast(), 50);
    }

    move(dir) {
        if (!this.active) return;
        let dx = 0, dy = 0;
        if (dir === 'up') dy = -1;
        if (dir === 'down') dy = 1;
        if (dir === 'left') dx = -1;
        if (dir === 'right') dx = 1;

        const nx = this.playerPos.x + dx;
        const ny = this.playerPos.y + dy;

        if (ny >= 0 && ny < this.grid.length && nx >= 0 && nx < this.grid[0].length) {
            if (this.grid[ny][nx] === 'O') {
                this.playerPos = { x: nx, y: ny };
                this.checkCollision();
                this.broadcast();
            }
        }
    }

    checkCollision() {
        if (this.playerPos.x === this.rewardPos.x && this.playerPos.y === this.rewardPos.y) {
            this.score++;
            this.levelScore++;
            scoreEl.innerText = this.score;

            if (this.levelScore >= 1) {
                this.recordTime();
                if (this.levelIdx < MAP_DATA.length - 1) {
                    this.loadLevel(this.levelIdx + 1);
                } else {
                    this.win();
                }
            } else {
                this.spawnReward();
            }
        }
    }

    recordTime() {
        if (this.currentPlayerName === "Jogador Local") return;
        
        const timeTaken = parseFloat(((Date.now() - this.startTime) / 1000).toFixed(2));
        const levelName = MAP_DATA[this.levelIdx].name;

        if (!this.records[levelName]) this.records[levelName] = [];

        this.records[levelName].push({
            name: this.currentPlayerName,
            time: timeTaken,
            date: new Date().toLocaleDateString()
        });

        // Sort by time and keep top 3
        this.records[levelName].sort((a, b) => a.time - b.time);
        this.records[levelName] = this.records[levelName].slice(0, 3);

        localStorage.setItem('game_records', JSON.stringify(this.records));
        this.updateRecordsUI();
    }

    updateRecordsUI() {
        recordsListEl.innerHTML = '';
        MAP_DATA.forEach(level => {
            const group = document.createElement('div');
            group.className = 'level-record-group';
            group.innerHTML = `<h4>${level.name}</h4>`;

            const levelRecords = this.records[level.name] || [];
            if (levelRecords.length === 0) {
                group.innerHTML += `<div class="record-entry"><span class="name">Sem recordes...</span></div>`;
            } else {
                levelRecords.forEach((rec, i) => {
                    const entry = document.createElement('div');
                    entry.className = 'record-entry';
                    entry.innerHTML = `
                        <span class="rank">${i + 1}º</span>
                        <span class="name">${rec.name}</span>
                        <span class="time">${rec.time}s</span>
                    `;
                    group.appendChild(entry);
                });
            }
            recordsListEl.appendChild(group);
        });
    }

    spawnReward() {
        while (true) {
            const rx = Math.floor(Math.random() * this.grid[0].length);
            const ry = Math.floor(Math.random() * this.grid.length);
            if (this.grid[ry][rx] === 'O' && (rx !== this.playerPos.x || ry !== this.playerPos.y)) {
                this.rewardPos = { x: rx, y: ry };
                break;
            }
        }
    }

    getMapText() {
        if (!this.grid.length) return "";
        const tempGrid = this.grid.map(row => [...row]);
        tempGrid[this.playerPos.y][this.playerPos.x] = 'P';
        tempGrid[this.rewardPos.y][this.rewardPos.x] = 'R';
        return tempGrid.map(row => row.join('')).join('\n');
    }

    getSchematicScreenshot() {
        if (!this.grid || !this.grid.length) return null;
        const offscreen = document.createElement('canvas');
        const octx = offscreen.getContext('2d');
        const bSize = 20; 
        offscreen.width = this.grid[0].length * bSize;
        offscreen.height = this.grid.length * bSize;

             // 1. Draw Background (White Floor)
    octx.fillStyle = '#FFFFFF';
    octx.fillRect(0, 0, offscreen.width, offscreen.height);

    const map = this.grid; // Use this.grid as the map data
    const cellSize = bSize; // Use bSize as cellSize

    // 2. Draw Walls (Black) and Trees (Brown/Sienna)
    for (let y = 0; y < map.length; y++) {
        for (let x = 0; x < map[y].length; x++) {
            if (map[y][x] === '#') {
                octx.fillStyle = '#000000';
                octx.fillRect(x * cellSize, y * cellSize, cellSize, cellSize);
            } else if (map[y][x] === 'T') {
                octx.fillStyle = '#A0522D'; // Sienna/Brown for trees
                octx.fillRect(x * cellSize, y * cellSize, cellSize, cellSize);
            }
        }
    }

    // 3. Draw Reward (Red)
    octx.fillStyle = '#FF0000';
    octx.fillRect(this.rewardPos.x * cellSize, this.rewardPos.y * cellSize, cellSize, cellSize);

    // 4. Draw Player (Blue)
    octx.fillStyle = '#0000FF';
    octx.fillRect(this.playerPos.x * cellSize, this.playerPos.y * cellSize, cellSize, cellSize);
        octx.fill();

        return offscreen.toDataURL('image/png');
    }

    win() {
        this.active = false;
        clearInterval(this.timerInterval);
        overlayTitle.innerText = "CAMPEÃO!";
        overlayMsg.innerText = `Você concluiu todas as fases com ${this.score} pontos!`;
        startBtn.innerText = "JOGAR NOVAMENTE";
        overlay.classList.add('visible');
        this.broadcast();
    }

    render() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        if (!this.grid.length) {
            requestAnimationFrame(() => this.render());
            return;
        }
        for (let y = 0; y < this.grid.length; y++) {
            for (let x = 0; x < this.grid[y].length; x++) {
                if (this.grid[y][x] === '#') {
                    ctx.drawImage(imgWall, x * blockSize, y * blockSize, blockSize, blockSize);
                } else if (this.grid[y][x] === 'T') {
                    ctx.drawImage(imgTree, x * blockSize, y * blockSize, blockSize, blockSize);
                } else {
                    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
                    ctx.strokeRect(x * blockSize, y * blockSize, blockSize, blockSize);
                }
            }
        }
        ctx.drawImage(imgReward, this.rewardPos.x * blockSize, this.rewardPos.y * blockSize, blockSize, blockSize);
        ctx.drawImage(imgPlayer, this.playerPos.x * blockSize, this.playerPos.y * blockSize, blockSize, blockSize);
        requestAnimationFrame(() => this.render());
    }
}

// Start game instance
window.game = new Game();
