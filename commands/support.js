const { userRateLimiter, globalRateLimiter } = require("../Limit/global");

module.exports = function (bot) {
  const supportUsername = "luckybingoss"; // Telegram username without @
  const supportLink = `https://t.me/${supportUsername}`;

  const supportMessage = `📞 Need help? Contact support here: [Support Chat](${supportLink})`;

  bot.action("support", async (ctx) => {
    try {
      const telegramId = ctx.from.id;

      // ✅ Apply both user and global rate limiters
      await Promise.all([
        userRateLimiter.consume(telegramId),
        globalRateLimiter.consume("global")
      ]);

      await ctx.answerCbQuery(); // Acknowledge the callback query promptly

      return await ctx.reply(supportMessage, {
        parse_mode: "Markdown"
      });

    } catch (error) {
      if (error && error.msBeforeNext) {
        return ctx.answerCbQuery("⚠️ Please wait a second before trying again.", { show_alert: true });
      }

      console.error("❌ Error sending support message (callback):", error);
      return ctx.reply("🚫 Unable to show support info right now. Try again later.");
    }
  });
};
