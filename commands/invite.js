const { userRateLimiter, globalRateLimiter } = require("../Limit/global");

module.exports = function (bot) {
  bot.command("invite", async (ctx) => {
    return handleInvite(ctx);
  });

  bot.action("invite", async (ctx) => {
    return handleInvite(ctx);
  });

  // The 'copied' action is removed as the new button directly shares the link.
  // If you still want a button that *only* copies, you would keep the old
  // button and this action.

  async function handleInvite(ctx) {
    try {
      const telegramId = ctx.from.id;

      // ✅ Rate limit: 1 request per second per user
           await userRateLimiter.consume(telegramId);
     
           // ✅ Rate limit: 200 requests per second globally
           await globalRateLimiter.consume("global");

      if (ctx.callbackQuery) await ctx.answerCbQuery();

      // IMPORTANT: Replace 'LuckyBingobot' with your actual bot's username!
      const botUsername = 'LuckyBingobot'; 
      const inviteLink = `https://t.me/${botUsername}?start=${telegramId}`;

      // 1. The message content that your user will share
      const shareMessage = `
💰 *GO BINGO!* 🏆
I'm earning rewards just by playing! Join me using my invite link below for a special bonus:

🔗 ${inviteLink}

Start playing today!
      `;

      // 2. The special Telegram URL scheme to trigger the share sheet
      const telegramShareUrl = `tg://msg?text=${encodeURIComponent(shareMessage.trim())}`;


      // 3. The message that is sent to the user when they hit /invite or the button
      const replyMessage = `
🎉 *Invite & Earn!*

You can earn rewards by inviting friends! Click the **Invite Friends** button below to share your unique link.

👤 *Your Invite Link:*
\`${inviteLink}\`
      `;

      return ctx.replyWithMarkdown(replyMessage.trim(), {
        reply_markup: {
          inline_keyboard: [
              [{ 
                  text: "📩 Invite Friends", 
                  // Use 'url' button with the Telegram share scheme
                  url: telegramShareUrl 
              }]
          ]
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