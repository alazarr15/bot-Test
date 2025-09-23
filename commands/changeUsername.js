const User = require("../Model/user");
const { buildMainMenu } = require("../utils/menuMarkup");
const { userRateLimiter, globalRateLimiter } = require("../Limit/global");

// ✅ Clear all in-progress flows (DB + Wizard/Session)
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
    bot.command("change_username", async (ctx) => {
        try {
            const telegramId = ctx.from.id;

            // Apply rate limiting
            await Promise.all([
                userRateLimiter.consume(telegramId),
                globalRateLimiter.consume("global"),
            ]);

            const user = await User.findOne({ telegramId });
            if (!user) {
                return ctx.reply("🚫 You must register first to change your username.");
            }

            // ✅ Clear all other flows (DB + Wizard + Session)
            await clearAllFlows(ctx);

            // Set new state for this flow
            await User.findOneAndUpdate(
                { telegramId },
                { usernameChangeInProgress: { step: 1 } }
            );

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
