const User = require("../Model/user");
    
const { userRateLimiter, globalRateLimiter } = require("../Limit/global");
const { clearAllFlows } = require("../utils/flowUtils");

module.exports = function (bot) {
    bot.command("change_username", async (ctx) => {
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
            // ✅ CORRECTED: Clear all other in-progress flows before starting this one
            await clearAllFlows(telegramId);

            // Set the new persistent state for this flow
            await User.findOneAndUpdate({ telegramId }, {
                usernameChangeInProgress: { step: 1 }
            });

            return ctx.reply(
                "📝 እባክዎ አዲስ USERNAME ይጻፉ (ቢያንስ 3 ፊደሎች)\nለመውጣት /cancel ይጻፉ።"
            );
        } catch (error) {
            if (error && error.msBeforeNext) {
                return ctx.reply("⚠️ Please wait a second before trying again.");
            }
            console.error(`❌ Error in /change_username command: ${error.message}`);
            return ctx.reply("🚫 An error occurred. Please try again later.");
        }
    });
};