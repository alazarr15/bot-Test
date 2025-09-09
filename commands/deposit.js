// commands/deposit.js

const User = require("../Model/user");
const { userRateLimiter, globalRateLimiter } = require("../Limit/global");

module.exports = function (bot) {
  bot.command("deposit", async (ctx) => {
    const telegramId = ctx.from.id;

    try {
      // ✅ Apply rate limiting for the /deposit command
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

      // ✅ Provide both options for deposit
      //const depositUrl = `https://bossbingo.netlify.app/PaymentForm?user=${telegramId}`;

      return ctx.reply("💳 Choose how you want to deposit:", {
        reply_markup: {
          inline_keyboard: [
            [{ text: "Manual", callback_data: "manual_deposit" }],
            //[{ text: "🚀 Open Deposit Page", url: depositUrl }]
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
};
