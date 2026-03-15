const blockSize = 40;
const canvas = document.getElementById('editorCanvas');
const ctx = canvas.getContext('2d');
const mapSelect = document.getElementById('map-select');
const mapNameInput = document.getElementById('map-name');
const gridWidthInput = document.getElementById('grid-width');
const gridHeightInput = document.getElementById('grid-height');
const btnResize = document.getElementById('btn-resize');
const btnExport = document.getElementById('btn-export');
const btnSave = document.getElementById('btn-save');
const btnCopy = document.getElementById('btn-copy');
const btnCloseModal = document.getElementById('btn-close-modal');
const exportModal = document.getElementById('export-modal');
const codeOutput = document.getElementById('code-output');

// Assets
const assets = {
    '#': new Image(),
    'T': new Image(),
    'P': new Image(),
    'R': new Image()
};
assets['#'].src = '../game/assets/muralha.png';
assets['T'].src = '../game/assets/arvore.png';
assets['P'].src = '../game/assets/player.png';
assets['R'].src = '../game/assets/recompensa.png';

let currentGrid = [];
let currentTool = '#';
let isDragging = false;
let isDraggingMarquee = false;
let selection = {
    active: false,
    moving: false,
    selectedCoords: new Set(), // Store "x,y" strings
    tiles: [], // Data of selected tiles for moving
    offsetX: 0, offsetY: 0, // For moving start point
    x1: 0, y1: 0, x2: 0, y2: 0 // For marquee box
};

const marquee = document.getElementById('selection-marquee');

// Initialize
function init() {
    // Populate map selector
    if (typeof MAP_DATA !== 'undefined') {
        MAP_DATA.forEach((map, idx) => {
            const opt = document.createElement('option');
            opt.value = idx;
            opt.textContent = map.name;
            mapSelect.appendChild(opt);
        });
    }

    // Default 11x11 grid
    createNewMap(11, 11);

    // Event Listeners
    mapSelect.addEventListener('change', (e) => {
        const idx = parseInt(e.target.value);
        if (idx === -1) {
            createNewMap(parseInt(gridWidthInput.value), parseInt(gridHeightInput.value));
        } else {
            loadMap(MAP_DATA[idx]);
        }
    });

    btnResize.addEventListener('click', () => {
        const w = parseInt(gridWidthInput.value);
        const h = parseInt(gridHeightInput.value);
        resizeGrid(w, h);
    });

    // Tool switching
    document.querySelectorAll('.tool').forEach(tool => {
        tool.addEventListener('click', () => {
            document.querySelector('.tool.active').classList.remove('active');
            tool.classList.add('active');
            currentTool = tool.dataset.type === 'D' ? 'O' : tool.dataset.type;
            
            // Clear selection if switching from S
            if (currentTool !== 'S') {
                clearSelection();
            }
        });
    });

    // Canvas Mouse Events
    canvas.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    // Prevent context menu to allow better CTRL usage
    canvas.addEventListener('contextmenu', e => e.preventDefault());

    // Modal Events
    btnExport.addEventListener('click', showExport);
    btnCloseModal.addEventListener('click', () => exportModal.style.display = 'none');
    btnCopy.addEventListener('click', () => {
        navigator.clipboard.writeText(codeOutput.textContent);
        btnCopy.textContent = 'Copiado!';
        setTimeout(() => btnCopy.textContent = 'Copiar', 2000);
    });

    btnSave.addEventListener('click', () => {
        showFullExport();
    });

    render();
}

function showFullExport() {
    const currentIdx = parseInt(mapSelect.value);
    const newMap = generateFullMapData();
    
    let updatedData = [...MAP_DATA];
    if (currentIdx === -1) {
        updatedData.push(newMap);
    } else {
        updatedData[currentIdx] = newMap;
    }

    const code = `const MAP_DATA = ${JSON.stringify(updatedData, null, 4)};\n\nif (typeof module !== 'undefined') {\n    module.exports = MAP_DATA;\n}`;
    codeOutput.textContent = code;
    exportModal.style.display = 'flex';
}

function clearSelection() {
    selection.active = false;
    selection.moving = false;
    selection.selectedCoords.clear();
    selection.tiles = [];
    marquee.style.display = 'none';
    render();
}

function handleMouseDown(e) {
    const rect = canvas.getBoundingClientRect();
    const gx = Math.floor((e.clientX - rect.left) / blockSize);
    const gy = Math.floor((e.clientY - rect.top) / blockSize);
    const key = `${gx},${gy}`;
    
    if (currentTool === 'S') {
        if (e.ctrlKey) {
            // Ctrl + Click: Toggle individual tile
            if (selection.selectedCoords.has(key)) {
                selection.selectedCoords.delete(key);
            } else {
                selection.selectedCoords.add(key);
            }
            selection.active = selection.selectedCoords.size > 0;
            updateMarquee();
            render();
            return;
        }

        if (selection.active && selection.selectedCoords.has(key)) {
            // Click inside selection: Start moving
            selection.moving = true;
            selection.offsetX = gx;
            selection.offsetY = gy;
            selection.tiles = [];
            
            selection.selectedCoords.forEach(coord => {
                const [cx, cy] = coord.split(',').map(Number);
                if (currentGrid[cy][cx] !== 'O') {
                    selection.tiles.push({ x: cx, y: cy, type: currentGrid[cy][cx] });
                    currentGrid[cy][cx] = 'O'; // Temporary remove
                }
            });
        } else {
            // Click outside: Reset selection and start marquee
            selection.selectedCoords.clear();
            selection.active = false; // Will set to true on mouseup if area > 0
            isDraggingMarquee = true;
            selection.x1 = selection.x2 = gx;
            selection.y1 = selection.y2 = gy;
            updateMarquee();
            render();
        }
    } else {
        isDragging = true;
        paint(e);
    }
}

function handleMouseMove(e) {
    const rect = canvas.getBoundingClientRect();
    const gx = Math.floor((e.clientX - rect.left) / blockSize);
    const gy = Math.floor((e.clientY - rect.top) / blockSize);

    if (currentTool === 'S') {
        if (selection.moving) {
            const dx = gx - selection.offsetX;
            const dy = gy - selection.offsetY;
            if (dx === 0 && dy === 0) return;
            
            selection.offsetX = gx;
            selection.offsetY = gy;
            
            const newCoords = new Set();
            selection.tiles.forEach(tile => {
                tile.x += dx;
                tile.y += dy;
                newCoords.add(`${tile.x},${tile.y}`);
            });
            selection.selectedCoords = newCoords;
            render();
        } else if (isDraggingMarquee) {
            selection.x2 = gx;
            selection.y2 = gy;
            updateMarquee();
        }
    } else if (isDragging) {
        paint(e);
    }
}

function handleMouseUp() {
    if (currentTool === 'S') {
        if (isDraggingMarquee) {
            const minX = Math.min(selection.x1, selection.x2);
            const maxX = Math.max(selection.x1, selection.x2);
            const minY = Math.min(selection.y1, selection.y2);
            const maxY = Math.max(selection.y1, selection.y2);
            
            for (let y = minY; y <= maxY; y++) {
                for (let x = minX; x <= maxX; x++) {
                    if (x >= 0 && x < currentGrid[0].length && y >= 0 && y < currentGrid.length) {
                        selection.selectedCoords.add(`${x},${y}`);
                    }
                }
            }
            selection.active = selection.selectedCoords.size > 0;
            isDraggingMarquee = false;
            marquee.style.display = 'none';
            render();
        }
        
        if (selection.moving) {
            selection.tiles.forEach(tile => {
                if (tile.y >= 0 && tile.y < currentGrid.length && tile.x >= 0 && tile.x < currentGrid[0].length) {
                    currentGrid[tile.y][tile.x] = tile.type;
                }
            });
            selection.moving = false;
            render();
        }
    }
    isDragging = false;
    isDraggingMarquee = false;
}

function updateMarquee() {
    if (!selection.active && !isDraggingMarquee) {
        marquee.style.display = 'none';
        return;
    }
    const x = Math.min(selection.x1, selection.x2) * blockSize;
    const y = Math.min(selection.y1, selection.y2) * blockSize;
    const w = (Math.abs(selection.x2 - selection.x1) + 1) * blockSize;
    const h = (Math.abs(selection.y2 - selection.y1) + 1) * blockSize;
    marquee.style.left = x + 'px'; marquee.style.top = y + 'px';
    marquee.style.width = w + 'px'; marquee.style.height = h + 'px';
    marquee.style.display = 'block';
}

function createNewMap(w, h) {
    currentGrid = Array(h).fill().map(() => Array(w).fill('O'));
    mapNameInput.value = "Novo Mapa";
    gridWidthInput.value = w;
    gridHeightInput.value = h;
    updateCanvasSize();
}

function loadMap(map) {
    mapNameInput.value = map.name;
    const layout = map.layout;
    const h = layout.length;
    const w = layout[0].length;
    gridWidthInput.value = w;
    gridHeightInput.value = h;
    
    currentGrid = layout.map(row => row.split(''));
    updateCanvasSize();
}

function resizeGrid(newW, newH) {
    const oldH = currentGrid.length;
    const oldW = currentGrid[0].length;
    
    let newGrid = Array(newH).fill().map(() => Array(newW).fill('O'));
    
    for (let y = 0; y < Math.min(oldH, newH); y++) {
        for (let x = 0; x < Math.min(oldW, newW); x++) {
            newGrid[y][x] = currentGrid[y][x];
        }
    }
    
    currentGrid = newGrid;
    updateCanvasSize();
}

function updateCanvasSize() {
    canvas.width = currentGrid[0].length * blockSize;
    canvas.height = currentGrid.length * blockSize;
    render();
}

function paint(e) {
    const rect = canvas.getBoundingClientRect();
    const x = Math.floor((e.clientX - rect.left) / blockSize);
    const y = Math.floor((e.clientY - rect.top) / blockSize);
    
    if (y >= 0 && y < currentGrid.length && x >= 0 && x < currentGrid[0].length) {
        // Handle singleton tools (Player, Reward)
        if (currentTool === 'P' || currentTool === 'R') {
            // Remove previous
            for (let ry = 0; ry < currentGrid.length; ry++) {
                for (let rx = 0; rx < currentGrid[0].length; rx++) {
                    if (currentGrid[ry][rx] === currentTool) currentGrid[ry][rx] = 'O';
                }
            }
        }
        currentGrid[y][x] = currentTool;
        render();
    }
}

function generateFullMapData() {
    const layout = currentGrid.map(row => row.join(''));
    const mapObj = {
        name: mapNameInput.value || "Sem Nome",
        layout: layout
    };
    
    // This would be the whole array if we wanted to replace everything
    // But usually we just want to ADD or UPDATE the current one.
    // For now, let's just create the object.
    return mapObj;
}

function showExport() {
    const layout = currentGrid.map(row => `            "${row.join('')}",`).join('\n');
    const code = `    {
        "name": "${mapNameInput.value}",
        "layout": [
${layout}
        ]
    }`;
    codeOutput.textContent = code;
    exportModal.style.display = 'flex';
}

function render() {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    // Grid Lines
    ctx.strokeStyle = '#1a1a1a';
    ctx.lineWidth = 1;
    for (let x = 0; x <= canvas.width; x += blockSize) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, canvas.height);
        ctx.stroke();
    }
    for (let y = 0; y <= canvas.height; y += blockSize) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(canvas.width, y);
        ctx.stroke();
    }

    for (let y = 0; y < currentGrid.length; y++) {
        for (let x = 0; x < currentGrid[0].length; x++) {
            const char = currentGrid[y][x];
            if (char !== 'O' && assets[char]) {
                ctx.drawImage(assets[char], x * blockSize, y * blockSize, blockSize, blockSize);
            }
            
            // Draw individual selection highlights
            if (selection.active && selection.selectedCoords.has(`${x},${y}`)) {
                ctx.strokeStyle = 'rgba(0, 242, 255, 0.8)';
                ctx.lineWidth = 2;
                ctx.strokeRect(x * blockSize + 2, y * blockSize + 2, blockSize - 4, blockSize - 4);
                ctx.fillStyle = 'rgba(0, 242, 255, 0.1)';
                ctx.fillRect(x * blockSize, y * blockSize, blockSize, blockSize);
            }
        }
    }

    // Render moving tiles
    if (selection.moving) {
        ctx.globalAlpha = 0.6;
        selection.tiles.forEach(tile => {
            const char = tile.type;
            if (assets[char]) {
                ctx.drawImage(assets[char], tile.x * blockSize, tile.y * blockSize, blockSize, blockSize);
            }
        });
        ctx.globalAlpha = 1.0;
    }
}

// Initial draw after images load
Object.values(assets).forEach(img => {
    img.onload = render;
});

init();
