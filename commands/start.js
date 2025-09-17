// In your start.js file

const User = require("../Model/user");
const path = require("path");
const { buildMainMenu } = require("../utils/menuMarkup");
const { userRateLimiter, globalRateLimiter } = require("../Limit/global");

const LOGO_PATH = path.join(__dirname, "..", "images", "luckybingo2.png");

module.exports = function (bot) {
  bot.start(async (ctx) => {
    try {
      const telegramId = ctx.from.id;

      await userRateLimiter.consume(telegramId);
      await globalRateLimiter.consume("global");

      await ctx.sendChatAction("upload_photo");
      await ctx.replyWithPhoto({ source: LOGO_PATH });

      // ⭐ FIND THE USER (No changes here)
      const user = await User.findOne({ telegramId });

      if (user && user.phoneNumber) {
        console.log(`User ${telegramId} already exists. Showing main menu.`);
        await ctx.reply("👋 Welcome back! Choose an option below.", buildMainMenu(user));
      } else {
        // ⭐ NEW: If the user is new, just create a basic document.
        // DO NOT set the registrationInProgress flag here.
        const referrerId = ctx.startPayload;
        
        await User.findOneAndUpdate(
          { telegramId },
          {
            telegramId,
            referrerId: (referrerId && referrerId !== telegramId.toString()) ? referrerId : null
          },
          { new: true, upsert: true }
        );

        console.log(`New user ${telegramId} started the bot. Referrer ID: ${referrerId || 'None'}`);

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