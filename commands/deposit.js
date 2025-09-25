// commands/deposit.js

const User = require("../Model/user");
const { userRateLimiter, globalRateLimiter } = require("../Limit/global");
const { clearAllFlows } = require("../utils/flowUtils");


module.exports = function (bot) {
    bot.command("deposit", async (ctx) => {
        const telegramId = ctx.from.id;

        try {
            // ✅ Apply rate limiting
            await Promise.all([
                userRateLimiter.consume(telegramId),
                globalRateLimiter.consume("global"),
            ]);

           const user = await User.findOne({ telegramId });

// Check if the user exists and if they have a phone number
if (!user || !user.phoneNumber) {
  // If the user doesn't exist OR they don't have a phone number,
  // they are not fully registered.
  return ctx.reply("🚫 You must register first to check your balance. Please click below to register:", {
    reply_markup: {
      inline_keyboard: [[{ text: "🔐 Register", callback_data: "register" }]]
    }
  });
}
            // ✅ CORRECTED: Clear all other in-progress flows before starting this one.
            await clearAllFlows(telegramId);
            
            return ctx.reply("💰 የገንዘብ ማስገቢያ ዘዴ ይምረጡ:", {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: "Manual", callback_data: "manual_deposit" }],
                    ]
                }
            });
        } catch (err) {
            if (err && err.msBeforeNext) {
                return ctx.reply("⚠️ Please wait a second before trying again.");
            }
            console.error("❌ Error in /deposit command:", err.message);
            return ctx.reply("🚫 An error occurred. Please try again.");
        }
    });
};