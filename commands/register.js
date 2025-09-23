// commands/register.js

const User = require("../Model/user");
const { userRateLimiter, globalRateLimiter } = require("../Limit/global");

// Define or import the function
async function clearAllFlows(ctx) {
    const telegramId = ctx.from.id;

    // 1. Clear DB states
    await User.findOneAndUpdate(
        { telegramId },
        {
            $set: {
                withdrawalInProgress: null,
                transferInProgress: null,
                registrationInProgress: null,
                usernameChangeInProgress: null,
            },
        }
    );

    // 2. Exit wizard if user is stuck in one
    if (ctx.scene && ctx.scene.current) {
        await ctx.scene.leave();
    }

    // 3. Reset session scratchpad if exists
    if (ctx.session) {
        ctx.session.depositInProgress = null;
        if (ctx.wizard) {
            ctx.wizard.state = {};
        }
    }
}

module.exports = function (bot) {
    bot.command("register", async (ctx) => {
        try {
            const telegramId = ctx.from.id;

            // ✅ Apply rate limiting
            await userRateLimiter.consume(telegramId);
            await globalRateLimiter.consume("global");

            const user = await User.findOne({ telegramId });

            // ✅ CORRECTED: Clear all other in-progress flows before starting this one.
            await clearAllFlows(telegramId);

            if (user) {
                return ctx.reply(`ℹ️ You are already registered as *${user.username}*`, {
                    parse_mode: "Markdown"
                });
            }

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