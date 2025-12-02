import "dotenv/config";
import express from "express";
import http from "http";
import WebSocket, { WebSocketServer } from "ws";
import WebcastPushConnection from "./tiktok-live-connector/index.js";
import winston from "winston"; 
import { URLSearchParams } from "url";

// ------------------------------------------------------------
// LOGGER
// ------------------------------------------------------------
const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        winston.format.printf(info =>
            `[${info.timestamp}] ${info.level.toUpperCase()}: ${info.message}${info.token ? ` (Token: ${info.token})` : ''}`
        )
    ),
    transports: [new winston.transports.Console()]
});

// ------------------------------------------------------------
// CONFIG
// ------------------------------------------------------------
const PORT = process.env.PORT || 10000;
const PROXY_URL = process.env.PROXY_URL || null;
const WS_SECRET = process.env.WS_SECRET || "123";
const ADMIN_SECRET = process.env.ADMIN_SECRET || "admin123";

const BASE_RECONNECT_DELAY_SECONDS = 15;
const MAX_BACKOFF_DELAY_MINUTES = 60;
const MAX_CONSECUTIVE_FAILURES = 10;

const MAX_PROXY_FAILURES = 5;
const PROXY_FALLBACK_DELAY_MINUTES = 15;

const HEARTBEAT_INTERVAL = 30000;

// ------------------------------------------------------------
// CARREGAR USERS
// ------------------------------------------------------------
let USERS = [];
try {
    USERS = JSON.parse(process.env.USERS_JSON || "[]");
    logger.info(`USERS_JSON carregado: ${USERS.length} usuários.`);
} catch (e) {
    logger.error("Erro no USERS_JSON");
    process.exit(1);
}

const tiktokConnections = new Map();
const wsClients = new Map();
const connectionMetrics = new Map();

// ------------------------------------------------------------
// HEARTBEAT
// ------------------------------------------------------------
function noop() {}
function heartbeat() { this.isAlive = true; }

const app = express();
const server = http.createServer(app);

// ------------------------------------------------------------
// CÁLCULO BACKOFF
// ------------------------------------------------------------
function calculateBackoff(metrics) {
    if (metrics.usingDirect) return PROXY_FALLBACK_DELAY_MINUTES * 60;
    if (metrics.failures >= MAX_CONSECUTIVE_FAILURES) return MAX_BACKOFF_DELAY_MINUTES * 60;
    return Math.min(BASE_RECONNECT_DELAY_SECONDS * Math.pow(2, metrics.failures), MAX_BACKOFF_DELAY_MINUTES * 60);
}

// ------------------------------------------------------------
// FUNÇÃO PRINCIPAL DE CONEXÃO
// ------------------------------------------------------------
async function createTikTokConnection(token, tiktokUser) {
    const metrics = connectionMetrics.get(token) || {
        failures: 0,
        nextAttempt: 0,
        isPaused: false,
        lastSuccess: 0,
        proxyFailures: 0,
        usingDirect: false
    };
    connectionMetrics.set(token, metrics);

    logger.info(`Iniciando conexão TikTok: @${tiktokUser}`, { token });

    const client = new WebcastPushConnection(tiktokUser, {
        enableWebsocket: true,
        processInitialData: true,
        proxy: metrics.usingDirect ? undefined : PROXY_URL
    });

    // EVENTO DE ENTRADA NA LIVE
    client.on("member", msg => {
        logger.info(`👤 Entrou na live: ${msg.uniqueId} | ${msg.nickname}`, { token });
        sendToToken(token, { type: "member", data: msg });
    });

    // EVENTOS PADRÃO
    const events = ["chat", "gift", "like", "follow", "share", "viewer"];
    events.forEach(evt =>
        client.on(evt, msg => {
            logger.info(`📩 Evento ${evt}: recebido`, { token });
            sendToToken(token, { type: evt, data: msg });
        })
    );

    // ERRO / DESCONECTADO
    client.on("disconnected", () => {
        logger.warn(`Desconectado de @${tiktokUser}`, { token });
        setTimeout(() => createTikTokConnection(token, tiktokUser), 5000);
    });

    client.on("error", err => {
        logger.error(`Erro @${tiktokUser}: ${err.message}`, { token });
    });

    try {
        await client.connect();
        tiktokConnections.set(token, client);
        logger.info(`🟢 Conectado @${tiktokUser}`, { token });
    } catch (e) {
        logger.error(`Falha inicial @${tiktokUser}`, { token });
    }
}

// ------------------------------------------------------------
// ENVIO PARA OVERLAYS
// ------------------------------------------------------------
function sendToToken(token, payload) {
    const clients = wsClients.get(token);
    if (!clients) return;

    const json = JSON.stringify(payload);
    for (const ws of clients)
        if (ws.readyState === WebSocket.OPEN) ws.send(json);
}

// ------------------------------------------------------------
// INICIAR TODAS AS CONEXÕES NORMALMENTE
// ------------------------------------------------------------
async function startAllConnections() {
    for (const user of USERS) {
        if (user.active !== true) continue;
        createTikTokConnection(user.token, user.tiktokUser);
    }
}

// ------------------------------------------------------------
// 🔥 TEST MODE: conectar mesmo sem overlay (PARA VOCÊ TESTAR)
// ------------------------------------------------------------
async function startAllConnections_TEST_MODE() {
    logger.warn("🔥 TEST MODE ATIVO: conectando sem overlay!");
    for (const user of USERS) {
        createTikTokConnection(user.token, user.tiktokUser);
    }
}

// ATIVAR TEST MODE:
startAllConnections_TEST_MODE();

// ------------------------------------------------------------
// ROTAS HTTP
// ------------------------------------------------------------
app.get("/", (_, res) => res.send("🟢 PatrickServer_PRO — ONLINE"));

app.post("/webhook", express.json(), (req, res) => {
    logger.info("📩 Webhook Euler recebido!");
    const payload = req.body;

    USERS.forEach(user => {
        if (user.active === true)
            sendToToken(user.token, { type: "euler", data: payload });
    });

    res.send("OK");
});

// STATUS (protegido)
app.get("/status", (req, res) => {
    if (req.headers["x-admin-secret"] !== ADMIN_SECRET)
        return res.status(401).send("Não autorizado");

    res.json({
        server: "ONLINE",
        users: USERS.length,
        wsClients: wsClients.size
    });
});

// OVERLAYS
app.use("/overlay", express.static("./overlay"));

// ------------------------------------------------------------
// WEBSOCKET
// ------------------------------------------------------------
const wss = new WebSocketServer({ server, path: "/ws" });

wss.on("connection", (ws, req) => {
    ws.isAlive = true;
    ws.on("pong", heartbeat);

    const params = new URLSearchParams(req.url.replace("/ws?", ""));
    const token = params.get("token");
    const secret = params.get("secret");

    if (secret !== WS_SECRET) return ws.close();
    if (!token) return ws.close();

    if (!wsClients.has(token)) wsClients.set(token, new Set());
    wsClients.get(token).add(ws);

    logger.info(`Overlay conectado (${token})`);

    ws.on("close", () => {
        wsClients.get(token)?.delete(ws);
    });
});

// ------------------------------------------------------------
// START SERVER
// ------------------------------------------------------------
server.listen(PORT, () => {
    logger.info(`🚀 PatrickServer_PRO rodando na porta ${PORT}`);
});
