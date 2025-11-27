import "dotenv/config";
import express from "express";
import http from "http";
import WebSocket, { WebSocketServer } from "ws";
import WebcastPushConnection, { SignConfig } from "./tiktok-live-connector/index.js"; 

// =============================
// ⚙️ CONFIGURAÇÕES INICIAIS
// =============================
const PORT = process.env.PORT || 10000;
const app = express();
const server = http.createServer(app);

const API_KEY = process.env.API_KEY;
const USERS = process.env.USERS?.split(",").map(u => u.trim()).filter(u => u) || []; 

// Ativa a chave de assinatura, se configurada
if (SignConfig && API_KEY) {
    SignConfig.apiKey = API_KEY;
}

const tiktokConnections = new Map();

// =============================
// 🌐 WEBSOCKET SERVER
// =============================
const wss = new WebSocketServer({ server, path: "/tap" });

wss.on("connection", (ws, req) => {
    console.log(`🟢 [WS] Overlay conectado. Total: ${wss.clients.size}`);
    
    ws.on("close", () => {
        console.log(`🔴 [WS] Overlay desconectado. Total: ${wss.clients.size}`);
    });
});

function broadcast(event) {
    const msg = JSON.stringify(event);
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(msg);
        }
    });
}

// =============================
// 📡 FUNÇÃO DE CONEXÃO AO TIKTOK (COM RECONEXÃO)
// =============================

function connectToTikTok(username) {
    console.log(`🔄 [TikTok] Tentando conectar em @${username}`);

    const tiktok = new WebcastPushConnection(username);
    tiktokConnections.set(username, tiktok); 

    tiktok.connect()
        .then(() => {
            console.log(`🟢 [TikTok] Conectado com sucesso em @${username}`);
        })
        .catch(err => {
            console.log(`❌ [TikTok] Erro ao conectar em @${username}. Tentando novamente em 10s.`, err.message);
            setTimeout(() => connectToTikTok(username), 10000); 
        });

    // --- Tratamento de Eventos de Erro e Desconexão ---

    // ERRO: Lida com erros após a conexão (pode indicar falha na leitura)
    tiktok.on("error", (err) => {
        console.log(`🔴 [TikTok] ERRO de Conexão em @${username}.`, err.message);
        tiktok.disconnect(); 
        setTimeout(() => connectToTikTok(username), 10000); 
    });

    // DESCONEXÃO: A função que gerencia o estado de desconexão
    const handleDisconnection = () => {
        console.log(`⚠️ [TikTok] Desconectado de @${username}. Tentando reconectar em 5s.`);
        // Chamamos disconnect() para limpar recursos, se ainda não estiverem limpos
        tiktok.disconnect(); 
        setTimeout(() => connectToTikTok(username), 5000); 
    };

    // Escuta a variação "disconnect"
    tiktok.on("disconnect", handleDisconnection);
    
    // Escuta a variação "disconnected" (a mais segura/comum)
    tiktok.on("disconnected", handleDisconnection);


    // --- Eventos de Interação (Event Listeners) ---

    tiktok.on("like", data => {
        broadcast({ type: "tap", user: data.uniqueId, nickname: data.nickname, likes: data.likeCount, pfp: data.profilePictureUrl });
    });

    tiktok.on("follow", data => {
        broadcast({ type: "follow", user: data.uniqueId, nickname: data.nickname, pfp: data.profilePictureUrl });
    });

    tiktok.on("gift", data => {
        broadcast({ type: "gift", user: data.uniqueId, nickname: data.nickname, giftName: data.giftName, repeatEnd: data.repeatEnd, pfp: data.profilePictureUrl });
    });

    tiktok.on("member", data => {
        broadcast({ type: "join", user: data.uniqueId, nickname: data.nickname, pfp: data.profilePictureUrl });
    });
}

if (USERS.length > 0) {
    USERS.forEach(username => {
        connectToTikTok(username);
    });
} else {
    console.log("⚠️ Nenhuma conta de TikTok configurada na variável USERS. Conectores desativados.");
}


// =============================
// 🧪 SIMULADORES
// =============================
const TEST_PFP = "https://i.imgur.com/0Z8FQmT.png";

app.get("/", (req, res) => {
    res.send(`Servidor de Eventos do TikTok rodando na porta ${PORT}. Rotas de teste: /test-tap, /test-follow, /test-gift, /test-join.`);
});

app.get("/test-tap", (req, res) => {
    broadcast({ type: "tap", user: "testerID", nickname: "TapTester", likes: 1, pfp: TEST_PFP });
    res.send("✔ TAP DE TESTE (com foto) enviado!");
});

app.get("/test-follow", (req, res) => {
    broadcast({ type: "follow", user: "testerID", nickname: "FollowTester", pfp: TEST_PFP });
    res.send("✔ FOLLOW DE TESTE enviado!");
});

app.get("/test-gift", (req, res) => {
    broadcast({ type: "gift", user: "testerID", nickname: "GiftTester", giftName: "🎁 Presente de Teste", repeatEnd: true, pfp: TEST_PFP });
    res.send("✔ GIFT DE TESTE enviado!");
});

app.get("/test-join", (req, res) => {
    broadcast({ type: "join", user: "testerID", nickname: "JoinTester", pfp: TEST_PFP });
    res.send("✔ JOIN DE TESTE enviado!");
});

// =============================
// 🚀 INICIAR SERVIDOR
// =============================
server.listen(PORT, () => {
    console.log("🚀 SERVIDOR ONLINE na porta " + PORT);
    if (USERS.length > 0) {
        console.log(`Monitorando lives: ${USERS.join(", ")}`);
    }
});
