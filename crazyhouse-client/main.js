import 'chessground/assets/chessground.base.css';
import 'chessground/assets/chessground.brown.css';
import 'chessground/assets/chessground.cburnett.css';

import { Chessground } from 'chessground';
import { Crazyhouse } from 'chessops/variant';
import { makeFen } from 'chessops/fen';
import { parseSquare } from 'chessops/util';
import { chessgroundDests } from 'chessops/compat';
import { makeSan } from 'chessops/san';
import { io } from "socket.io-client";
const themeSelector = document.getElementById('board-theme-selector');
const boardContainer = document.getElementById('board');


window.currentGameId = null; // Holds the dynamic room code
// Use your specific Render URL
// main.js - Update the socket init
const socket = io('https://eochis23-github-io.onrender.com', {
    transports: ['websocket'], // Force WebSocket and skip polling
    upgrade: false
});

// Connection Health Check
socket.on('connect', () => {
    console.log("✅ Connected to Render Backend: " + socket.id);
});

socket.on('connect_error', (err) => {
    console.error("❌ Connection failed. Is the Render server awake?", err);
});

// We'll use this for the room logic
// const gameId = "default-room";
// 1. Join Game when Authenticated
// Automatically search for match on login
window.updatePlayerProfile = function(userData) {
    if (!userData) return;
    if (userData.picture) document.getElementById('player-avatar').src = userData.picture;
    if (userData.name) document.getElementById('player-username').innerText = userData.name;

    socket.emit('find_match', { user: userData }); // Replaced join_game
};

// Queue Status UI
socket.on('waiting_for_match', () => {
    setGameActiveState(false);
    appendMessage("System", "Searching for an opponent...", true);
});

// Match Found
// Match Found
// Match Found
// main.js - Match Found & UI Record Update
socket.on('update_players', ({ gameId, white, black, fen, record }) => {
    window.currentGameId = gameId; 

    if (white && white.socketId === socket.id) {
        window.myColor = 'white';
        cg.set({ orientation: 'white' });
    } else if (black && black.socketId === socket.id) {
        window.myColor = 'black';
        cg.set({ orientation: 'black' });
    }

    if (white && white.socketId !== socket.id) window.updateOpponentProfile(white); 
    if (black && black.socketId !== socket.id) window.updateOpponentProfile(black);

    setGameActiveState(true);
    
    // Inject the Lifetime Record into Chat AND the UI Cards
    if (record) {
        const myWins = window.myColor === 'white' ? record.whiteWins : record.blackWins;
        const oppWins = window.myColor === 'white' ? record.blackWins : record.whiteWins;
        
        const myRecordStr = `${myWins}W - ${oppWins}L - ${record.draws}D`;
        const oppRecordStr = `${oppWins}W - ${myWins}L - ${record.draws}D`;

        // 1. Update Chat
        appendMessage("System", `Match found! Lifetime record vs opponent: ${myRecordStr}`, true);

        // 2. Update Your Profile Window
        const playerRecordEl = document.getElementById('player-record');
        if (playerRecordEl) playerRecordEl.innerText = myRecordStr;

        // 3. Update Opponent's Profile Window
        const oppRecordEl = document.getElementById('opponent-record');
        if (oppRecordEl) oppRecordEl.innerText = oppRecordStr;

    } else {
        appendMessage("System", "Match found! Game started.", true);
    }
    
    syncBoard();
});

// 1. Listen for moves from the opponent
socket.on('receive_move', ({ move, fen }) => {
    console.log("📦 Received move from opponent:", move);

    // 2. Update the internal chess engine (chessops)
    // 'move' comes from the server in a compatible format { from, to, role, promotion }
    if (pos.isLegal(move)) {
        const san = makeSan(pos, move);
        pos.play(move);
        
        // 3. Play the appropriate sound
        // If the FEN includes a capture or the move results in a capture
        const isCapture = fen.includes('~'); // Simple check or logic based on pos
        playSound(isCapture);

        // 4. Update the Move History UI
        appendToHistory(san);

        // 5. Refresh the Chessground UI
        syncBoard();
    } else {
        console.error("⚠️ Received illegal move from server. Syncing FEN instead.");
        // Fallback: if move logic fails, force the board to the server's FEN
        // This requires a parser for the FEN string to rebuild 'pos'
    }
});
// --- NEW: Audio Setup ---
const soundMove = new Audio('https://lichess1.org/assets/sound/standard/Move.ogg');
const soundCapture = new Audio('https://lichess1.org/assets/sound/standard/Capture.ogg');

function playSound(isCapture) {
    if (isCapture) {
        soundCapture.currentTime = 0;
        soundCapture.play().catch(e => console.log("Audio prevented by browser", e));
    } else {
        soundMove.currentTime = 0;
        soundMove.play().catch(e => console.log("Audio prevented by browser", e));
    }
}



// 1. Initialize Engine
let pos = Crazyhouse.default();

// 2. Initial Setup
const config = {
    fen: makeFen(pos.toSetup()),
    movable: {
        color: pos.turn,
        free: false,
        dests: chessgroundDests(pos)
    },
    animation: { enabled: true, duration: 200 },
    events: {
        move: handleMove,
        dropNewPiece: handleDrop
    }
};

const cg = Chessground(boardContainer, config);

// 3. Pocket UI Logic
function updatePockets() {
    const whitePocket = document.getElementById('white-pocket');
    const blackPocket = document.getElementById('black-pocket');

    [whitePocket, blackPocket].forEach(p => {
        const labels = p.querySelectorAll('.pocket-label');
        p.innerHTML = '';
        labels.forEach(l => p.appendChild(l));
    });

    const roles = ['pawn', 'knight', 'bishop', 'rook', 'queen'];
    const pockets = pos.pockets;

    if (pockets) {
        roles.forEach(role => {
            const count = pockets.white[role] || 0;
            if (count > 0) createPocketSlot('white', role, count, whitePocket);
        });

        roles.forEach(role => {
            const count = pockets.black[role] || 0;
            if (count > 0) createPocketSlot('black', role, count, blackPocket);
        });
    }
}

function createPocketSlot(color, role, count, container) {
    const slot = document.createElement('div');
    slot.className = 'pocket-slot';

    const pieceEl = document.createElement('cg-piece');
    pieceEl.className = `${color} ${role}`;
    pieceEl.setAttribute('data-color', color);
    pieceEl.setAttribute('data-role', role);
    
    pieceEl.addEventListener('mousedown', (e) => {
        if (pos.turn === color) {
            cg.dragNewPiece({ color, role }, e, true);
        }
    });

    slot.appendChild(pieceEl);

    if (count > 1) {
        const badge = document.createElement('div');
        badge.className = 'piece-count';
        badge.innerText = count;
        slot.appendChild(badge);
    }

    container.appendChild(slot);
}

// Move History Tracking
const historyEl = document.getElementById('move-history');
let currentMoveNum = 1;
let isWhiteTurn = true;

function appendToHistory(san) {
    if (isWhiteTurn) {
        const row = document.createElement('div');
        row.className = 'move-row';
        row.innerHTML = `<span class="move-num">${currentMoveNum}.</span><span class="move-san" style="flex: 1;">${san}</span>`;
        historyEl.appendChild(row);
    } else {
        const lastRow = historyEl.lastElementChild;
        if (lastRow) {
            lastRow.innerHTML += `<span class="move-san" style="flex: 1;">${san}</span>`;
        }
        currentMoveNum++;
    }
    isWhiteTurn = !isWhiteTurn;
    historyEl.scrollTop = historyEl.scrollHeight; 
}

function clearHistory() {
    historyEl.innerHTML = '';
    currentMoveNum = 1;
    isWhiteTurn = true;
}

// 4. Move Handlers
let pendingMove = null;
let pendingCapture = false; // Stores capture state while waiting for promotion UI

// 1. Set default color to white immediately
window.myColor = 'white'; 

function handleMove(orig, dest) {
    // Prevent moving if it's not your assigned color (starts as white)
    if (pos.turn !== window.myColor) {
        syncBoard(); 
        return;
    }

    let baseMove = { 
        from: parseSquare(orig), 
        to: parseSquare(dest) 
    };
    
    const isCapture = !!cg.state.pieces[dest];

    // Promotion Check
    if (pos.isLegal({ ...baseMove, promotion: 'queen' })) {
        pendingMove = baseMove;
        pendingCapture = isCapture;
        
        const promoDialog = document.getElementById('promotion-dialog');
        promoDialog.className = `promotion-dialog ${pos.turn}`;
        document.getElementById('promotion-wrapper').style.display = 'flex';
        
        syncBoard();
        return;
    }

    if (pos.isLegal(baseMove)) {
        const san = makeSan(pos, baseMove); 
        pos.play(baseMove);
        playSound(isCapture);
        appendToHistory(san);

        // Emit move to Render backend
        // Inside handleMove and handleDrop, right after appending to history:
        socket.emit('make_move', { 
            gameId: window.currentGameId, 
            move: baseMove, // or 'move' for drops
            fen: makeFen(pos.toSetup()),
            san: san // <--- Pass the move text to the server
        });
    }
    syncBoard();
}

function syncBoard() {
    // Interaction is only allowed if it is the local player's turn
    const canMove = (pos.turn === window.myColor);

    cg.set({
        fen: makeFen(pos.toSetup()),
        turnColor: pos.turn,
        movable: {
            // Locks the board if it's the opponent's turn or color
            color: canMove ? pos.turn : 'none', 
            dests: chessgroundDests(pos)
        }
    });
    updatePockets();

    if (pos.isCheckmate()) {
        const winner = pos.turn === 'white' ? 'Black' : 'White';
        appendMessage("System", `Checkmate! ${winner} wins.`, true);
        // Determine standard outcome format
        const outcome = pos.turn === 'white' ? '0-1' : '1-0'; 
        endGame(outcome);
    } else if (pos.isStalemate()) {
        appendMessage("System", "Stalemate! Game drawn: ½-½", true);
        endGame("1/2-1/2");
    }
}

document.querySelectorAll('.promo-piece').forEach(pieceEl => {
    pieceEl.addEventListener('click', (e) => {
        if (pendingMove) {
            pendingMove.promotion = e.target.getAttribute('data-role');
            if (pos.isLegal(pendingMove)) {
                const san = makeSan(pos, pendingMove);
                pos.play(pendingMove);
                playSound(pendingCapture); // Play audio after promotion selection
                appendToHistory(san);
            }
            
            pendingMove = null;
            pendingCapture = false;
            document.getElementById('promotion-wrapper').style.display = 'none';
            syncBoard();
        }
    });
});

function handleDrop(piece, dest) {
    if (piece.color !== window.myColor || pos.turn !== window.myColor) {
        syncBoard();
        return;
    }

    const move = { role: piece.role, to: parseSquare(dest) };
    if (pos.isLegal(move)) {
        const san = makeSan(pos, move);
        pos.play(move);
        playSound(false); 
        appendToHistory(san);

        // Send the complete payload to the server
        socket.emit('make_move', { 
            gameId: window.currentGameId, 
            move: move, 
            fen: makeFen(pos.toSetup()),
            san: san // Ensure this is included!
        });
    }
    syncBoard();
}



// 5. Website Profile Integration
// 1. Define the sync function
window.updatePlayerProfile = function(userData) {
    if (!userData) return;
    if (userData.picture) document.getElementById('player-avatar').src = userData.picture;
    if (userData.name) document.getElementById('player-username').innerText = userData.name;
    // DELETED: Elo rating update
    
    socket.emit('find_match', { user: userData }); 
};

// 3. AUTO-INIT: Check for existing session data right now
const savedUser = sessionStorage.getItem('userData');
if (savedUser) {
    window.updatePlayerProfile(JSON.parse(savedUser));
}

window.updateOpponentProfile = function(userData) {
    if (!userData) return;
    if (userData.picture) document.getElementById('opponent-avatar').src = userData.picture;
    if (userData.name) document.getElementById('opponent-username').innerText = userData.name;
    // DELETED: Elo rating update
};

// 6. Chat & Control Logic
const chatHistory = document.getElementById('chat-history');
const chatInput = document.getElementById('chat-input');
const btnSend = document.getElementById('chat-send');

function appendMessage(author, text, isSystem = false) {
    const msgDiv = document.createElement('div');
    msgDiv.className = isSystem ? 'chat-msg system' : 'chat-msg';
    
    if (isSystem) {
        msgDiv.innerText = text;
    } else {
        msgDiv.innerHTML = `<span class="author">${author}:</span> ${text}`;
    }
    
    chatHistory.appendChild(msgDiv);
    chatHistory.scrollTop = chatHistory.scrollHeight; 
}

// Send chat to server
function handleSendMessage() {
    const text = chatInput.value.trim();
    if (!text) return;

    appendMessage("You", text);
    chatInput.value = '';

    const currentUser = JSON.parse(sessionStorage.getItem('userData'));
    socket.emit('send_chat', { 
        gameId: window.currentGameId, 
        message: text, 
        author: currentUser ? currentUser.firstName : "Opponent" 
    });
}

// Receive chat from server
socket.on('receive_chat', ({ message, author }) => {
    appendMessage(author, message);
});

btnSend.addEventListener('click', handleSendMessage);
chatInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handleSendMessage();
});

let isGameActive = true; 

function setGameActiveState(active) {
    isGameActive = active;
    if (isGameActive) {
        document.getElementById('btn-resign').style.display = 'block';
        document.getElementById('btn-draw').style.display = 'block';
        document.getElementById('btn-new-game').style.display = 'none';
    } else {
        document.getElementById('btn-resign').style.display = 'none';
        document.getElementById('btn-draw').style.display = 'none';
        document.getElementById('btn-new-game').style.display = 'block';
    }
}

function endGame(outcome) {
    setGameActiveState(false);
    cg.set({ movable: { color: 'none' } });
    
    // Tell the server to log the final result!
    socket.emit('game_over', { 
        gameId: window.currentGameId, 
        outcome: outcome 
    });
}

// Emit resignation
document.getElementById('btn-resign').addEventListener('click', () => {
    if (!isGameActive) return;
    appendMessage("System", "You resigned. Opponent wins.", true);
    
    const outcome = window.myColor === 'white' ? '0-1' : '1-0';
    socket.emit('resign', { gameId: window.currentGameId, outcome }); // Tell server
    endGame(outcome);
});

// Receive opponent's resignation
socket.on('opponent_resigned', ({ outcome }) => {
    appendMessage("System", "Opponent resigned. You win!", true);
    endGame(outcome);
});

// Emit, Accept, or Rescind Draw
document.getElementById('btn-draw').addEventListener('click', () => {
    if (!isGameActive) return;
    const drawBtn = document.getElementById('btn-draw');
    
    if (drawBtn.innerText === "Accept Draw") {
        // State 1: Opponent offered, you accept
        socket.emit('accept_draw', { gameId: window.currentGameId });
        appendMessage("System", "You accepted the draw. Game Over: ½-½", true);
        endGame("1/2-1/2");

    } else if (drawBtn.innerText === "Cancel Offer") {
        // State 2: You offered, now you rescind
        socket.emit('rescind_draw', { gameId: window.currentGameId });
        drawBtn.innerText = "½ Offer Draw";
        appendMessage("System", "You canceled your draw offer.", true);

    } else {
        // State 3: Normal state, you offer
        socket.emit('offer_draw', { gameId: window.currentGameId });
        drawBtn.innerText = "Cancel Offer";
        appendMessage("System", "Draw offer sent. Waiting for opponent...", true);
    }
});

// Receive Draw Offer
socket.on('draw_offered', () => {
    appendMessage("System", "Opponent offered a draw.", true);
    const drawBtn = document.getElementById('btn-draw');
    drawBtn.innerText = "Accept Draw";
    drawBtn.style.backgroundColor = "#ffeb3b"; // Highlight button
    drawBtn.style.color = "#000";
});

// Receive Draw Acceptance
socket.on('draw_accepted', () => {
    appendMessage("System", "Opponent accepted the draw. Game Over: ½-½", true);
    endGame("1/2-1/2");
});
// Receive Draw Rescission
socket.on('draw_rescinded', () => {
    appendMessage("System", "Opponent canceled their draw offer.", true);
    const drawBtn = document.getElementById('btn-draw');
    drawBtn.innerText = "½ Offer Draw";
    drawBtn.style.backgroundColor = ""; // Reset to default
    drawBtn.style.color = "";           // Reset to default
});

// main.js - The New Game / Matchmaking Logic
document.getElementById('btn-new-game').addEventListener('click', () => {
    pos = Crazyhouse.default();
    pendingMove = null;
    document.getElementById('promotion-wrapper').style.display = 'none';

    const drawBtn = document.getElementById('btn-draw');
    drawBtn.innerText = "½ Offer Draw";
    drawBtn.disabled = false;
    drawBtn.style.backgroundColor = "";
    drawBtn.style.color = "";

    clearHistory();
    syncBoard();
    
    // Put user back into the matchmaking queue
    const currentUser = JSON.parse(sessionStorage.getItem('userData'));
    if (currentUser) {
        socket.emit('find_match', { user: currentUser });
    }
});




if (themeSelector && boardContainer) {
    const savedTheme = localStorage.getItem('boardTheme') || 'board-brown';

    boardContainer.classList.remove('board-brown', 'board-green', 'board-blue');
    boardContainer.classList.add(savedTheme);
    themeSelector.value = savedTheme;

    themeSelector.addEventListener('change', (e) => {
        const newTheme = e.target.value;
        boardContainer.classList.remove('board-brown', 'board-green', 'board-blue');
        boardContainer.classList.add(newTheme);
        localStorage.setItem('boardTheme', newTheme);
    });
}

// Initial Draw
updatePockets();