const User = require("../Model/user");
const { userRateLimiter, globalRateLimiter } = require("../Limit/global");

module.exports = function (bot) {
  bot.command("check_withdrwal", async (ctx) => {
    const telegramId = ctx.from.id;

    try {
      // ✅ Rate limit: 1 request per second per user
      await userRateLimiter.consume(telegramId);

      // ✅ Rate limit: 200 requests per second globally
      await globalRateLimiter.consume("global");

      let user = await User.findOne({ telegramId });

      if (!user) {
        return ctx.reply("🚫 You must register first before checking a withdrawal. Click below to register:", {
          reply_markup: {
            inline_keyboard: [[{ text: "🔐 Register", callback_data: "register" }]],
          },
        });
      }

      return ctx.reply(
        "🔍 Click the button below to check your withdrawal status:\n\n💡 Make sure you have your *Transaction Reference (tx_ref)* copied.",
        {
          parse_mode: "Markdown",
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text: "📄 Check Withdrawal",
                  web_app: {
                    url: `https://bossbingo.netlify.app/Check-Withdraw/?user=${telegramId}`,
                  },
                },
              ],
            ],
          },
        }
      );
    } catch (error) {
      if (error && error.msBeforeNext) {
        return ctx.reply("⚠️ Please wait a second before trying again.");
      }
      console.error("❌ Error in /check_withdrwal command:", error.message);
      return ctx.reply("🚫 Failed to process your request. Please try again later.");
    }
  });
};
