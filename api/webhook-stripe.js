import express from "express";
import bodyParser from "body-parser";
import Stripe from "stripe";
import admin from "firebase-admin";
import dotenv from "dotenv";

dotenv.config();

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

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
    databaseURL: "https://diamondstd2-default-rtdb.firebaseio.com",
  });
}

const app = express();

// ⚠️ Stripe exige o body cru (sem JSON parse) para validar o webhook
app.post("/api/stripe-webhook", bodyParser.raw({ type: "application/json" }), async (req, res) => {
  const sig = req.headers["stripe-signature"];

  let event;
  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error("❌ Erro ao validar webhook:", err.message);
    return res.status(400).send(`Webhook error: ${err.message}`);
  }

  // 🧩 Quando o pagamento for concluído com sucesso
  if (event.type === "checkout.session.completed") {
    const session = event.data.object;

    const pago = session.payment_status === "paid" || session.status === "complete";
    if (!pago) return res.status(200).send("Pagamento ainda não confirmado.");

    try {
      // 🔹 Gera o userId aleatório (ex: diam-xxxx-xxxx-xxxx)
      const gerarUserId = () => {
        const parte = () => Math.random().toString(36).substring(2, 6);
        return `diam-${parte()}-${parte()}-${parte()}`;
      };

      // 🔹 Garante que não exista duplicidade
      const db = admin.database();
      let userId;
      let existe = true;
      let tentativas = 0;
      const maxTentativas = 10;
      while (existe && tentativas < maxTentativas) {
        userId = gerarUserId();
        const snap = await db.ref(`usuarios/${userId}`).get();
        existe = snap.exists();
        tentativas++;
      }

      if (existe) throw new Error("Falha ao gerar userId único.");

      // 🔹 Cria o novo usuário no Firebase
      const novoUsuario = {
        ativo: true,
        ciclos: 800,
        ultimoUso: null,
      };

      await db.ref(`usuarios/${userId}`).set(novoUsuario);

      console.log("✅ Novo usuário criado:", userId);

      // 🔹 Atualiza metadata do checkout session
      await stripe.checkout.sessions.update(session.id, {
        metadata: { user_key: userId },
      });

      // 🔹 (Opcional) registra log interno
      await db.ref("logs").push({
        evento: "checkout.session.completed",
        userId,
        email: session.customer_details?.email || null,
        valor: session.amount_total / 100,
        moeda: session.currency,
        timestamp: new Date().toISOString(),
      });

      // 🔹 Retorna confirmação ao Stripe
      return res.status(200).send("Usuário criado e metadata atualizada.");
    } catch (err) {
      console.error("Erro ao processar pagamento:", err);
      return res.status(500).send("Erro interno.");
    }
  }

  // Outros eventos são ignorados
  res.status(200).send("Evento ignorado.");
});

export default app;
export const config = {
  api: {
    bodyParser: false, // necessário pro Stripe
  },
};
