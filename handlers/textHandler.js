// handlers/textHandler.js

const User = require("../Model/user");
const Transfer = require('../Model/transfer');
const mongoose = require("mongoose");
const { userRateLimiter, globalRateLimiter } = require("../Limit/global");

// 🧩 Inline menu builder
function buildMainMenu(user) {
    return {
        reply_markup: {
            inline_keyboard: [
                [{ text: `✅ Registered as ${user?.username || "Guest"}`, callback_data: "registered" }],
                [{ text: "🎮 Play", callback_data: "Play" }],
                [
                    { text: "💰 Check Balance", callback_data: "balance" },
                    { text: "💳 Deposit", callback_data: "deposit" }
                ],
                [
                    { text: "📞 Contact Support", callback_data: "support" },
                    { text: "📖 Instruction", callback_data: "not_available" }
                ],
                [{ text: "📨 Invite", callback_data: "invite" }]
            ]
        }
    };
}

// ⭐ NEW: Universal function to clear all active flows
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

module.exports = function (bot) {
    bot.on("text", async (ctx) => {
        try {
            const telegramId = ctx.from.id;
            const messageRaw = ctx.message.text.trim();
            const message = messageRaw.toLowerCase();

            try {
                await Promise.all([
                    userRateLimiter.consume(telegramId),
                    globalRateLimiter.consume("global")
                ]);
            } catch (rateLimitErr) {
                console.warn("⚠️ Rate limit triggered for", telegramId);
                return ctx.reply("⏳ Too many requests. Please wait a second.");
            }

            // ⭐ UNIVERSAL CANCEL FOR ALL CUSTOM FLOWS ⭐
            if (message === "/cancel" || message === "cancel") {
                const user = await User.findOne({ telegramId });
                if (user?.withdrawalInProgress || user?.transferInProgress || user?.registrationInProgress || user?.usernameChangeInProgress || user?.depositInProgress) {
                    await clearAllFlows(telegramId);
                    await ctx.reply("❌ Operation cancelled. You have exited the current flow.");
                    return ctx.reply("🔄 Main menu:", buildMainMenu(user));
                }
                if (ctx.scene && ctx.scene.current && ctx.scene.current.id) {
                    await ctx.reply("❌ Operation cancelled. You have exited the current flow.");
                    return ctx.scene.leave();
                }
                return ctx.reply("👍 There is no active operation to cancel.");
            }

            const user = await User.findOne({ telegramId });

            // ⭐ NEW: Logic to handle new command and clear previous state ⭐
            if (message === "/deposit") {
                await clearAllFlows(telegramId);
                const updatedUser = await User.findOneAndUpdate({ telegramId }, {
                    $set: {
                        "depositInProgress": {
                            step: "getAmount",
                            data: {}
                        }
                    }
                }, { new: true });
                return ctx.reply("💵 Please enter the amount you would like to deposit (min 10 Birr, max 10 Birr).");
            }

            if (message === "/withdraw") {
                await clearAllFlows(telegramId);
                const updatedUser = await User.findOneAndUpdate({ telegramId }, {
                    $set: {
                        "withdrawalInProgress": {
                            step: "selectBank",
                            data: {}
                        }
                    }
                }, { new: true });
                return ctx.reply("🏦 Please select your bank to withdraw funds.", {
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: "CBE", callback_data: "bank_CBE" }],
                            [{ text: "Awash Bank", callback_data: "bank_Awash" }]
                        ]
                    }
                });
            }

            // ⭐ Check for an active WITHDRAWAL flow
            if (user?.withdrawalInProgress) {
                if (user.withdrawalInProgress.step === "getAmount") {
                    const amount = parseFloat(messageRaw);
                    const MIN_WITHDRAWAL_AMOUNT = 10;
                    const MAX_WITHDRAWAL_AMOUNT = 10; 

                    if (isNaN(amount) || amount <= 0) {
                        return ctx.reply("🚫 የተሳሳተ መጠን ነው። እባክዎ አወንታዊ ቁጥር ያስገቡ።");
                    }

                    if (amount < MIN_WITHDRAWAL_AMOUNT) {
                        return ctx.reply(`🚫 The minimum withdrawal amount is *${MIN_WITHDRAWAL_AMOUNT} Birr*. Please enter an amount of ${MIN_WITHDRAWAL_AMOUNT} Birr or more.`, { parse_mode: "Markdown" });
                    }

                    if (amount > MAX_WITHDRAWAL_AMOUNT) {
                        return ctx.reply(`🚫 The maximum withdrawal amount is *${MAX_WITHDRAWAL_AMOUNT} Birr*. Please enter an amount of ${MAX_WITHDRAWAL_AMOUNT} Birr or less.`, { parse_mode: "Markdown" });
                    }

                    if (amount > user.balance) {
                        return ctx.reply(`🚫 ያስገቡት መጠን (${amount} ብር) ከቀሪ ሒሳብዎ (${user.balance} ብር) በላይ ነው። እባክዎ ያነሰ መጠን ያስገቡ።`);
                    }
                    await User.findOneAndUpdate(
                        { telegramId },
                        {
                            $set: {
                                "withdrawalInProgress.data.amount": amount,
                                "withdrawalInProgress.step": "getAccount"
                            }
                        }
                    );
                    return ctx.reply(`እባክዎ የ**${user.withdrawalInProgress.data.bank_name}** የሒሳብ ቁጥርዎን ይጻፉ።`, {
                        parse_mode: 'Markdown'
                    });
                } else if (user.withdrawalInProgress.step === "getAccount") {
                    const accountNumber = messageRaw;
                    await User.findOneAndUpdate(
                        { telegramId },
                        {
                            $set: {
                                "withdrawalInProgress.data.account_number": accountNumber,
                                "withdrawalInProgress.step": "confirm"
                            }
                        }
                    );
                    const updatedUser = await User.findOne({ telegramId });
                    const { bank_name, amount } = updatedUser.withdrawalInProgress.data;
                    const confirmMessage = `**የገንዘብ ማውጣት ዝርዝሮችዎን ያረጋግጡ:**\n- **ባንክ:** ${bank_name}\n- **መጠን:** ${amount} ብር\n- **የሒሳብ ቁጥር:** ${accountNumber}\n\nይህ ትክክል ነው?`;
                    return ctx.reply(confirmMessage, {
                        parse_mode: 'Markdown',
                        reply_markup: {
                            inline_keyboard: [
                                [{ text: "✅ አረጋግጥ", callback_data: "withdraw_confirm" }],
                                [{ text: "❌ ይቅር", callback_data: "withdraw_cancel" }]
                            ]
                        }
                    });
                }
                return;
            }
            
            // ⭐ Check for an active DEPOSIT flow
            if (user?.depositInProgress && user.depositInProgress.step === "getAmount") {
                const amount = parseFloat(messageRaw);
                const MIN_DEPOSIT_AMOUNT = 10;
                const MAX_DEPOSIT_AMOUNT = 10;
                

             
                    
                if (isNaN(amount) || amount < MIN_DEPOSIT_AMOUNT) {
                    return ctx.reply(`🚫 The minimum deposit amount is *${MIN_DEPOSIT_AMOUNT} Birr*. Please enter an amount of ${MIN_DEPOSIT_AMOUNT} Birr or more.`, { parse_mode: "Markdown" });
                }
                
                if (amount > MAX_DEPOSIT_AMOUNT) {
                    return ctx.reply(`🚫 The maximum deposit amount is *${MAX_DEPOSIT_AMOUNT} Birr*. Please enter an amount of ${MAX_DEPOSIT_AMOUNT} Birr or less.`, { parse_mode: "Markdown" });
                }

                await User.findOneAndUpdate(
                    { telegramId },
                    {
                        $set: {
                            "depositInProgress.data.amount": amount,
                            "depositInProgress.step": "getTxRef"
                        }
                    }
                );
                
                return ctx.reply("እባክዎ የማስረከቢያውን ገንዘብ ከከፈሉ በኋላ የግብይት ቁጥሩን (Transaction Reference) ይላኩልኝ።");
            }

            // === 1. Username Change Flow ===
            if (user?.usernameChangeInProgress) {
                // ... (existing code for username change) ...
            }

            // === 2. Registration Check ===
            if (!user) {
                const registrationUser = await User.findOne({ telegramId, "registrationInProgress.step": { $exists: true } });
                if (!registrationUser) {
                    return ctx.reply(
                        "👋 Welcome! Please register first to access the demo. Click the button below to register.",
                        {
                            reply_markup: {
                                inline_keyboard: [[{ text: "🔐 Register", callback_data: "register" }]]
                            }
                        }
                    );
                }
                return;
            }

            // === 3. Transfer Flow ===
            if (user?.transferInProgress) {
                // ... (existing code for transfer) ...
            }

            // === 4. Main Menu Fallback ===
            if (message.startsWith('/') || ["/play", "/balance", "/deposit", "/start"].includes(message)) {
                return ctx.reply("🔄 Returning to the main menu.", buildMainMenu(user));
            } else {
                return ctx.reply("😕 I didn't understand that. Please use the menu buttons or available commands.");
            }
        } catch (error) {
            console.error("❌ ERROR in bot text handler:", error.message);
            ctx.reply("🚫 An error occurred. Please try again.");
        }
    });
};