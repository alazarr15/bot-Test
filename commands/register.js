const User = require("../Model/user");
const path = require("path");
const { buildMainMenu } = require("../utils/menuMarkup");
const { userRateLimiter, globalRateLimiter } = require("../Limit/global");

const LOGO_PATH = path.join(__dirname, "..", "images", "luckybingo2.png");

module.exports = function (bot) {
  bot.start(async (ctx) => {
    // ... (Your /start command is correct and doesn't need changes) ...
  });
  
  // ⭐ UPDATED /register command handler ⭐
  bot.command("register", async (ctx) => {
    try {
      const telegramId = ctx.from.id;

      await userRateLimiter.consume(telegramId);
      await globalRateLimiter.consume("global");

      const user = await User.findOne({ telegramId });

      // ⭐ The fix is here: Check if the user exists AND has a phone number.
      if (user && user.phoneNumber) {
        return ctx.reply(`ℹ️ You are already registered as *${user.username}*`, {
          parse_mode: "Markdown"
        });
      }

      // If the user does not exist, or exists but is not fully registered (no phoneNumber),
      // we proceed with the registration prompt.
      await User.findOneAndUpdate({ telegramId }, {
        registrationInProgress: { step: 1 }
      }, { upsert: true });

      return ctx.reply("📲 Please share your contact by clicking the button below.", {
        reply_markup: {
          keyboard: [[{ text: "📞 Share Contact", request_contact: true }]],
          one_time_keyboard: true,
          resize_keyboard: true
        }
      });
    } catch (error) {
      if (error && error.msBeforeNext) {
        return ctx.reply("⚠️ Please wait a second before trying again.");
      }
      console.error("❌ Registration command failed:", error);
      return ctx.reply("🚫 An error occurred while starting registration.");
    }
  });
};