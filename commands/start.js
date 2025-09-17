const User = require("../Model/user");
const path = require("path");
const { buildMainMenu } = require("../utils/menuMarkup");
const { userRateLimiter, globalRateLimiter } = require("../Limit/global");

const LOGO_PATH = path.join(__dirname, "..", "images", "luckybingo2.png");

module.exports = function (bot) {
  bot.start(async (ctx) => {
    try {
      const telegramId = ctx.from.id;

           // ✅ Rate limit: 1 request per second per user
           await userRateLimiter.consume(telegramId);
     
           // ✅ Rate limit: 200 requests per second globally
           await globalRateLimiter.consume("global");
      // Optional: show typing action
      await ctx.sendChatAction("upload_photo");

      // Show logo
      await ctx.replyWithPhoto({ source: LOGO_PATH });

      // Try to find user
      const user = await User.findOne({ telegramId });

      if (user) {
        await ctx.reply("👋 Welcome back! Choose an option below.", buildMainMenu(user));
      } else {
        await ctx.reply(
          "👋 Welcome! Please register first to access the demo. Click the button below to register.",
          {
            reply_markup: {
              inline_keyboard: [[{ text: "🔐 Register", callback_data: "register" }]]
            }
          }
        );
      }
    } catch (error) {
      if (error && error.msBeforeNext) {
        return ctx.reply("⚠️ Please wait a second before trying again.");
      }
      console.error("❌ Error in /start command:", error);
      await ctx.reply("🚫 An error occurred while loading. Please try again shortly.");
    }
  });
};
