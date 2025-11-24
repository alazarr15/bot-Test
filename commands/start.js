const User = require("../Model/user");
const path = require("path");
const { buildMainMenu } = require("../utils/menuMarkup");
const { userRateLimiter, globalRateLimiter } = require("../Limit/global");

const LOGO_PATH = path.join(__dirname, "..", "images", "ANNOUNCMENT.jpg");

module.exports = function (bot) {
  bot.start(async (ctx) => {
    try {
      const telegramId = ctx.from.id;

      // ✅ Rate limit: 1 request per second per user
      await userRateLimiter.consume(telegramId);

      // ✅ Rate limit: 200 requests per second global
      await globalRateLimiter.consume("global");

      await ctx.sendChatAction("upload_photo");
      await ctx.replyWithPhoto({ source: LOGO_PATH });

      // Find the user by their unique telegramId
      const user = await User.findOne({ telegramId });

      // ===================================================
      // Handle User Cases
      // ===================================================

      // Case 1: The user exists and has a phone number (fully registered)
      if (user && user.phoneNumber) {
        await ctx.reply("👋 Welcome back! Choose an option below.", buildMainMenu(user));
      } 
      
      // Case 2: The user is not fully registered but is mid-registration
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
            // --- 🚀 Referral Tracking Logic (Extract ID from /start <id>) ---
            // ONLY execute this logic if the user is new and we are creating a document.
            let referrerId = null;
            const startPayload = ctx.message.text.split(' ')[1]; // Extracts the ID after /start

            // 1. Check if a payload exists and the user is not trying to refer themselves
            if (startPayload && startPayload !== telegramId.toString()) {
                const potentialReferrerId = parseInt(startPayload, 10);
                
                // 2. Check if the potential referrer actually exists in the database
                const referrerExists = await User.findOne({ telegramId: potentialReferrerId });

                if (referrerExists) {
                    referrerId = potentialReferrerId; // Store the valid referrer ID
                    console.log(`[Referral] New user ${telegramId} tracked via referrer ${referrerId}`);
                }
            }
            // --- End Referral Tracking Logic ---

            // Create a new user document, storing the validated referrerId
            await User.create({
                telegramId,
                username: ctx.from.username,
                // Assign the referrerId captured above, will be null if no link was used
                referrerId: referrerId, 
                registrationInProgress: { step: 1 } // Start registration flow
            });

        await ctx.reply(
          "👋 Welcome! Please register first to access the game. Click the button below to register.",
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
