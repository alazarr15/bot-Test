// handlers/callbackQueryHandler.js
// This file handles all Telegram callback queries and queues long-running tasks.

const User = require("../Model/user");
const Withdrawal = require("../Model/withdrawal");
const { registrationInProgress } = require("./state/registrationState");
const { userRateLimiter, globalRateLimiter } = require("../Limit/global");
const { userWithdrawalStates } = require("./state/withdrawalState");
const { processTelebirrWithdrawal } = require('./telebirrWorker.js');
const { getDriver, resetDriver } = require('./appiumService.js'); // 👈 Using the new service

const telebirrWithdrawalQueue = [];

const processQueue = (bot) => {
    // The driver state is now managed within the appiumService.

    const runWorker = async () => {
        console.log("🔄 Starting Telebirr withdrawal queue processor...");

        while (true) {
            let task = null;

            try {
                // ✅ Simplified driver management. The service handles creation/reconnection.
                const driver = await getDriver();

                if (telebirrWithdrawalQueue.length > 0) {
                    task = telebirrWithdrawalQueue.shift();
                    const { telegramId, amount, account_number, withdrawalRecordId } = task;

                    console.log(`🚀 Starting Telebirr withdrawal task for user ${telegramId}`);

                    const result = await processTelebirrWithdrawal({ driver, amount, account_number });
                    console.log("🔍 Telebirr worker result:", JSON.stringify(result, null, 2));

                    const isSuccess = result?.status === "success" || result?.message?.toLowerCase().includes("completed");

                    const withdrawalRecord = await Withdrawal.findById(withdrawalRecordId);
                    if (withdrawalRecord) {
                        withdrawalRecord.status = isSuccess ? "completed" : "failed";
                        if (result?.data?.tx_ref) {
                            withdrawalRecord.tx_ref = result.data.tx_ref;
                        }
                        await withdrawalRecord.save();

                        if (isSuccess) {
                        withdrawalRecord.status = "completed";
                        // ... (update tx_ref if available)
                        await withdrawalRecord.save();
                        } else {
                        // ↩️ REFUND STEP (Graceful Failure): The worker failed, so refund the user.
                        withdrawalRecord.status = "failed";
                        await withdrawalRecord.save();
                        
                        console.log(`Refunding ${amount} to user ${telegramId} due to failed withdrawal.`);
                        // Atomically add the amount back to the user's balance
                        await User.findOneAndUpdate({ telegramId }, { $inc: { balance: amount } });
                    }
                    }

                    try {
                        await bot.telegram.sendMessage(
                            Number(telegramId),
                            isSuccess
                                ? `✅ የ*${amount} ብር* ገንዘብ ማውጣትዎ በተሳካ ሁኔታ ተካሂዷൽ!`
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
                resetDriver(); // ✅ Tell the service to invalidate the driver

                if (task) {
                    console.error(`💀 Error processing task for user: ${task.telegramId}`);
                    try {
                        await Withdrawal.findByIdAndUpdate(task.withdrawalRecordId, { status: "failed" });

                        console.log(`Refunding ${task.amount} to user ${task.telegramId} due to critical error.`);
                        await User.findOneAndUpdate({ telegramId: task.telegramId }, { $inc: { balance: task.amount } });

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

        // ✅ Apply rate limiting before processing ANY callback
        try {
            await Promise.all([
                userRateLimiter.consume(telegramId),
                globalRateLimiter.consume("global")
            ]);
        } catch (rateLimitErr) {
            console.warn("⚠️ Rate limit triggered for", telegramId);
            return ctx.answerCbQuery("⏳ Too many requests. Please wait a second.");
        }

        // ⭐ Handle WITHDRAWAL callbacks
        if (data.startsWith("withdraw_")) {
            const userState = userWithdrawalStates.get(telegramId);
            if (!userState) {
                return ctx.answerCbQuery("🚫 This conversation has expired. Please start over with /withdraw.");
            }

            ctx.answerCbQuery();

            if (userState.step === "selectBank") {
                const bankCode = data.split("_")[1];
                userState.data.bank_code = bankCode;
                const withdrawalBanks = [{ name: "🏛 CBE", code: "946" }, { name: "📱 Telebirr", code: "855" }];
                userState.data.bank_name = withdrawalBanks.find(b => b.code === bankCode)?.name;
                userState.step = "getAmount";

                return ctx.reply(`**${userState.data.bank_name}** መርጠዋል። ለማውጣት የሚፈልጉትን መጠን ይጻፉ።`, {
                    parse_mode: 'Markdown'
                });
            }
            else if (userState.step === "confirm") {
    if (data === "withdraw_confirm") {
        const { amount, bank_code, account_number } = userState.data;

        // 🏦 STEP 1: Find the user and check their balance
        const user = await User.findOne({ telegramId });

        if (!user || user.balance < amount) {
            userWithdrawalStates.delete(telegramId); // Clean up state
            return ctx.editMessageText("🚫 Insufficient balance. Your withdrawal request has been cancelled.");
        }
        
        // 🏦 STEP 2: Hold the funds by deducting them BEFORE queueing
        user.balance -= amount;

            try {
                // This entire block must succeed. If it fails, we'll refund in the catch block.
                await user.save(); // Save the new lower balance

                await ctx.editMessageText("⏳ Your withdrawal is in the queue. We will notify you upon completion.");

                const withdrawal = new Withdrawal({
                    tx_ref: `TX-${Date.now()}-${telegramId}`,
                    telegramId: String(telegramId),
                    amount,
                    bank_code,
                    account_number,
                    status: 'pending'
                });

            const savedWithdrawal = await withdrawal.save();
            userWithdrawalStates.delete(telegramId);

                if (bank_code === "855") {
                    telebirrWithdrawalQueue.push({
                        telegramId,
                        amount,
                        account_number,
                        withdrawalRecordId: savedWithdrawal._id
                    });
                    console.log(`📥 Added withdrawal for ${telegramId} to queue. Balance held. Queue size: ${telebirrWithdrawalQueue.length}`);
                 }

                } catch (error) {
                    console.error("❌ Error submitting withdrawal request, REFUNDING user:", error);
                    
                    // ↩️ REFUND STEP: If saving the user/withdrawal or queueing fails, give the money back.
                    user.balance += amount;
                    await user.save(); 

                    userWithdrawalStates.delete(telegramId);
                    return await ctx.reply("🚫 An error occurred while submitting your request. Please try again. Your balance has not been changed.");
                }
                } else if (data === "withdraw_cancel") {
                    userWithdrawalStates.delete(telegramId);
                    await ctx.editMessageText("❌ Withdrawal request has been cancelled.", {
                        reply_markup: {
                            inline_keyboard: []
                        }
                    });
                }
            }
            return;
        }


        // Handle /register callback
        if (data === "register") {
            await ctx.answerCbQuery();

            const user = await User.findOne({ telegramId });
            if (user) {
                return ctx.reply(`ℹ️ You are already registered as *${user.username}*`, {
                    parse_mode: "Markdown"
                });
            }

            registrationInProgress[telegramId] = { step: 1 };

            return ctx.reply(
                "📲 To continue, tap 📞 Share Contact.\n\n❓ Don’t see the button? Tap the ▦ icon (with 4 dots) next to your message box.",
                {
                    reply_markup: {
                        keyboard: [
                            [
                                {
                                    text: "📞 Share Contact",
                                    request_contact: true
                                }
                            ]
                        ],
                        one_time_keyboard: true,
                        resize_keyboard: true
                    }
                }
            );
        }

        // Handle play callback
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

        // Handle 'deposit' callback
        if (data === "deposit" || /^deposit_\d+$/.test(data)) {
            try {
                await ctx.answerCbQuery();
                const user = await User.findOne({ telegramId });
                if (!user) {
                    return ctx.reply("🚫 You must register first to make a deposit.", {
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

        // Handle 'manual_deposit' callback
        if (data === "manual_deposit") {
            await ctx.answerCbQuery();
            return ctx.scene.enter("manualDeposit");
        }

        // Handle balance callback
        if (data === "balance") {
            try {
                await ctx.answerCbQuery();
                const user = await User.findOne({ telegramId });

                if (!user) {
                    return ctx.reply("🚫 You must register first to check your balance.", {
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

        // Handle invite callback
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

