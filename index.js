require("dotenv").config();
const mongoose = require("mongoose");
const express = require("express");
const bot = require("./bot"); // import your bot instance
const { startLimitedBonusScheduler } = require('./handlers/limitedBonusScheduler'); // ADD THIS (Create this file next)


mongoose.connect(process.env.MONGODB_URI, {})
  .then(() => console.log("✅ Connected to MongoDB"))
  .catch(err => console.error("❌ MongoDB Connection Error:", err));

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json()); // parse incoming JSON body

// Root route for testing
app.get("/", (req, res) => {
  res.send("🤖 Telegram bot is running.");
});

// Webhook endpoint to receive updates from Telegram
app.post("/webhook", async (req, res) => {
  try {
    await bot.handleUpdate(req.body);
    res.sendStatus(200);
  } catch (err) {
    if (err.response && err.response.error_code === 403) {
      // Bot blocked by user — just log and respond 200 (to avoid Telegram retry)
      console.warn(`⚠️ Update from blocked user or forbidden chat. Ignoring. Error: ${err.description || err.message}`);
      res.sendStatus(200);
    } else {
      console.error("❌ Error handling update:", err);
      res.sendStatus(500);
    }
  }
});

app.listen(PORT, async () => {
  console.log(`✅ Express server listening on port ${PORT}`);

  // Set webhook URL on Telegram
  try {
    const url = process.env.WEBHOOK_URL;  // e.g. https://yourdomain.com/webhook
    if (!url) {
      console.warn("⚠️ WEBHOOK_URL env variable not set. Please set it to your HTTPS webhook URL.");
      return;
    }

    const result = await bot.telegram.setWebhook(url);
    if (result) {
      console.log("✅ Webhook set successfully:", url);
    } else {
      console.error("❌ Failed to set webhook");
    }
        startLimitedBonusScheduler(bot);

  } catch (err) {
    console.error("❌ Error setting webhook:", err);
  }
});
