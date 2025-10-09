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

// ⚠️ Necessário para Stripe validar webhook
export const config = {
  api: { bodyParser: false },
};

// Função utilitária para gerar userId
const gerarUserId = () => {
  const parte = () => Math.random().toString(36).substring(2, 6);
  return `diam-${parte()}-${parte()}-${parte()}`;
};

// Função para ler body cru
async function buffer(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", (err) => reject(err));
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

  const sig = req.headers["stripe-signature"];
  if (!sig) return res.status(400).send("Missing Stripe signature");

  let event;
  try {
    const buf = await buffer(req);
    event = stripe.webhooks.constructEvent(buf, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error("❌ Erro ao validar webhook:", err.message);
    return res.status(400).send(`Webhook error: ${err.message}`);
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;

    const pago = session.payment_status === "paid" || session.status === "complete";
    if (!pago) return res.status(200).send("Pagamento ainda não confirmado.");

    try {
      const db = admin.database();

      // Garante que o userId seja único
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

      // Cria novo usuário
      const novoUsuario = { ativo: true, ciclos: 800, ultimoUso: null };
      await db.ref(`usuarios/${userId}`).set(novoUsuario);
      console.log("✅ Novo usuário criado:", userId);

      // Atualiza metadata no Stripe
      await stripe.checkout.sessions.update(session.id, { metadata: { user_key: userId } });

      // Salva log interno opcional
      await db.ref("logs").push({
        evento: "checkout.session.completed",
        userId,
        email: session.customer_details?.email || null,
        valor: session.amount_total / 100,
        moeda: session.currency,
        timestamp: new Date().toISOString(),
      });

      return res.status(200).send("Usuário criado e metadata atualizada.");
    } catch (err) {
      console.error("Erro ao processar pagamento:", err);
      return res.status(500).send("Erro interno.");
    }
  }

  res.status(200).send("Evento ignorado.");
}
