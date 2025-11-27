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
//  🌐 WEBSOCKET SERVER
// =============================
const wss = new WebSocketServer({ server, path: "/tap" });

wss.on("connection", (ws) => {
    console.log("🟢 Overlay conectado via WS");
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

    tiktok.connect()
        .then(() => console.log("🟢 Conectado @" + username))
        .catch(err => console.log("❌ Erro @" + username, err));

    // TAP (Like) — COM FOTO REAL
    tiktok.on("like", data => {
        broadcast({
            type: "tap",
            user: data.uniqueId,
            nickname: data.nickname,
            likes: data.likeCount,
            pfp: data.profilePictureUrl    // 🔥 FOTO REAL
        });
    });

    // FOLLOW — COM FOTO REAL
    tiktok.on("follow", data => {
        broadcast({
            type: "follow",
            user: data.uniqueId,
            nickname: data.nickname,
            pfp: data.profilePictureUrl
        });
    });

    // GIFT — COM FOTO REAL
    tiktok.on("gift", data => {
        broadcast({
            type: "gift",
            user: data.uniqueId,
            nickname: data.nickname,
            giftName: data.giftName,
            repeatEnd: data.repeatEnd,
            pfp: data.profilePictureUrl
        });
    });

    // JOIN (Member Enter)
    tiktok.on("member", data => {
        broadcast({
            type: "join",
            user: data.uniqueId,
            nickname: data.nickname,
            pfp: data.profilePictureUrl
        });
    });
});

// =============================
//  🧪 SIMULADORES (AGORA COM FOTO REAL)
// =============================

const TEST_PFP = "https://i.imgur.com/0Z8FQmT.png"; // foto genérica

// 🔥 TAP
app.get("/test-tap", (req, res) => {
    broadcast({
        type: "tap",
        user: "testerID",
        nickname: "TapTester",
        likes: 1,
        pfp: TEST_PFP
    });
    res.send("✔ TAP DE TESTE (com foto) enviado!");
});

// 🔥 FOLLOW
app.get("/test-follow", (req, res) => {
    broadcast({
        type: "follow",
        user: "testerID",
        nickname: "FollowTester",
        pfp: TEST_PFP
    });
    res.send("✔ FOLLOW DE TESTE enviado!");
});

// 🔥 GIFT
app.get("/test-gift", (req, res) => {
    broadcast({
        type: "gift",
        user: "testerID",
        nickname: "GiftTester",
        giftName: "🎁 Presente de Teste",
        repeatEnd: true,
        pfp: TEST_PFP
    });
    res.send("✔ GIFT DE TESTE enviado!");
});

// 🔥 JOIN
app.get("/test-join", (req, res) => {
    broadcast({
        type: "join",
        user: "testerID",
        nickname: "JoinTester",
        pfp: TEST_PFP
    });
    res.send("✔ JOIN DE TESTE enviado!");
});

// =============================
//  🚀 INICIAR SERVIDOR
// =============================
server.listen(PORT, () => {
    console.log("🚀 SERVIDOR ONLINE na porta " + PORT);
});
