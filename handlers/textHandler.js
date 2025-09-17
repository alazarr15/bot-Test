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
                if (user?.withdrawalInProgress || user?.transferInProgress || user?.registrationInProgress || user?.usernameChangeInProgress) {
                    await User.findOneAndUpdate({ telegramId }, {
                        $set: {
                            withdrawalInProgress: null,
                            transferInProgress: null,
                            registrationInProgress: null,
                            usernameChangeInProgress: null,
                        }
                    });
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

            // ⭐ Check for a WITHDRAWAL flow first
            if (user?.withdrawalInProgress) {
                if (user.withdrawalInProgress.step === "getAmount") {
                    const amount = parseFloat(messageRaw);
                    if (isNaN(amount) || amount <= 0) {
                        return ctx.reply("🚫 የተሳሳተ መጠን ነው። እባክዎ አወንታዊ ቁጥር ያስገቡ።");
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
                }
                else if (user.withdrawalInProgress.step === "getAccount") {
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

            // === 1. Username Change Flow ===
            if (user?.usernameChangeInProgress) {
                if (messageRaw.length < 3) {
                    return ctx.reply("⚠️ የተሳሳተ USERNAME እባክዎ ቢያንስ 3 ፊደሎች ያስገቡ።");
                }
                if (!/^[a-zA-Z0-9_]+$/.test(messageRaw)) {
                    return ctx.reply("⚠️ USERNAME ፊደል፣ ቁጥር እና \"_\" ብቻ ሊይዝ ይችላል።");
                }
                const existingUser = await User.findOne({ username: messageRaw });
                if (existingUser && existingUser.telegramId !== telegramId) {
                    return ctx.reply("🚫 ይህ USERNAME ቀድሞውኑ ተይዟል። እባክዎ ሌላ ይሞክሩ።");
                }
                await User.findOneAndUpdate({ telegramId }, { username: messageRaw, usernameChangeInProgress: null });
                await ctx.reply(`✅ USERNAMEዎ ወደ *${messageRaw}* ተቀይሯል!`, { parse_mode: "Markdown" });
                const updatedUser = await User.findOne({ telegramId });
                if (updatedUser) return ctx.reply("🔄 ዋና መዝገብ:", buildMainMenu(updatedUser));
                return;
            }

            // === 2. Registration Check ===
            if (!user) {
                // If a user doesn't exist AND they aren't in a registration flow, prompt them to register
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
                if (user.transferInProgress.step === 1) {
                    let recipientPhoneNumber = messageRaw.replace(/\s+/g, "");
                    if (recipientPhoneNumber.startsWith("0")) {
                        recipientPhoneNumber = "251" + recipientPhoneNumber.slice(1);
                    }
                    if (!/^\d{12}$/.test(recipientPhoneNumber)) {
                        return ctx.reply("🚫 Invalid phone number format. Please enter a 12-digit number including country code.");
                    }
                    const recipient = await User.findOne({ phoneNumber: recipientPhoneNumber });
                    if (!recipient) {
                        return ctx.reply("🚫 Recipient not found. Please check the phone number.\n\nTo cancel, type /cancel.");
                    }
                    if (recipient._id.equals(user._id)) {
                        return ctx.reply("🚫 You cannot transfer to yourself. Please enter a different recipient.\n\nTo cancel, type /cancel.");
                    }
                    await User.updateOne(
                        { telegramId },
                        { $set: { "transferInProgress.recipient": recipientPhoneNumber, "transferInProgress.step": 2 } }
                    );
                    return ctx.reply("💵 Enter the amount you wish to transfer:");
                }
                if (user.transferInProgress.step === 2) {
                    let amount = parseFloat(messageRaw);
                    if (isNaN(amount) || amount <= 0) {
                        return ctx.reply("🚫 Invalid amount. Please enter a valid number.\n\nTo cancel, type /cancel.");
                    }
                    amount = Math.round(amount * 100) / 100;
                    if (amount < 10 || amount > 1000) {
                        return ctx.reply("🚫 Transfer amount must be between 10 and 1000 Birr.\n\nTo cancel, type /cancel.");
                    }
                    const session = await mongoose.startSession();
                    session.startTransaction();
                    try {
                        const currentUser = await User.findOne({ telegramId: user.telegramId }).session(session);
                        const recipient = await User.findOne({ phoneNumber: user.transferInProgress.recipient }).session(session);
                        if (!recipient) {
                            await session.abortTransaction();
                            session.endSession();
                            return ctx.reply("🚫 Unexpected error: Recipient not found. Transfer canceled.");
                        }
                        if (currentUser.balance < amount) {
                            await session.abortTransaction();
                            session.endSession();
                            return ctx.reply("🚫 Insufficient balance. Transfer canceled.");
                        }
                        await User.updateOne({ telegramId: user.telegramId }, { $inc: { balance: -amount } }, { session });
                        await User.updateOne({ phoneNumber: recipient.phoneNumber }, { $inc: { balance: amount } }, { session });
                        const transferRecord = new Transfer({
                            senderId: user._id,
                            recipientId: recipient._id,
                            senderPhone: user.phoneNumber,
                            recipientPhone: recipient.phoneNumber,
                            senderTelegramId: user.telegramId,
                            recipientTelegramId: recipient.telegramId || null,
                            amount: amount,
                        });
                        await transferRecord.save({ session });
                        await session.commitTransaction();
                        session.endSession();
                        await ctx.reply(`✅ Transferred **${amount} Birr** to phone number **${recipient.phoneNumber}**.`);
                        if (recipient.telegramId) {
                            try {
                                await ctx.telegram.sendMessage(
                                    recipient.telegramId,
                                    `✅ You received **${amount} Birr** from phone number **${user.phoneNumber}**.`
                                );
                            } catch (err) {
                                console.warn("⚠️ Failed to notify recipient:", err.message);
                            }
                        }
                        await User.updateOne({ telegramId: user.telegramId }, { $set: { transferInProgress: null } });
                        return ctx.reply("🔄 Transfer complete. Returning to the main menu:", buildMainMenu(user));
                    } catch (err) {
                        await session.abortTransaction();
                        session.endSession();
                        console.error("❌ Transfer failed:", err);
                        return ctx.reply("🚫 Transfer failed due to a server error. Please try again later.");
                    }
                }
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