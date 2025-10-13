const { userRateLimiter, globalRateLimiter } = require("../Limit/global");

module.exports = function (bot) {
    bot.command("invite", async (ctx) => {
        return handleInvite(ctx);
    });

    bot.action("invite", async (ctx) => {
        return handleInvite(ctx);
    });

    // The 'copied' action is removed as the new button directly shares the link.

    async function handleInvite(ctx) {
        const telegramId = ctx.from.id;
        const triggerType = ctx.callbackQuery ? 'Callback Action' : 'Command';
        
        //console.log(`[INVITE] - START - User ${telegramId} triggered /invite via ${triggerType}.`);

        try {
            // --- STEP 1: Rate Limiting ---
        //    console.log(`[INVITE] - STEP 1 - Starting rate limit checks for ${telegramId}.`);
            
            // ✅ Rate limit: 1 request per second per user
            await userRateLimiter.consume(telegramId);
            
            // ✅ Rate limit: 200 requests per second globally
            await globalRateLimiter.consume("global");

        //    console.log(`[INVITE] - STEP 1 - Rate limits passed for ${telegramId}.`);

            if (ctx.callbackQuery) {
                await ctx.answerCbQuery();
        //        console.log(`[INVITE] - Callback query answered for ${telegramId}.`);
            }

            // --- STEP 2: Link Generation ---
            const botUsername = 'Danbingobot';
            const inviteLink = `https://t.me/${botUsername}?start=${telegramId}`;
        //    console.log(`[INVITE] - STEP 2 - Generated invite link: ${inviteLink}`);

            // 1. The message content that your user will share
            const shareMessageContent = `
🎉 *Hey friends!* 🎉

✨ Be one of the *early players* in *DAN BINGO* and claim your exclusive bonus!  

🎁 Special rewards are waiting — but only for a limited time!  

🔗 Click here to join: ${inviteLink}

Don’t wait — the fun and rewards are just a tap away! 🎲💸
`;
            
            // 2. The special Telegram URL scheme to trigger the share sheet
            // NOTE: The shareMessage must be URL encoded.
            const telegramShareUrl = `tg://msg?text=${encodeURIComponent(shareMessageContent.trim())}`;
        //    console.log(`[INVITE] - STEP 2 - Telegram Share URL created.`);

            // 3. The message that is sent to the user when they hit /invite or the button
            const replyMessage = `
🎉 *Invite & Earn!*

You can earn rewards by inviting friends! Click the **Invite Friends** button below to share your unique link.

👤 *Your Invite Link:*
\`${inviteLink}\`
            `;

            // --- STEP 3: Sending Reply ---
            const replyOptions = {
                reply_markup: {
                    inline_keyboard: [
                        [{
                            text: "📩 Invite Friends",
                            // Use 'url' button with the Telegram share scheme
                            url: telegramShareUrl
                        }]
                    ]
                }
            };
            
        //    console.log(`[INVITE] - STEP 3 - Sending final reply to ${telegramId}.`);

            const result = await ctx.replyWithMarkdown(replyMessage.trim(), replyOptions);
            
        //    console.log(`[INVITE] - SUCCESS - Reply sent successfully to ${telegramId}. Message ID: ${result.message_id}`);
            return result;
            
        } catch (err) {
            
            // --- ERROR HANDLING ---
            if (err && err.msBeforeNext) {
                // Rate Limit Error
        //        console.warn(`[INVITE] - RATE LIMIT - User ${telegramId} hit rate limit. Wait time: ${err.msBeforeNext}ms.`);
                return ctx.reply("⚠️ Please wait a second before trying again.");
            }
            
            // All Other Errors (The likely source of "Something went wrong")
        //    console.error(`[INVITE] - ❌ CRITICAL ERROR for user ${telegramId} (${triggerType}):`);
            // Log the full error stack for maximum debugging information
        //    console.error(err); 
            
            return ctx.reply("🚫 Something went wrong. Please try again later. (Error logged on server)");
        }
    }
};