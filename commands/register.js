// In your register.js file

const User = require("../Model/user");
const { userRateLimiter, globalRateLimiter } = require("../Limit/global");

module.exports = function (bot) {
  bot.command("register", async (ctx) => {
    try {
      const telegramId = ctx.from.id;

      await userRateLimiter.consume(telegramId);
      await globalRateLimiter.consume("global");

      const user = await User.findOne({ telegramId });

      if (user && user.phoneNumber) {
        return ctx.reply(`ℹ️ You are already registered as *${user.username}*`, {
          parse_mode: "Markdown"
        });
      }

      // ⭐ NEW: Set the `registrationInProgress` flag ONLY in this command.
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