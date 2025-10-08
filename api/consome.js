import express from "express";
import bodyParser from "body-parser";
import admin from "firebase-admin";
import dotenv from "dotenv";
import fs from "fs";

dotenv.config();

// Inicializa Firebase Admin
//const serviceAccount = JSON.parse(fs.readFileSync("serviceAccountKey.json"));
//admin.initializeApp({
//  credential: admin.credential.cert(serviceAccount),
//  databaseURL: "https://diamondstd2-default-rtdb.firebaseio.com"
//});

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      type: process.env.FIREBASE_TYPE,
      project_id: process.env.FIREBASE_PROJECT_ID,
      private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
      private_key: process.env.FIREBASE_PRIVATE_KEY,
      client_email: process.env.FIREBASE_CLIENT_EMAIL,
      client_id: process.env.FIREBASE_CLIENT_ID,
      token_uri: process.env.FIREBASE_TOKEN_URI,
    }),
    databaseURL: "https://diamondstd2-default-rtdb.firebaseio.com",
  });
}

const app = express();
app.use(bodyParser.json());

/**
 * Endpoint para consumir 1 ciclo do usuário
 */
app.post("/consome", async (req, res) => {
  const { secret, userId } = req.body;

  const receivedSecret = String(secret || "").trim();
  const expectedSecret = String(process.env.APP_SECRET_KEY || "").trim();

  if (receivedSecret !== expectedSecret) {
    return res.status(403).json({ error: "Acesso negado" });
  }

  if (!userId) {
    return res.status(400).json({ error: "userId é obrigatório" });
  }

  try {
    const db = admin.database();
    const userRef = db.ref(`usuarios/${userId}`);
    const snapshot = await userRef.get();

    if (!snapshot.exists()) {
      return res.status(404).json({ error: "Usuário não encontrado" });
    }

    const userData = snapshot.val();

    if (userData.ciclos <= 0) {
      return res.json({ success: false, message: "Saldo indisponível, favor adquirir mais ciclos" });
    }

    const novosCiclos = userData.ciclos - 1;
    const timestampAtual = new Date().toISOString();

    // Atualiza usuário
    await userRef.update({
      ciclos: novosCiclos,
      ultimoUso: timestampAtual
    });

    // Cria log no nó "logs"
    const logRef = db.ref("logs").push();
    await logRef.set({
      userId,
      ciclosAntes: userData.ciclos,
      ciclosDepois: novosCiclos,
      timestamp: timestampAtual
    });

    res.json({
      success: true,
      userId,
      ciclosRestantes: novosCiclos,
      message: "Ciclo consumido com sucesso",
      logId: logRef.key
    });
  } catch (err) {
    console.error("Erro ao atualizar usuário ou criar log:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * Endpoint para consultar saldo do usuário sem consumir ciclos
 */
app.post("/saldo", async (req, res) => {
  const { secret, userId } = req.body;

  const receivedSecret = String(secret || "").trim();
  const expectedSecret = String(process.env.APP_SECRET_KEY || "").trim();

  if (receivedSecret !== expectedSecret) {
    return res.status(403).json({ error: "Acesso negado" });
  }

  if (!userId) {
    return res.status(400).json({ error: "userId é obrigatório" });
  }

  try {
    const db = admin.database();
    const userRef = db.ref(`usuarios/${userId}`);
    const snapshot = await userRef.get();

    if (!snapshot.exists()) {
      return res.status(404).json({ error: "Usuário não encontrado" });
    }

    const userData = snapshot.val();

    res.json({
      success: true,
      userId,
      ciclosRestantes: userData.ciclos,
      ativo: userData.ativo,
      ultimoUso: userData.ultimoUso
    });
  } catch (err) {
    console.error("Erro ao consultar saldo do usuário:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.listen(3000, () => {
  console.log("🚀 Servidor rodando em http://localhost:3000");
});
