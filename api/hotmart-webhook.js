// api/hotmart-webhook.js
import express from "express";
import admin from "firebase-admin";
import dotenv from "dotenv";
// import sgMail from "@sendgrid/mail"; // ⚠️ Opcional, comentado

dotenv.config();

// Inicializa Firebase Admin
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      type: process.env.FIREBASE_TYPE,
      project_id: process.env.FIREBASE_PROJECT_ID,
      private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
      private_key: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
      client_email: process.env.FIREBASE_CLIENT_EMAIL,
      client_id: process.env.FIREBASE_CLIENT_ID,
      token_uri: process.env.FIREBASE_TOKEN_URI,
    }),
    databaseURL: process.env.FIREBASE_DATABASE_URL || "https://diamondstd2-default-rtdb.firebaseio.com",
  });
}

// ⚠️ Opcional, comentado
// sgMail.setApiKey(process.env.SENDGRID_API_KEY);

const app = express();
app.use(express.json({ limit: "1mb" }));

// Função para gerar userId aleatório tipo diam-xxxx-xxxx-xxxx
const gerarUserId = () => {
  const parte = () => Math.random().toString(36).substring(2, 6);
  return `diam-${parte()}-${parte()}-${parte()}`;
};

app.post("/api/hotmart-webhook", async (req, res) => {
  try {
    const payload = req.body || {};
    const hottok = req.headers["x-hotmart-hottok"]; // token enviado no header

    // valida token do Hotmart
    if (process.env.HOTMART_HOTTOK && hottok !== process.env.HOTMART_HOTTOK) {
      console.warn("Hotmart token mismatch", hottok);
      return res.status(403).send("forbidden");
    }

    // 🔹 Confirma que o evento é compra completa e status COMPLETED
    const event = payload.event;
    const status = payload?.data?.purchase?.status;
    if (event !== "PURCHASE_COMPLETE" || status !== "COMPLETED") {
      console.log("Evento ignorado (não é compra completa):", event);
      return res.status(200).send("evento ignorado");
    }

    // Extrai transactionId e email do comprador
    const transactionId = payload?.data?.purchase?.transaction;
    const email = payload?.data?.buyer?.email;

    if (!transactionId || !email) {
      console.error("Payload sem transactionId ou email", { transactionId, email, payload });
      return res.status(400).send("bad payload");
    }

    const db = admin.database();
    const txRef = db.ref(`hotmart_tx/${transactionId}`);
    const txSnap = await txRef.get();
    if (txSnap.exists()) {
      console.log("Transaction already processed:", transactionId);
      return res.status(200).send("already processed");
    }

    // Gera userId único
    let userId = null;
    const maxAttempts = 8;
    for (let i = 0; i < maxAttempts; i++) {
      const candidate = gerarUserId();
      const snap = await db.ref(`usuarios/${candidate}`).get();
      if (!snap.exists()) {
        userId = candidate;
        break;
      }
    }
    if (!userId) {
      console.error("Falha ao gerar userId único");
      return res.status(500).send("erro ao gerar userId");
    }

    const novoUsuario = {
      ativo: true,
      ciclos: 800,
      ultimoUso: null,
      origem: "Hotmart",
      email,
      createdAt: new Date().toISOString()
    };

    // Atualização atômica
    const updates = {};
    updates[`usuarios/${userId}`] = novoUsuario;
    updates[`hotmart_tx/${transactionId}`] = {
      userId,
      email,
      produto: payload?.data?.product?.name || null,
      valor: payload?.data?.purchase?.price?.value || null,
      moeda: payload?.data?.purchase?.price?.currency_value || null,
      createdAt: new Date().toISOString()
    };

    await db.ref().update(updates);

    // ⚠️ Envio de e-mail comentado
    /*
    const msg = {
      to: email,
      from: process.env.EMAIL_FROM,
      subject: "Sua chave Diamantes — Obrigado pela compra",
      text: `Obrigado! Sua chave de acesso: ${userId}\nCiclos recebidos: 800\nAcesse o painel para usar.`,
      html: `<p>Obrigado pela compra! Sua chave de acesso: <b>${userId}</b></p><p>Ciclos: <b>800</b></p>`
    };
    try {
      await sgMail.send(msg);
    } catch (mailErr) {
      console.error("Erro ao enviar e-mail:", mailErr);
    }
    */

    console.log("Hotmart webhook processed:", transactionId, userId);
    return res.status(200).send("ok");
  } catch (err) {
    console.error("Erro no webhook Hotmart:", err);
    return res.status(500).send("internal error");
  }
});

export default app;
export const config = { api: { bodyParser: true } };
