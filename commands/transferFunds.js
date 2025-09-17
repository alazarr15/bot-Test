// commands/transferFundsCommand.js
const User = require("../Model/user");
const { userRateLimiter, globalRateLimiter } = require("../Limit/global");

module.exports = function (bot) {
    // Command to start fund transfer
    bot.command("transfer_funds", async (ctx) => {
        const telegramId = ctx.from.id;

        try {
            // ✅ Rate limit
            await userRateLimiter.consume(telegramId);
            await globalRateLimiter.consume("global");

            const user = await User.findOne({ telegramId });

            if (!user) {
                return ctx.reply("🚫 You must register first to transfer funds.");
            }

            // Check if another flow is already in progress
            if (user.withdrawalInProgress || user.usernameChangeInProgress || user.registrationInProgress) {
                return ctx.reply("🚫 You are currently in the middle of another operation. Please type /cancel to stop it before starting a new one.");
            }
            
            // Check if transfer is already in progress
            if (user.transferInProgress) {
                return ctx.reply("⚠️ You already have a transfer in progress. Please enter the recipient's phone number or type /cancel to abort.");
            }

            // ✅ Initialize the dedicated transfer flow state in the database
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