// handlers/callbackQueryHandler.js
const User = require("../Model/user");
const Withdrawal = require("../Model/withdrawal");
const { userRateLimiter, globalRateLimiter } = require("../Limit/global");

// ✅ IMPORTANT: Correct import to get the setup function.
const { setupTelebirrWorker } = require('./telebirrWorker_final.js'); 

// ⚠️ CRITICAL: Use environment variables for sensitive info
const TELEBIRR_LOGIN_PIN = process.env.TELEBIRR_LOGIN_PIN;
const TELEBIRR_PHONE = process.env.TELEBIRR_PHONE;
const APPIUM_DEVICE_NAME = process.env.APPIUM_DEVICE_NAME;
const APPIUM_HOST = process.env.APPIUM_HOST || '127.0.0.1'; // Use a default for local testing

// WebdriverIO/Appium options
const opts = {
    protocol: 'http',
    // ✅ FIX: Use environment variable for the Appium host
    hostname: APPIUM_HOST, 
    port: 4723,
    path: '/',
    connectionRetryTimeout: 240000,
    connectionRetryCount: 1,
    capabilities: {
        alwaysMatch: {
            platformName: "Android",
            // ✅ FIX: Use environment variables for device details
            "appium:deviceName": APPIUM_DEVICE_NAME,
            "appium:udid": TELEBIRR_PHONE,
            "appium:automationName": "UiAutomator2",
            "appium:appPackage": "cn.tydic.ethiopay",
            "appium:appActivity": "com.huawei.module_basic_ui.splash.LauncherActivity",
            "appium:noReset": true,
            "appium:newCommandTimeout": 600
        }
    }
};

const telebirrWithdrawalQueue = [];

// This function now just starts the main worker loop.
// It's called once when the bot application starts.
const startTelebirrWorker = (bot) => {
    setupTelebirrWorker(bot, telebirrWithdrawalQueue, opts);
};

module.exports = function (bot) {
    // ✅ This is the correct place to start the worker
    startTelebirrWorker(bot);

    // ⭐ Universal function to clear all active flows
    async function clearAllFlows(telegramId) {
        await User.findOneAndUpdate({ telegramId }, {
            $set: {
                withdrawalInProgress: null,
                transferInProgress: null,
                registrationInProgress: null,
                usernameChangeInProgress: null,
                depositInProgress: null
            }
        });
    }

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
                        await User.findOneAndUpdate({ telegramId }, { "withdrawalInProgress.step": "pendingConfirmation" });
                        await ctx.editMessageText("⏳ ገንዘብ ማውጣት ሂደትዎ ተጀምሯል። በተጠናቀቀ ጊዜ እናሳዉቃለን [1-3] ደቂቃ ለመውጣት /cancel ይጻፉ።");
                        const result = await User.findOneAndUpdate(
                            { telegramId, balance: { $gte: amount } },
                            { $inc: { balance: -amount } }
                        );
                        if (!result) {
                            await clearAllFlows(telegramId);
                            return ctx.reply("🚫 Insufficient balance. Please check your balance and try again.");
                        }
                        const withdrawal = new Withdrawal({
                            tx_ref: `TX-${Date.now()}-${telegramId}`,
                            telegramId: String(telegramId),
                            amount,
                            bank_code,
                            account_number,
                            status: 'pending'
                        });
                        const savedWithdrawal = await withdrawal.save();
                        
                        await clearAllFlows(telegramId);
                        
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
                        const userToRefund = await User.findOneAndUpdate(
                            { telegramId },
                            { $inc: { balance: amount } }
                        );
                        if (userToRefund) {
                            console.log(`✅ Refunded ${amount} Birr to user ${telegramId} due to withdrawal submission error.`);
                        }
                        await clearAllFlows(telegramId);
                        return await ctx.reply("🚫 An error occurred while submitting your request. Please try again.");
                    }
                } else if (data === "withdraw_cancel") {
                    await clearAllFlows(telegramId);
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
            // ...
        }
        if (data === "Play") {
            // ...
        }
        if (data === "deposit" || /^deposit_\d+$/.test(data)) {
            try {
                await clearAllFlows(telegramId);
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