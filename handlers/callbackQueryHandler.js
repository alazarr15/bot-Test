// handlers/callbackQueryHandler.js
// This file handles all Telegram callback queries and queues long-running tasks.

const User = require("../Model/user");
const Withdrawal = require("../Model/withdrawal");
const { userRateLimiter, globalRateLimiter } = require("../Limit/global");
const { processTelebirrWithdrawal } = require('./telebirrWorker.js');


const telebirrWithdrawalQueue = [];

const processQueue = (bot) => {
    const runWorker = async () => {
        console.log("🔄 Starting Telebirr withdrawal queue processor...");
        while (true) {
            let task = null;
            try {
                if (telebirrWithdrawalQueue.length > 0) {
                    task = telebirrWithdrawalQueue.shift();
                    const { telegramId, amount, account_number, withdrawalRecordId } = task;
                    console.log(`🚀 Starting Telebirr withdrawal task for user ${telegramId}`);
                    const result = await processTelebirrWithdrawal({ amount, account_number });
                    const isSuccess = result?.status === "success" || result?.message?.toLowerCase().includes("completed");
                    const withdrawalRecord = await Withdrawal.findById(withdrawalRecordId);
                    if (withdrawalRecord) {
                        withdrawalRecord.status = isSuccess ? "completed" : "failed";
                        if (result?.data?.tx_ref) {
                            withdrawalRecord.tx_ref = result.data.tx_ref;
                        }
                        await withdrawalRecord.save();
                        if (isSuccess) {
                            const user = await User.findOne({ telegramId });
                            if (user) {
                                user.balance -= withdrawalRecord.amount;
                                if (user.balance < 0) user.balance = 0;
                                await user.save();
                            }
                        }
                    }
                    try {
                        await bot.telegram.sendMessage(
                            Number(telegramId),
                            isSuccess
                                ? `✅ የ*${amount} ብር* ገንዘብ ማውጣትዎ በተሳካ ሁኔታ ተካሂዷል!`
                                : `🚫 የ*${amount} ብር* ገንዘብ ማውጣትዎ አልተሳካም። እባክዎ ቆይተው እንደገና ይሞክሩ።`,
                            { parse_mode: "Markdown" }
                        );
                    } catch (msgErr) {
                        console.error(`❌ Failed to send final message to ${telegramId}:`, msgErr);
                    }
                    await new Promise(resolve => setTimeout(resolve, 2000));
                } else {
                    await new Promise(resolve => setTimeout(resolve, 5000));
                }
            } catch (loopErr) {
                console.error("🔥 A critical error occurred in the worker loop:", loopErr);
                if (task) {
                    console.error(`💀 Error processing task for user: ${task.telegramId}`);
                    try {
                        await Withdrawal.findByIdAndUpdate(task.withdrawalRecordId, { status: "failed" });
                        await bot.telegram.sendMessage(
                            Number(task.telegramId),
                            `🚫 A system error occurred while processing your withdrawal of *${task.amount} Birr*. Please contact support.`,
                            { parse_mode: "Markdown" }
                        );
                    } catch (recoveryErr) {
                        console.error("🚨 Failed to perform recovery actions:", recoveryErr);
                    }
                }
                await new Promise(resolve => setTimeout(resolve, 10000));
            }
        }
    };
    runWorker();
};

module.exports = function (bot) {
    processQueue(bot);
    bot.on("callback_query", async (ctx) => {
        const telegramId = ctx.from.id;
        const data = ctx.callbackQuery?.data;

        try {
            await Promise.all([
                userRateLimiter.consume(telegramId),
                globalRateLimiter.consume("global")
            ]);
        } catch (rateLimitErr) {
            console.warn("⚠️ Rate limit triggered for", telegramId);
            return ctx.answerCbQuery("⏳ Too many requests. Please wait a second.");
        }

        // --- Handle WITHDRAWAL callbacks ---
        if (data.startsWith("withdraw_")) {
            // ✅ UPDATED: Use the dedicated withdrawalInProgress field
            const user = await User.findOne({ telegramId });
            const userState = user?.withdrawalInProgress;
            if (!userState || !userState.step) {
                return ctx.answerCbQuery("🚫 This conversation has expired. Please start over with /withdraw.");
            }
            ctx.answerCbQuery();
            if (userState.step === "selectBank") {
                const bankCode = data.split("_")[1];
                userState.data.bank_code = bankCode;
                const withdrawalBanks = [{ name: "🏛 CBE", code: "946" }, { name: "📱 Telebirr", code: "855" }];
                userState.data.bank_name = withdrawalBanks.find(b => b.code === bankCode)?.name;
                userState.step = "getAmount";
                await User.findOneAndUpdate({ telegramId }, { withdrawalInProgress: userState });
                return ctx.reply(`**${userState.data.bank_name}** መርጠዋል። ለማውጣት የሚፈልጉትን መጠን ይጻፉ።`, {
                    parse_mode: 'Markdown'
                });
            } else if (userState.step === "confirm") {
                if (data === "withdraw_confirm") {
                    const { amount, bank_code, account_number } = userState.data;
                    try {
                        await ctx.editMessageText("⏳ ገንዘብ ማውጣት ሂደትዎ ተጀምሯል። በተጠናቀቀ ጊዜ እናሳዉቃለን [1-3] ደቂቃ ለመውጣት /cancel ይጻፉ።");
                        const withdrawal = new Withdrawal({
                            tx_ref: `TX-${Date.now()}-${telegramId}`,
                            telegramId: String(telegramId),
                            amount,
                            bank_code,
                            account_number,
                            status: 'pending'
                        });
                        const savedWithdrawal = await withdrawal.save();
                        // ✅ UPDATED: Clear the withdrawalInProgress field after completion
                        await User.findOneAndUpdate({ telegramId }, { withdrawalInProgress: null });
                        if (bank_code === "855") {
                            telebirrWithdrawalQueue.push({
                                telegramId,
                                amount,
                                account_number,
                                withdrawalRecordId: savedWithdrawal._id
                            });
                        }
                    } catch (error) {
                        console.error("❌ Error submitting withdrawal request:", error);
                        // ✅ UPDATED: Clear the withdrawalInProgress field on error
                        await User.findOneAndUpdate({ telegramId }, { withdrawalInProgress: null });
                        return await ctx.reply("🚫 An error occurred while submitting your request. Please try again.");
                    }
                } else if (data === "withdraw_cancel") {
                    // ✅ UPDATED: Clear the withdrawalInProgress field on cancellation
                    await User.findOneAndUpdate({ telegramId }, { withdrawalInProgress: null });
                    await ctx.editMessageText("❌ Withdrawal request has been cancelled.", {
                        reply_markup: {
                            inline_keyboard: []
                        }
                    });
                }
            }
            return;
        }

        // --- Handle other callbacks ---
        if (data === "register") {
            await ctx.answerCbQuery();
            const user = await User.findOne({ telegramId });
            if (user) {
                return ctx.reply(`ℹ️ You are already registered as *${user.username}*`, {
                    parse_mode: "Markdown"
                });
            }
            // ✅ UPDATED: Use the dedicated registrationInProgress field
            await User.findOneAndUpdate({ telegramId }, { registrationInProgress: { step: 1 } }, { upsert: true });
            return ctx.reply(
                "📲 To continue, tap 📞 Share Contact.\n\n❓ Don’t see the button? Tap the ▦ icon (with 4 dots) next to your message box.",
                {
                    reply_markup: {
                        keyboard: [
                            [{ text: "📞 Share Contact", request_contact: true }]
                        ],
                        one_time_keyboard: true,
                        resize_keyboard: true
                    }
                }
            );
        }
        if (data === "Play") {
            try {
                await ctx.answerCbQuery();
                const user = await User.findOne({ telegramId });
                if (!user) {
                    return ctx.reply("🚫 You must register first. Please click below to register:", {
                        reply_markup: {
                            inline_keyboard: [[{ text: "🔐 Register", callback_data: "register" }]]
                        }
                    });
                }
                return ctx.reply("🎮 Choose your game:", {
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: "10 Birr", web_app: { url: `https://frontend.bingoogame.com/?user=${telegramId}&game=10` } }],
                            [{ text: "20 Birr", web_app: { url: `https://frontend.bingoogame.com/?user=${telegramId}&game=20` } }],
                            [{ text: "30 Birr", web_app: { url: `https://frontend.bingoogame.com/?user=${telegramId}&game=30` } }],
                            [{ text: "40 Birr", web_app: { url: `https://frontend.bingoogame.com/?user=${telegramId}&game=40` } }]
                        ]
                    }
                });
            } catch (err) {
                console.error("❌ Error in play callback:", err.message);
                return ctx.reply("🚫 Something went wrong. Please try again later.");
            }
        }
        if (data === "deposit" || /^deposit_\d+$/.test(data)) {
            try {
                await ctx.answerCbQuery();
                const user = await User.findOne({ telegramId });
                if (!user) {
                    return ctx.reply("🚫 You must register first to make a deposit. Please click below to register:", {
                        reply_markup: {
                            inline_keyboard: [[{ text: "🔐 Register", callback_data: "register" }]]
                        }
                    });
                }
                return ctx.reply("💰 የገንዘብ ማስገቢያ ዘዴ ይምረጡ:", {
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: "Manual", callback_data: "manual_deposit" }]
                        ]
                    }
                });
            } catch (err) {
                console.error("❌ Error in deposit callback handler:", err.message);
                return ctx.reply("🚫 An error occurred. Please try again.");
            }
        }
        if (data === "manual_deposit") {
            await ctx.answerCbQuery();
            return ctx.scene.enter("manualDeposit");
        }
        if (data === "balance") {
            try {
                await ctx.answerCbQuery();
                const user = await User.findOne({ telegramId });
                if (!user) {
                    return ctx.reply("🚫 You must register first to check your balance. Please click below to register:", {
                        reply_markup: {
                            inline_keyboard: [[{ text: "🔐 Register", callback_data: "register" }]]
                        }
                    });
                }
                return ctx.reply(`💰 ቀሪ ሒሳብዎ: *${user.balance} ብር*`, {
                    parse_mode: "Markdown"
                });
            } catch (error) {
                console.error("❌ Error in callback balance:", error.message);
                return ctx.reply("🚫 Failed to fetch your balance. Please try again.");
            }
        }
        if (data === "invite") {
            await ctx.answerCbQuery();
            const inviteLink = `https://t.me/Danbingobot?start=${telegramId}`;
            const message = `
🎉 *Invite & Earn!*
Share Boss Bingo with your friends and earn rewards when they join using your link.
👤 *Your Invite Link:*
\`${inviteLink}\`
📋 *Click the button below to copy the link*
            `;
            return ctx.replyWithMarkdown(message.trim(), {
                reply_markup: {
                    inline_keyboard: [[{ text: "✅ Copied the Link", callback_data: "copied" }]]
                }
            });
        }
        console.warn(`⚠️ Unhandled callback data: ${data}`);
        return;
    });
    bot.action("copied", async (ctx) => {
        await ctx.answerCbQuery("✅ Link copied!", { show_alert: false });
    });
};