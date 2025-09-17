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

      const user = await User.findOne({ telegramId });

      if (user) {
        // ⭐ Case 1: Existing user. Log a message and show the main menu.
        console.log(`User ${telegramId} already exists. Showing main menu.`);
        await ctx.reply("👋 Welcome back! Choose an option below.", buildMainMenu(user));

      } else {
        // ⭐ Case 2: New user. Check for a referral payload.
        const referrerId = ctx.startPayload;

        // Create a new user document and set the referrerId if it exists and is not the user themselves
        // We use findOneAndUpdate with upsert: true to create or update the document in one call.
        // This also prevents race conditions if the user clicks start multiple times.
        await User.findOneAndUpdate(
          { telegramId },
          {
            telegramId,
            referrerId: (referrerId && referrerId !== telegramId.toString()) ? referrerId : null,
            registrationInProgress: true // Set the registration state
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