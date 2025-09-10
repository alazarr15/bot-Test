const User = require("../Model/user");
const { userRateLimiter, globalRateLimiter } = require("../Limit/global");

// ✅ IMPORT the reusable function from its file
const { sendPlayDemoOptions } = require('../handlers/PlayDemoOptions'); // Make sure the path is correct

module.exports = function (bot) {
  bot.command("playdemo", async (ctx) => {
    try {
      const telegramId = ctx.from.id;

      // ✅ Rate limit: 1 request per second per user
      await userRateLimiter.consume(telegramId);
     
      // ✅ Rate limit: 200 requests per second globally
      await globalRateLimiter.consume("global");

      // ✅ REPLACE the hard-coded logic with a single function call
      await sendPlayDemoOptions(ctx);

    } catch (err) {
      if (err && err.msBeforeNext) {
        return ctx.reply("⚠️ Please wait a second before trying again.");
      }
      console.error("❌ Error in /playdemo command:", err.message);
      return ctx.reply("🚫 Failed to show demo options. Please try again later.");
    }
  });
};