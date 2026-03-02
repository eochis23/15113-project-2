const express = require('express');
const cors = require('cors');
const http = require('http'); 
const crypto = require('crypto');
const { Server } = require('socket.io');
const { Sequelize, DataTypes } = require('sequelize');
const { GoogleGenerativeAI } = require("@google/generative-ai");

const app = express();
const server = http.createServer(app); 
const port = process.env.PORT || 3000;

// 1. Initialize SQL Database
const sequelize = new Sequelize(process.env.DATABASE_URL, {
    dialect: 'postgres',
    dialectOptions: { ssl: { require: true, rejectUnauthorized: false } }
});

// 2. Define the NEW Game Model
const GameLog = sequelize.define('GameLog', {
    whitePlayer: { type: DataTypes.JSON, allowNull: true },
    blackPlayer: { type: DataTypes.JSON, allowNull: true },
    outcome: { type: DataTypes.STRING, allowNull: false }, 
    history: { type: DataTypes.JSON, defaultValue: [] }
});

// 3. In-Memory Store
const activeGames = {};
let waitingPlayer = null; // The matchmaking queue

// 4. Initialize Socket.io
const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

app.use(cors());
app.use(express.json());

// --- REAL-TIME CHESS & MATCHMAKING LOGIC ---
io.on('connection', (socket) => {
    console.log(`👤 User Connected: ${socket.id}`);

    // Make sure to add 'async' here
    socket.on('find_match', async ({ user }) => {
        if (waitingPlayer && waitingPlayer.socket.id === socket.id) return;

        if (waitingPlayer) {
            const gameId = crypto.randomUUID();
            const p1 = waitingPlayer;
            const p2 = { socket, user };

            // Randomize White and Black
            const isP1White = Math.random() < 0.5;
            const whitePlayer = isP1White ? p1 : p2;
            const blackPlayer = isP1White ? p2 : p1;

            const whiteUser = { ...whitePlayer.user, socketId: whitePlayer.socket.id };
            const blackUser = { ...blackPlayer.user, socketId: blackPlayer.socket.id };

            // --- NEW: Calculate Head-to-Head Record ---
            let whiteWins = 0;
            let blackWins = 0;
            let draws = 0;

            try {
                // Fetch games to calculate the record between these two specific players
                const pastGames = await GameLog.findAll(); 
                pastGames.forEach(game => {
                    const wEmail = game.whitePlayer?.email;
                    const bEmail = game.blackPlayer?.email;
                    
                    if ((wEmail === whiteUser.email && bEmail === blackUser.email) ||
                        (wEmail === blackUser.email && bEmail === whiteUser.email)) {
                        
                        if (game.outcome === '1/2-1/2') {
                            draws++;
                        } else if (game.outcome === '1-0') {
                            if (wEmail === whiteUser.email) whiteWins++; else blackWins++;
                        } else if (game.outcome === '0-1') {
                            if (bEmail === whiteUser.email) blackWins++; else whiteWins++;
                        }
                    }
                });
            } catch (err) {
                console.error("Failed to fetch head-to-head record:", err);
            }
            // ------------------------------------------

            activeGames[gameId] = {
                whitePlayer: whiteUser,
                blackPlayer: blackUser,
                fen: 'startpos',
                history: []
            };

            whitePlayer.socket.join(gameId);
            blackPlayer.socket.join(gameId);

            io.to(gameId).emit('update_players', {
                gameId: gameId, 
                white: whiteUser,
                black: blackUser,
                fen: 'startpos',
                record: { whiteWins, blackWins, draws } // Send the tallied record to the clients!
            });

            waitingPlayer = null; 
        } else {
            waitingPlayer = { socket, user };
            socket.emit('waiting_for_match');
        }
    });

    socket.on('make_move', ({ gameId, move, fen, san }) => {
        socket.to(gameId).emit('receive_move', { move, fen });
        if (activeGames[gameId]) {
            activeGames[gameId].fen = fen;
            if (san) activeGames[gameId].history.push(san);
        }
    });

    socket.on('game_over', async ({ gameId, outcome }) => {
        const room = activeGames[gameId];
        if (room) {
            try {
                await GameLog.create({
                    whitePlayer: room.whitePlayer,
                    blackPlayer: room.blackPlayer,
                    outcome: outcome,
                    history: room.history
                });
                delete activeGames[gameId];
            } catch (err) {
                console.error("Failed to save game log:", err);
            }
        }
    });

    // Relays
    socket.on('send_chat', ({ gameId, message, author }) => socket.to(gameId).emit('receive_chat', { message, author }));
    socket.on('resign', ({ gameId, outcome }) => socket.to(gameId).emit('opponent_resigned', { outcome }));
    socket.on('offer_draw', ({ gameId }) => socket.to(gameId).emit('draw_offered'));
    socket.on('accept_draw', ({ gameId }) => socket.to(gameId).emit('draw_accepted'));
    socket.on('rescind_draw', ({ gameId }) => socket.to(gameId).emit('draw_rescinded'));

    socket.on('disconnect', () => {
        // Remove from queue if they disconnect while waiting
        if (waitingPlayer && waitingPlayer.socket.id === socket.id) {
            waitingPlayer = null;
        }
        console.log("User Disconnected");
    });
});

// --- YOUR EXISTING ROUTES ---
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

app.post('/api/draft-email', async (req, res) => {
    const { bullets, name } = req.body;
    if (!bullets) return res.status(400).json({ error: "Bullet points are required" });
    try {
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash"});
        const prompt = `You are a helpful assistant. Turn the following bullet points into a professional, polite email message from "${name || 'a user'}" to Eric Ochis.\n1. Keep it concise and friendly.\n2. Sign off the email with the name "${name || 'User'}".\nBullet points:\n${bullets}`;
        const result = await model.generateContent(prompt);
        const response = await result.response;
        res.json({ draft: response.text() });
    } catch (error) { res.status(500).json({ error: "Failed to generate draft." }); }
});

app.post('/api/log-visitor', async (req, res) => {
    const { email, firstName } = req.body;
    if (!email || !email.endsWith('@andrew.cmu.edu')) return res.status(400).json({ error: "Invalid CMU email" });
    try {
        const scriptUrl = process.env.GOOGLE_SCRIPT_URL; 
        const response = await fetch(scriptUrl, {
            method: 'POST',
            body: JSON.stringify({ email: email, firstName: firstName }),
            headers: { 'Content-Type': 'application/json' }
        });
        res.json({ status: "success", message: "Visitor recorded!" });
    } catch (error) { res.status(500).json({ error: "Failed to log visitor." }); }
});

// Start server (Using force: true temporarily to wipe the broken Game table)
sequelize.sync({ force: true }).then(() => {
    server.listen(port, () => console.log(`🚀 Server + WebSockets running on port ${port}`));
});