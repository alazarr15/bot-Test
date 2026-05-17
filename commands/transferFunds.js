const User = require("../Model/user");
const { userRateLimiter, globalRateLimiter } = require("../Limit/global");
const { clearAllFlows } = require("../utils/flowUtils");
const { updateUserCache } = require("../utils/updateUserCache");

module.exports = function (bot) {
    bot.command("transfer_funds", async (ctx) => {
        const telegramId = ctx.from.id;

        try {
            // Apply rate limiting
            await userRateLimiter.consume(telegramId);
            await globalRateLimiter.consume("global");

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

            // Initialize the dedicated transfer flow state in the database
            await User.updateOne(
                { telegramId },
                { $set: { transferInProgress: { step: 1, recipient: null, amount: 0 } } }
            );

            return ctx.reply("🔢 Please enter the recipient's phone number:");
        } catch (error) {
            if (error && error.msBeforeNext) {
                return ctx.reply("⚠️ Please wait a moment before trying again.");
            }
            console.error("❌ Error in /transfer_funds command:", error);
            return ctx.reply("🚫 An error occurred. Please try again later.");
        }
    });
};