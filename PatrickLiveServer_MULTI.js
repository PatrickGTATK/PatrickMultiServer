import "dotenv/config";
import express from "express";
import http from "http";
import WebSocket, { WebSocketServer } from "ws";
import WebcastPushConnection, { SignConfig } from "./tiktok-live-connector/index.js";

// ===================== CONFIG ======================
const USER = process.env.USERS;   // vindo do Render
const API_KEY = process.env.API_KEY;

const PORT = process.env.PORT || 10000;

SignConfig.apiKey = API_KEY;

// ===================== SERVIDOR HTTP ======================
const app = express();
const server = http.createServer(app);

app.get("/", (req, res) => {
  res.send("Servidor online");
});

// ===================== WEBSOCKET ======================
const wss = new WebSocketServer({ server, path: "/tap" });

wss.on("connection", (ws) => {
  console.log("🔵 Overlay conectado via WS");

  ws.on("close", () => console.log("🔴 Overlay desconectado"));
});

// ===================== TIKTOK LIVE ======================
const tiktok = new WebcastPushConnection(USER);

tiktok.connect()
  .then(() => console.log("🟢 Conectado ao TikTok!"))
  .catch(err => console.error("❌ Erro ao conectar TikTok:", err));

// Evento de TAP
tiktok.on("like", (data) => {
  const payload = {
    userId: data.userId,
    nickname: data.nickname,
    likes: data.likeCount,
  };

  // envia para todos overlays conectados
  wss.clients.forEach((c) => {
    if (c.readyState === WebSocket.OPEN) {
      c.send(JSON.stringify(payload));
    }
  });
});

// ===================== INICIAR SERVIDOR ======================
server.listen(PORT, () => {
  console.log("🚀 SERVIDOR ONLINE na porta", PORT);
});
