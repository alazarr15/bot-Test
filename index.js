require("dotenv").config();
const mongoose = require("mongoose");
const express = require("express");
const bot = require("./bot"); // import your bot instance
const { startLimitedBonusScheduler } = require('./handlers/limitedBonusScheduler');

mongoose.connect(process.env.MONGODB_URI, {})
  .then(() => console.log("✅ Connected to MongoDB"))
  .catch(err => console.error("❌ MongoDB Connection Error:", err));

const app = express();
const PORT = process.env.PORT || 3000;
const IS_DEV = process.env.NODE_ENV === 'development' || !process.env.WEBHOOK_URL;

app.use(express.json()); // parse incoming JSON body

// Root route for testing
app.get("/", (req, res) => {
  res.send("🤖 Telegram bot is running.");
});

// Webhook endpoint (Only active in production)
app.post("/webhook", async (req, res) => {
  try {
    await bot.handleUpdate(req.body);
    res.sendStatus(200);
  } catch (err) {
    if (err.response && err.response.error_code === 403) {
      console.warn(`⚠️ Update from blocked user or forbidden chat. Ignoring.`);
      res.sendStatus(200);
    } else {
      console.error("❌ Error handling update:", err);
      res.sendStatus(500);
    }
  }
});

app.listen(PORT, async () => {
  console.log(`✅ Express server listening on port ${PORT}`);

  try {
    if (IS_DEV) {
      // 1. Clear active webhook on Telegram servers
      await bot.telegram.deleteWebhook({ drop_pending_updates: true });
      console.log("🧹 Deleted active Webhook for local development.");

      // 2. Launch long polling locally
      bot.launch();
      console.log("🤖 Bot is running locally using LONG POLLING!");
    } else {
      // Production Webhook setup
      const webhookBaseUrl = process.env.WEBHOOK_URL
        .replace(/\/+$/, '')
        .replace(/\/webhook$/, '');
      const url = `${webhookBaseUrl}/webhook`;
      const result = await bot.telegram.setWebhook(url);
      
      if (result) {
        console.log("✅ Webhook set successfully:", url);
      } else {
        console.error("❌ Failed to set webhook");
      }
    }

    // Start background schedulers
    startLimitedBonusScheduler(bot);

  } catch (err) {
    console.error("❌ Error during bot initialization:", err);
  }
});

// Enable graceful stop for Telegraf/Node
const stopBot = (signal) => {
  if (bot.polling || bot.webhookServer) {
    bot.stop(signal);
  }
};

process.once('SIGINT', () => stopBot('SIGINT'));
process.once('SIGTERM', () => stopBot('SIGTERM'));