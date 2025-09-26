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

      await ctx.sendChatAction("upload_photo");
      await ctx.replyWithPhoto({ source: LOGO_PATH });

      // Find the user by their unique telegramId
      const user = await User.findOne({ telegramId });

      // ===================================================
      // 🚀 The improved logic starts here
      // ===================================================

      // Case 1: The user exists and has a phone number (fully registered)
      if (user && user.phoneNumber) {
        await ctx.reply("👋 Welcome back! Choose an option below.", buildMainMenu(user));
      } 
      
      // Case 2: The user is not fully registered and is in the registration flow
      else if (user && user.registrationInProgress && user.registrationInProgress.step === 1) {
        await ctx.reply(
          "📲 It looks like you didn't complete your registration. Please share your contact by clicking the button below.",
          {
            reply_markup: {
              keyboard: [[{ text: "📞 Share Contact", request_contact: true }]],
              one_time_keyboard: true,
              resize_keyboard: true,
            },
          }
        );
      } 
      
      // Case 3: The user does not exist at all (brand new user)
      else {
        // The rest of your existing logic for a new user remains the same
        await ctx.reply(
          "👋 Welcome! Please register first to access the demo. Click the button below to register.",
          {
            reply_markup: {
              inline_keyboard: [[{ text: "🔐 Register", callback_data: "register" }]]
            }
          }
        );
      }
      
      // ===================================================
      // 🚀 The improved logic ends here
      // ===================================================

    } catch (error) {
      if (error && error.msBeforeNext) {
        return ctx.reply("⚠️ Please wait a second before trying again.");
      }
      console.error("❌ Error in /start command:", error);
      await ctx.reply("🚫 An error occurred while loading. Please try again shortly.");
    }
  });
};
