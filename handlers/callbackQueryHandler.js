// handlers/callbackQueryHandler.js
// This file handles all Telegram callback queries and queues long-running tasks.

const User = require("../Model/user");
const Withdrawal = require("../Model/withdrawal");
const { registrationInProgress } = require("./state/registrationState");
const { userRateLimiter, globalRateLimiter } = require("../Limit/global");
const { userWithdrawalStates } = require("./state/withdrawalState");
const { processTelebirrWithdrawal } = require('./telebirrWorker_updated'); // ⚠️ UPDATED import to match the Canvas file.


// This array will act as a simple in-memory queue.
// In a production environment, you would use a dedicated message queue service like
// RabbitMQ, Redis Bull, or a cloud-based service like AWS SQS.
const telebirrWithdrawalQueue = [];

// ⚠️ IMPROVEMENT: Replaced setInterval with a recursive function call.
// This ensures that the next task is only processed AFTER the previous one has
// completed, preventing concurrency issues with the single automation device.
const processQueue = (bot) => {
    const processNextTask = async () => {
        if (telebirrWithdrawalQueue.length > 0) {
            const task = telebirrWithdrawalQueue.shift(); // Get the next task
            const { telegramId, amount, account_number, withdrawalRecordId } = task;

            console.log(`🚀 Starting Telebirr withdrawal task for user ${telegramId}`);

            try {
                // Here, you would call a function from your separate worker file.
                // Since we're in one code block, we'll import and call it directly.
                const result = await processTelebirrWithdrawal({ amount, account_number });

                // Update the database record based on the result
                const withdrawalRecord = await Withdrawal.findById(withdrawalRecordId);
                if (withdrawalRecord) {
                    withdrawalRecord.status = result.status === "success" ? "completed" : "failed";
                    withdrawalRecord.tx_ref = result.data?.tx_ref || withdrawalRecord.tx_ref;
                    await withdrawalRecord.save();
                }

                // Notify the user of the outcome
                if (result.status === "success") {
                    await bot.telegram.sendMessage(telegramId,
                        `✅ Your withdrawal of *${amount} Birr* to Telebirr has been completed successfully!`,
                        { parse_mode: 'Markdown' });
                } else {
                    await bot.telegram.sendMessage(telegramId,
                        `🚫 Your withdrawal of *${amount} Birr* to Telebirr failed. Please try again later.`,
                        { parse_mode: 'Markdown' });
                    console.error("❌ Telebirr withdrawal failed:", result.message);
                }

            } catch (error) {
                console.error("❌ Error processing Telebirr withdrawal from queue:", error);
                // Handle potential errors and notify the user
                const withdrawalRecord = await Withdrawal.findById(withdrawalRecordId);
                if (withdrawalRecord) {
                    withdrawalRecord.status = "failed";
                    await withdrawalRecord.save();
                    await bot.telegram.sendMessage(telegramId,
                        "🚫 An error occurred while processing your withdrawal. Please contact support.");
                }
            }
        }
        // Recursively call the function after a delay, ensuring one task runs at a time
        setTimeout(processNextTask, 5000);
    };

    // Start the queue processing loop
    processNextTask();
};


module.exports = function (bot) {
    // Start the queue processing loop when the bot starts
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

            ctx.answerCbQuery(); // Dismiss the loading indicator on the button

            if (userState.step === "selectBank") {
                const bankCode = data.split("_")[1];
                userState.data.bank_code = bankCode;
                const withdrawalBanks = [{ name: "🏛 CBE", code: "946" }, { name: "📱 Telebirr", code: "855" }];
                userState.data.bank_name = withdrawalBanks.find(b => b.code === bankCode)?.name;
                userState.step = "getAmount";

                return ctx.reply(`You chose **${userState.data.bank_name}**. Please reply with the amount you wish to withdraw:`, {
                    parse_mode: 'Markdown'
                });
            }

            // Handle final confirmation/cancellation
            else if (userState.step === "confirm") {
                if (data === "withdraw_confirm") {
                    const { amount, bank_code, account_number } = userState.data;

                    try {
                        await ctx.editMessageText("⏳ Your withdrawal request is being processed. We will notify you when it's complete.", {
                            reply_markup: {
                                inline_keyboard: [[{ text: "⌛️ In Review", callback_data: "ignore" }]]
                            }
                        });

                        const withdrawal = new Withdrawal({
                            tx_ref: `TX-${Date.now()}-${telegramId}`,
                            telegramId: String(telegramId),
                            amount,
                            bank_code,
                            account_number,
                            status: 'pending' // Initial status
                        });

                        // Save the withdrawal to the database immediately
                        const savedWithdrawal = await withdrawal.save();
                        userWithdrawalStates.delete(telegramId);

                        // If it's a Telebirr withdrawal, add it to the queue instead of processing it here
                        if (bank_code === "855") {
                            telebirrWithdrawalQueue.push({
                                telegramId,
                                amount,
                                account_number,
                                withdrawalRecordId: savedWithdrawal._id // Pass the DB record ID
                            });
                        } else {
                            // For other banks, you can handle them as a direct process or via a different worker
                            // For now, we'll assume they also get a pending status and an admin handles them.
                        }

                    } catch (error) {
                        console.error("❌ Error submitting withdrawal request:", error);
                        userWithdrawalStates.delete(telegramId);
                        return await ctx.reply("🚫 An error occurred while submitting your request. Please try again.");
                    }
                } else if (data === "withdraw_cancel") {
                    userWithdrawalStates.delete(telegramId);
                    await ctx.editMessageText("❌ Withdrawal request has been cancelled.", {
                        reply_markup: {
                            inline_keyboard: [] // Remove the keyboard
                        }
                    });
                }
            }
            return; // Exit after handling a withdrawal callback
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

            // Send instruction message with the contact share keyboard
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

        // Handle playdemo callback
        if (data === "playdemo") {
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

                return ctx.reply("🎮 Choose your demo game:", {
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
                console.error("❌ Error in playdemo callback:", err.message);
                return ctx.reply("🚫 Something went wrong. Please try again later.");
            }
        }

        // ⭐ Handle 'deposit' callback - INLINED LOGIC
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

                const depositUrl = `https://frontend.bingoogame.com/PaymentForm?user=${telegramId}`;

                // Return the deposit options directly
                return ctx.reply("💳 Choose how you want to deposit:", {
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: "Manual", callback_data: "manual_deposit" }],
                            [{ text: "🚀 Open Deposit Page", url: depositUrl }]
                        ]
                    }
                });

            } catch (err) {
                // The rate limit for this specific `deposit` callback is covered by the top-level catch.
                console.error("❌ Error in deposit callback handler:", err.message);
                return ctx.reply("🚫 An error occurred. Please try again.");
            }
        }

        // ⭐ Handle 'manual_deposit' callback to enter the scene
        if (data === "manual_deposit") {
            await ctx.answerCbQuery(); // Acknowledge the button press
            return ctx.scene.enter("manualDeposit"); // Enter the manual deposit scene
        }

        // Handle balance callback
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

                return ctx.reply(`💰 Your current balance is: *${user.balance} Birr*`, {
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

            const inviteLink = `https://t.me/bossbingobot?start=${telegramId}`;

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

        // ❗ Fallback for unhandled callbacks (only if not explicitly handled by a 'return' statement above)
        // This should now only catch genuinely unhandled callbacks, not 'deposit' or 'manual_deposit'.
        console.warn(`⚠️ Unhandled callback data: ${data}`);
        return; // Ensure this function always returns something if a callback is processed.
    });

    // ✅ Properly registered outside of callback_query handler
    bot.action("copied", async (ctx) => {
        await ctx.answerCbQuery("✅ Link copied!", { show_alert: false });
    });
};
