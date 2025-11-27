import "dotenv/config";
import express from "express";
import http from "http";
import WebSocket, { WebSocketServer } from "ws";
import WebcastPushConnection, { SignConfig } from "./tiktok-live-connector/index.js";

const PORT = process.env.PORT || 10000;
const app = express();
const server = http.createServer(app);

// =============================
//  🔧 CONFIGURAÇÕES
// =============================
const API_KEY = process.env.API_KEY;
const USERS = process.env.USERS?.split(",").map(u => u.trim()) || [];

// Ativa chave de assinatura
if (SignConfig && API_KEY) {
    SignConfig.apiKey = API_KEY;
}

// =============================
//  🌐 WEBSOCKET SERVER UNIVERSAL
// =============================
const wss = new WebSocketServer({ server, path: "/tap" });

wss.on("connection", (ws, request) => {
    console.log("🟢 Novo overlay conectado.");

    ws.on("close", () => console.log("🔴 Overlay desconectado."));
});

// Envia evento para TODOS overlays conectados
function broadcast(event) {
    const msg = JSON.stringify(event);
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(msg);
        }
    });
}

// =============================
//  📡 CONECTAR NO TIKTOK
// =============================
USERS.forEach(username => {
    console.log("🔄 Conectando em @" + username);

    const tiktok = new WebcastPushConnection(username);

    tiktok.connect().then(() => {
        console.log("🟢 Conectado ao TikTok @" + username);
    }).catch(err => {
        console.log("❌ Erro ao conectar @" + username, err);
    });

    // TAP (likes)
    tiktok.on("like", data => {
        broadcast({
            type: "tap",
            user: data.uniqueId,
            nickname: data.nickname,
            likes: data.likeCount
        });
    });

    // FOLLOW (seguidores)
    tiktok.on("follow", data => {
        broadcast({
            type: "follow",
            user: data.uniqueId,
            nickname: data.nickname
        });
    });

    // GIFT
    tiktok.on("gift", data => {
        broadcast({
            type: "gift",
            user: data.uniqueId,
            nickname: data.nickname,
            giftName: data.giftName,
            repeatEnd: data.repeatEnd
        });
    });

    // JOIN (entrar na live)
    tiktok.on("member", data => {
        broadcast({
            type: "join",
            user: data.uniqueId,
            nickname: data.nickname
        });
    });
});

// =============================
//  🧪 SIMULADORES SEM LIVE
// =============================

// TAP
app.get("/test-tap", (req, res) => {
    broadcast({
        type: "tap",
        user: "testeUser",
        nickname: "TapTester",
        likes: 1
    });
    res.send("✔ TAP enviado ao overlay!");
});

// FOLLOW
app.get("/test-follow", (req, res) => {
    broadcast({
        type: "follow",
        user: "testeUser",
        nickname: "FollowTester"
    });
    res.send("✔ FOLLOW enviado ao overlay!");
});

// GIFT
app.get("/test-gift", (req, res) => {
    broadcast({
        type: "gift",
        user: "testeUser",
        nickname: "GiftTester",
        giftName: "🎁 Presente de Teste",
        repeatEnd: true
    });
    res.send("✔ GIFT enviado ao overlay!");
});

// JOIN
app.get("/test-join", (req, res) => {
    broadcast({
        type: "join",
        user: "testeUser",
        nickname: "JoinTester"
    });
    res.send("✔ JOIN enviado ao overlay!");
});

// =============================
//  🚀 INICIAR SERVIDOR
// =============================
server.listen(PORT, () => {
    console.log("🚀 SERVIDOR ONLINE na porta " + PORT);
});
