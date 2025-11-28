// =======================================================================
//  SERVIDOR MULTI-USUÁRIO TIKTOK COMPLETO (AVANÇADO)
//  ✔ Rate Limiter (Anti-Tap Spam)
//  ✔ Registro de Troca de PFP
//  ✔ Detecção de Overlay Congelado (Heartbeat)
// =======================================================================

import "dotenv/config";
import express from "express";
import http from "http";
import WebSocket, { WebSocketServer } from "ws";
import WebcastPushConnection, { SignConfig } from "./tiktok-live-connector/index.js";
import url from "url";
import process from "process";

// -----------------------------------------------------------------------
// CONFIGURAÇÕES
// -----------------------------------------------------------------------
const PORT = process.env.PORT || 10000;
const API_KEY = process.env.API_KEY;
const WS_SECRET = process.env.WS_SECRET;
const USERS = process.env.USERS?.split(",").map(u => u.trim()).filter(u => u) || [];

const PING_INTERVAL = 25000;
const OVERLAY_HEARTBEAT_INTERVAL = 30000; // Intervalo para checagem de Heartbeat
const MAX_TAP_RATE_MS = 25; // Limita Taps a 40/s (1000ms / 40 = 25ms)

let lastTapTime = 0; // Variável global para o Rate Limiter

const app = express();
const server = http.createServer(app);

// API KEY
if (SignConfig && API_KEY) {
    SignConfig.apiKey = API_KEY;
    console.log("🔑 API_KEY carregada.");
}

// WS SECRET (Segurança Crítica)
if (!WS_SECRET || WS_SECRET.length < 16) {
    console.error("🚨 ERRO CRÍTICO: WS_SECRET ausente ou muito curto! Defina uma chave secreta com pelo menos 16 caracteres em suas variáveis de ambiente para segurança.");
    process.exit(1); 
} else {
    console.log("🔒 WS_SECRET OK.");
}

const tiktokConnections = new Map();

// ===========================================================
// SISTEMA DE PFP 100% SEGURO
// ===========================================================
const pfpCache = new Map();

function getSafePFP(data) {
    let url =
        data.profilePictureUrl ||
        data.profilePicture?.url ||
        data.profilePicture?.thumb ||
        data.avatarThumb ||
        data.avatarMedium ||
        null;
    
    let oldUrl = pfpCache.get(data.uniqueId);

    if (url && typeof url === "string" && url.length > 5) {
        // IMPLEMENTAÇÃO DA MELHORIA: Registrar troca de PFP
        if (oldUrl && oldUrl !== url) {
            console.log(`🔁 Nova PFP detectada para ${data.uniqueId} (${data.nickname})`);
        }
        pfpCache.set(data.uniqueId, url);
        return url;
    }

    if (pfpCache.has(data.uniqueId)) {
        return pfpCache.get(data.uniqueId);
    }

    return "https://i.imgur.com/3yaf2ZQ.png"; // fallback seguro
}

// -----------------------------------------------------------------------
// WEBSOCKET com Autenticação e Heartbeat
// -----------------------------------------------------------------------
const wss = new WebSocketServer({ noServer: true });
let nextOverlayId = 1;

wss.on("connection", ws => {
    ws.id = nextOverlayId++; // ID Único para Debug
    ws.isAlive = true;
    ws.overlayActive = true; // Novo: Indica se o overlay está respondendo

    console.log(`🟢 Overlay conectado. ID: ${ws.id} (${wss.clients.size})`);

    // Resposta ao ping padrão do WS
    ws.on("pong", () => ws.isAlive = true);

    // Resposta ao nosso Heartbeat customizado para checar se o JS está rodando
    ws.on("message", (message) => {
        if (message.toString() === 'HB') {
            ws.overlayActive = true;
        }
    });

    // PING/PONG padrão do WS para checar a conexão de rede
    const pingTimer = setInterval(() => {
        if (ws.readyState !== WebSocket.OPEN) return;
        if (!ws.isAlive) {
            console.log(`⚠️ WS-PING: Overlay ID ${ws.id} não respondeu. Terminando.`);
            return ws.terminate();
        }

        ws.isAlive = false;
        ws.ping();
    }, PING_INTERVAL);
    
    // HEARTBEAT customizado para checar se o JS no overlay está congelado
    const heartbeatTimer = setInterval(() => {
        if (ws.readyState !== WebSocket.OPEN) return;
        
        if (!ws.overlayActive) {
            console.log(`🚨 HB-CHECK: Overlay ID ${ws.id} congelado/inativo. Terminando.`);
            return ws.terminate();
        }

        ws.overlayActive = false; // Define como inativo e envia mensagem
        ws.send('CHK'); // Envia "Check", esperando resposta 'HB'
    }, OVERLAY_HEARTBEAT_INTERVAL);

    ws.on("close", () => {
        console.log(`🔴 Overlay desconectado. ID: ${ws.id}`);
        clearInterval(pingTimer);
        clearInterval(heartbeatTimer);
    });
});

// Envia evento a todos overlays conectados
function broadcast(event) {
    const msg = JSON.stringify(event);
    wss.clients.forEach(c => {
        if (c.readyState === WebSocket.OPEN && c.isAlive) c.send(msg);
    });
}

// Upgrade com autenticação via token
server.on("upgrade", (req, socket, head) => {
    const { pathname, query } = url.parse(req.url, true);

    if (pathname !== "/tap") {
        socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
        return socket.destroy();
    }

    if (!query.token || query.token !== WS_SECRET) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        return socket.destroy();
    }

    wss.handleUpgrade(req, socket, head, ws => {
        wss.emit("connection", ws, req);
    });
});

// -----------------------------------------------------------------------
// CONEXÃO AO TIKTOK
// -----------------------------------------------------------------------
function connectToTikTok(username) {
    console.log(`🔄 Conectando: ${username}`);

    if (tiktokConnections.has(username)) {
        const old = tiktokConnections.get(username);
        old.removeAllListeners();
        old.disconnect();
        tiktokConnections.delete(username);
    }

    const tiktok = new WebcastPushConnection(username);
    tiktokConnections.set(username, tiktok);

    function reconnect(reason) {
        // Loga o motivo e detalhes do erro
        console.warn(`⚠️ Reconnect [${username}] →`, reason);
        if (reason && typeof reason === 'object' && reason.stack) {
             console.error('Detalhes do Erro:', reason);
        }

        tiktok.removeAllListeners();
        tiktok.disconnect();
        tiktokConnections.delete(username);

        setTimeout(() => connectToTikTok(username), 5000);
    }

    tiktok.connect()
        .then(() => console.log(`🟢 Live conectada: ${username}`))
        .catch(err => reconnect(err));

    tiktok.on("error", err => reconnect(err));
    tiktok.on("disconnect", () => reconnect("disconnect"));
    tiktok.on("disconnected", () => reconnect("server closed"));

    // ===========================================================
    // EVENTOS
    // ===========================================================

    // TAP (likes)
    tiktok.on("like", data => {
        const now = Date.now();
        
        // IMPLEMENTAÇÃO DA MELHORIA: RATE LIMITER
        if (now - lastTapTime < MAX_TAP_RATE_MS) {
            return; // Sai sem processar o evento (limite de 40/s)
        }
        lastTapTime = now;

        broadcast({
            streamer: username,
            type: "tap",
            user: data.uniqueId,
            nickname: data.nickname,
            likes: data.likeCount,
            pfp: getSafePFP(data)
        });
    });

    // FOLLOW
    tiktok.on("follow", data => {
        broadcast({
            streamer: username,
            type: "follow",
            user: data.uniqueId,
            nickname: data.nickname,
            pfp: getSafePFP(data)
        });
    });

    // GIFT (dispara foguete)
    tiktok.on("gift", data => {
        broadcast({
            streamer: username,
            type: "gift",
            user: data.uniqueId,
            nickname: data.nickname,
            giftName: data.giftName,
            repeatEnd: data.repeatEnd,
            pfp: getSafePFP(data)
        });
    });

    // JOIN
    tiktok.on("member", data => {
        broadcast({
            streamer: username,
            type: "join",
            user: data.uniqueId,
            nickname: data.nickname,
            pfp: getSafePFP(data)
        });
    });
}

// -----------------------------------------------------------------------
// INICIAR CONEXÕES DO TIKTOK
// -----------------------------------------------------------------------
if (USERS.length > 0) {
    USERS.forEach(u => connectToTikTok(u));
} else {
    console.log("⚠ Nenhum usuário configurado em USERS");
}

// -----------------------------------------------------------------------
// TESTES — FUNCIONAM COM TODOS OVERLAYS
// -----------------------------------------------------------------------
const TEST_PFP = "https://i.imgur.com/0Z8FQmT.png";

app.get("/test-tap", (req, res) => {
    broadcast({
        streamer: "tester",
        type: "tap",
        user: "AAA",
        nickname: "TapTester",
        likes: 1,
        pfp: TEST_PFP
    });
    res.send("✔ TAP enviado.");
});

app.get("/test-follow", (req, res) => {
    broadcast({
        streamer: "tester",
        type: "follow",
        user: "BBB",
        nickname: "FollowTester",
        pfp: TEST_PFP
    });
    res.send("✔ FOLLOW enviado.");
});

app.get("/test-join", (req, res) => {
    broadcast({
        streamer: "tester",
        type: "join",
        user: "CCC",
        nickname: "JoinTester",
        pfp: TEST_PFP
    });
    res.send("✔ JOIN enviado.");
});

// SOMENTE ESTE dispara o foguete
app.get("/test-gift", (req, res) => {
    broadcast({
        streamer: "tester",
        type: "gift",
        user: "DDD",
        nickname: "GiftTester",
        giftName: "🎁 Test",
        repeatEnd: true,
        pfp: TEST_PFP
    });
    res.send("✔ GIFT enviado.");
});

// -----------------------------------------------------------------------
server.listen(PORT, () => {
    console.log(`🚀 SERVIDOR ONLINE: ${PORT}`);
});
