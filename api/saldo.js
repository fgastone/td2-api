import admin from "firebase-admin";
import dotenv from "dotenv";

dotenv.config();

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
    databaseURL: "https://diamondstd2-default-rtdb.firebaseio.com",
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

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
}
