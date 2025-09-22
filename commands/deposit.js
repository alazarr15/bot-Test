const User = require("../Model/user");
const { userRateLimiter, globalRateLimiter } = require("../Limit/global");

// You should define this function or import it if it's already defined elsewhere.
// For example, if it's in a utils file.
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
    bot.command("deposit", async (ctx) => {
        const telegramId = ctx.from.id;

        try {
            // ✅ Apply rate limiting
            await Promise.all([
                userRateLimiter.consume(telegramId),
                globalRateLimiter.consume("global"),
            ]);

            const user = await User.findOne({ telegramId });

            if (!user) {
                return ctx.reply("🚫 You must register first to make a deposit. Please click below to register:", {
                    reply_markup: {
                        inline_keyboard: [[{ text: "🔐 Register", callback_data: "register" }]]
                    }
                });
            }

            // ⭐ CORRECTED: Clear all other in-progress flows before starting this one.
            await clearAllFlows(telegramId);
            
            // ⭐ NEW: Set the depositInProgress flag
            await User.findOneAndUpdate({ telegramId }, { $set: { depositInProgress: { active: true, step: 'start' } } });
            
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

    // Handle 'deposit' and 'deposit_callback' data
    bot.on('callback_query', async (ctx) => {
        const data = ctx.callbackQuery.data;
        const telegramId = ctx.from.id;

        if (data === "deposit" || /^deposit_\d+$/.test(data)) {
            try {
                // ⭐ NEW: Clear any active flows before starting a new one
                await clearAllFlows(telegramId);
                await ctx.answerCbQuery();
                const user = await User.findOne({ telegramId });

                if (!user) {
                    return ctx.reply("🚫 You must register first to make a deposit.", {
                        reply_markup: {
                            inline_keyboard: [[{ text: "🔐 Register", callback_data: "register" }]]
                        }
                    });
                }

                // ⭐ NEW: Set the depositInProgress flag
                await User.findOneAndUpdate({ telegramId }, { $set: { depositInProgress: { active: true, step: 'start' } } });

                return ctx.reply("💰 የገንዘብ ማስገቢያ ዘዴ ይምረጡ:", {
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: "Manual", callback_data: "manual_deposit" }]
                        ]
                    }
                });
            } catch (err) {
                console.error("❌ Error in deposit callback handler:", err.message);
                return ctx.reply("🚫 An error occurred. Please try again.");
            }
        }

        // Handle 'manual_deposit' callback
        if (data === "manual_deposit") {
            await ctx.answerCbQuery();
            return ctx.scene.enter("manualDeposit");
        }
    });
};
