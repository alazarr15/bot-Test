const User = require("../Model/user");
const { buildMainMenu } = require("../utils/menuMarkup");
const { userRateLimiter, globalRateLimiter } = require("../Limit/global");

// You must either define clearAllFlows here or import it
// from the callbackQueryHandler.js file.
async function clearAllFlows(telegramId) {
    await User.findOneAndUpdate({ telegramId }, {
        $set: {
            withdrawalInProgress: null,
            transferInProgress: null,
            registrationInProgress: null,
            usernameChangeInProgress: null,
             depositInProgress: {
          step: null,
          amount: null,
          depositType: null,
          txId: null,
          timestamp: null
        }
        }
    });
}

module.exports = function (bot) {
    bot.command("change_username", async (ctx) => {
        const telegramId = ctx.from.id;

        try {
            // Apply rate limiting
            await userRateLimiter.consume(telegramId);
            await globalRateLimiter.consume("global");

            const user = await User.findOne({ telegramId });
            if (!user) {
                return ctx.reply("🚫 You must register first to change your username.");
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