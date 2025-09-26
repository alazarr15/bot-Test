const User = require("../Model/user");
const { userRateLimiter, globalRateLimiter } = require("../Limit/global");
const { clearAllFlows } = require("../utils/flowUtils");
const { buildMainMenu } = require("../utils/menuMarkup");

module.exports = function (bot) {
    bot.command("register", async (ctx) => {
        try {
            const telegramId = ctx.from.id;

            // ✅ Apply rate limiting
            await userRateLimiter.consume(telegramId);
            await globalRateLimiter.consume("global");

            // ✅ CORRECTED: Clear all other in-progress flows before starting this one.
            await clearAllFlows(telegramId);

            const user = await User.findOne({ telegramId });

            // ⭐ CORRECTED LOGIC: Check if the user is fully registered with a phoneNumber.
            if (user && user.phoneNumber) {
                // Send the first message and await its completion.
                await ctx.reply(`✅ You are already fully registered as *${user.username}*.`, {
                    parse_mode: "Markdown",
                    reply_markup: { inline_keyboard: [] }
                });
                // Return the second message to end the function's execution.
                return ctx.reply("🔄 Main menu:", buildMainMenu(user)); 
            }

            // ⭐ This section is reached ONLY if the user is not fully registered.
            // Set the new persistent state for this flow
            await User.findOneAndUpdate({ telegramId }, {
                registrationInProgress: { step: 1 }
            }, { upsert: true });

            return ctx.reply("📲 Please share your contact by clicking the button below.", {
                reply_markup: {
                    keyboard: [[{ text: "📞 Share Contact", request_contact: true }]],
                    one_time_keyboard: true,
                    resize_keyboard: true
                }
            });
        } catch (error) {
            if (error && error.msBeforeNext) {
                return ctx.reply("⚠️ Please wait a second before trying again.");
            }
            console.error("❌ Registration command failed:", error);
            return ctx.reply("🚫 An error occurred while starting registration.");
        }
    });
};
