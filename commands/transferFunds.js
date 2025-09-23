const User = require("../Model/user");
const { userRateLimiter, globalRateLimiter } = require("../Limit/global");

// You should define this function or import it if it's already defined elsewhere.
async function clearAllFlows(telegramId) {
    await User.findOneAndUpdate({ telegramId }, {
        $set: {
            withdrawalInProgress: null,
            transferInProgress: null,
            registrationInProgress: null,
            usernameChangeInProgress: null,
            depositInProgress: null
        }
    });
}

module.exports = function (bot) {
    bot.command("transfer_funds", async (ctx) => {
        const telegramId = ctx.from.id;

        try {
            // Apply rate limiting
            await userRateLimiter.consume(telegramId);
            await globalRateLimiter.consume("global");

            const user = await User.findOne({ telegramId });

            if (!user) {
                return ctx.reply("🚫 You must register first to transfer funds.");
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