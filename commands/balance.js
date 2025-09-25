const User = require("../Model/user");
const { userRateLimiter, globalRateLimiter } = require("../Limit/global");

module.exports = function (bot) {
  bot.command("balance", async (ctx) => {
    const telegramId = ctx.from.id;

    try {
      // ✅ Rate limit: 1 request per user
      await userRateLimiter.consume(telegramId);

      // ✅ Rate limit: 200 requests globally
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

      // ⭐ New: Display both balances
      return ctx.reply(`💰 **Your Balances:**
- **Withdrawable Balance:** *${user.balance} Birr*
- **Bonus Balance:** *${user.bonus_balance || 0} Birr*`, {
        parse_mode: "Markdown"
      });

    } catch (error) {
      if (error && error.msBeforeNext) {
        return ctx.reply("⚠️ You're doing that too fast. Please wait a second.");
      }

      console.error("❌ Error in /balance:", error.message || error);
      return ctx.reply("🚫 Failed to fetch your balance. Please try again.");
    }
  });
};