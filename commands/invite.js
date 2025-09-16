const { userRateLimiter, globalRateLimiter } = require("../Limit/global");

module.exports = function (bot) {
  bot.command("invite", async (ctx) => {
    return handleInvite(ctx);
  });

  bot.action("invite", async (ctx) => {
    return handleInvite(ctx);
  });

  bot.action("copied", async (ctx) => {
    await ctx.answerCbQuery("✅ Link copied!", { show_alert: false });
  });

  async function handleInvite(ctx) {
    try {
      const telegramId = ctx.from.id;

      // ✅ Rate limit: 1 request per second per user
           await userRateLimiter.consume(telegramId);
     
           // ✅ Rate limit: 200 requests per second globally
           await globalRateLimiter.consume("global");
      if (ctx.callbackQuery) await ctx.answerCbQuery();

      const inviteLink = `https://t.me/LuckyBingobot?start=${telegramId}`;

      const message = `
🎉 *Invite & Earn!*

👤 *Your Invite Link:*
\`${inviteLink}\`

📋 *click the button below to copy the link *, 
      `;

      return ctx.replyWithMarkdown(message.trim(), {
        reply_markup: {
          inline_keyboard: [[{ text: "✅Copied the Link", callback_data: "copied" }]]
        }
      });
    } catch (err) {
      if (err && err.msBeforeNext) {
        return ctx.reply("⚠️ Please wait a second before trying again.");
      }
      console.error("❌ Error in invite handler:", err.message);
      return ctx.reply("🚫 Something went wrong. Please try again later.");
    }
  }
};
