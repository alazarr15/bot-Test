const User = require("../Model/user");
const { userRateLimiter, globalRateLimiter } = require("../Limit/global");

// Import or define clearAllFlows
async function clearAllFlows(telegramId) {
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
}

module.exports = function (bot) {
  bot.command("balance", async (ctx) => {
    const telegramId = ctx.from.id;

    try {
      // ✅ Apply rate limits
      await userRateLimiter.consume(telegramId);
      await globalRateLimiter.consume("global");

      // ✅ Clear any in-progress flows before showing balance
      await clearAllFlows(telegramId);

      const user = await User.findOne({ telegramId });

      if (!user) {
        return ctx.reply(
          "🚫 You must register first to check your balance. Please click below to register:",
          {
            reply_markup: {
              inline_keyboard: [
                [{ text: "🔐 Register", callback_data: "register" }],
              ],
            },
          }
        );
      }

      const withdrawable = user.balance ?? 0;
      const bonus = user.bonus_balance ?? 0;

      return ctx.reply(
        `💰 **Your Balances:**\n- **Withdrawable Balance:** *${withdrawable} Birr*\n- **Bonus Balance:** *${bonus} Birr*`,
        { parse_mode: "Markdown" }
      );
    } catch (error) {
      if (error?.msBeforeNext || error?.name === "RateLimiterRes") {
        return ctx.reply("⚠️ You're doing that too fast. Please wait a second.");
      }

      console.error("❌ Error in /balance:", error.message || error);
      return ctx.reply("🚫 Failed to fetch your balance. Please try again.");
    }
  });
};
