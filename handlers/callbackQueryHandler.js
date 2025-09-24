// handlers/callbackQueryHandler.js
const User = require("../Model/user");
const Withdrawal = require("../Model/withdrawal");
const { userRateLimiter, globalRateLimiter } = require("../Limit/global");
const { clearAllFlows } = require("../utils/flowUtils");
const { processTelebirrWithdrawal } = require('./telebirrWorker.js');
const { getDriver, resetDriver } = require('./appiumService.js'); // 👈 Using the new service

const telebirrWithdrawalQueue = [];

const processQueue = (bot) => {

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

        // ✅ Apply rate limiting before processing ANY callbacks
        try {
            await Promise.all([
                userRateLimiter.consume(telegramId),
                globalRateLimiter.consume("global")
            ]);
        } catch (rateLimitErr) {
            console.warn("⚠️ Rate limit triggered for", telegramId);
            return ctx.answerCbQuery("⏳ Too many requests. Please wait a second.");
        }

        // ⭐ NEW: Handle the 'register' callback query
        if (data === "register") {
             await clearAllFlows(telegramId);
            await ctx.answerCbQuery();
            const user = await User.findOne({ telegramId });

            if (user) {
                // User is already registered
                await ctx.editMessageText(`ℹ️ You are already registered as *${user.username}*`, {
                    parse_mode: "Markdown",
                    reply_markup: { inline_keyboard: [] }
                });
                // Optional: Send the main menu
                return ctx.reply("🔄 Main menu:", buildMainMenu(user));
            }

            // Start the registration flow by setting the state
            await User.findOneAndUpdate({ telegramId }, {
                registrationInProgress: { step: 1 }
            }, { upsert: true });

            return ctx.reply("📲 Please share your contact by clicking the button below.", {
                reply_markup: {
                    keyboard: [[{ text: "📞 Share Contact", request_contact: true }]],
                    one_time_keyboard: true,
                    resize_keyboard: true
                }
            });
        }

       // ⭐ Handle WITHDRAWAL callbacks
// ⭐ Handle WITHDRAWAL callbacks
if (data.startsWith("withdraw_")) {
    const user = await User.findOne({ telegramId }); // 👈 Retrieve the user document
    const userState = user?.withdrawalInProgress; // 👈 Get the state from the document

    if (!user || !userState) { // 👈 Check if the state exists in the DB
        return ctx.answerCbQuery("🚫 This conversation has expired. Please start over with /withdraw.");
    }

    ctx.answerCbQuery();

    if (userState.step === "selectBank") {
        const bankCode = data.split("_")[1];
        const withdrawalBanks = [{ name: "🏛 CBE", code: "946" }, { name: "📱 Telebirr", code: "855" }];
        const bankName = withdrawalBanks.find(b => b.code === bankCode)?.name;

        // 👈 Update the state in the database
        await User.updateOne({ telegramId }, {
            $set: {
                "withdrawalInProgress.data.bank_code": bankCode,
                "withdrawalInProgress.data.bank_name": bankName,
                "withdrawalInProgress.step": "getAmount",
            }
        });

        return ctx.reply(`**${bankName}** መርጠዋል። ለማውጣት የሚፈልጉትን መጠን (amount) ይጻፉ።`, {
            parse_mode: 'Markdown'
        });
    }
    else if (userState.step === "confirm") {
        if (data === "withdraw_confirm") {
            const { amount, bank_code, account_number } = userState.data;

            try {

            // ⭐ ADDED DEDUCTION LOGIC HERE ⭐
                const updatedUser = await User.findOneAndUpdate(
                    { telegramId, balance: { $gte: amount } },
                    { $inc: { balance: -amount } },
                    { new: true }
                );

                if (!updatedUser) {
                    // If the balance deduction fails, respond and cancel the flow
                    await User.updateOne({ telegramId }, { $unset: { withdrawalInProgress: 1 } });
                    return ctx.editMessageText("🚫 Failed to process your request. Your balance may have changed or is insufficient. Please try again.");
                }
                // ⭐ END OF DEDUCTION LOGIC ⭐
                await ctx.editMessageText("⏳ Your withdrawal is in the queue. We will notify you upon completion. To cancel, type /cancel.");

                const withdrawal = new Withdrawal({
                    tx_ref: `TX-${Date.now()}-${telegramId}`,
                    telegramId: String(telegramId),
                    amount,
                    bank_code,
                    account_number,
                    status: 'pending'
                });

                const savedWithdrawal = await withdrawal.save();
                
                // ✅ FIX 1: Change $unset value to 1
                await User.updateOne({ telegramId }, { $unset: { withdrawalInProgress: 1 } });

                if (bank_code === "855") {
                    telebirrWithdrawalQueue.push({
                        // ✅ FIX 2: Ensure telegramId is a string here as well
                        telegramId: String(telegramId),
                        amount,
                        account_number,
                        withdrawalRecordId: savedWithdrawal._id
                    });
                    console.log(`📥 Added withdrawal for ${telegramId} to the queue. Queue size: ${telebirrWithdrawalQueue.length}`);
                }

            } catch (error) {
                console.error("❌ Error submitting withdrawal request:", error);
                
                // ✅ FIX 1: Change $unset value to 1
                await User.updateOne({ telegramId }, { $unset: { withdrawalInProgress: 1 } });
                return await ctx.reply("🚫 An error occurred while submitting your request. Please try again.");
            }
        } else if (data === "withdraw_cancel") {
            // ✅ FIX 1: Change $unset value to 1
            await User.updateOne({ telegramId }, { $unset: { withdrawalInProgress: 1 } });
            await ctx.editMessageText("❌ Withdrawal request has been cancelled.", {
                reply_markup: {
                    inline_keyboard: []
                }
            });
        }
    }
    return;
}
     
        if (data === "Play") {

            try {
                 await clearAllFlows(telegramId);
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
                // ⭐ NEW: Clear any active flows before starting a new one
                await clearAllFlows(telegramId);
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
          const user = await User.findOne({ telegramId });
           await ctx.answerCbQuery();

            if (!user) {
        return ctx.answerCbQuery("🚫 Please register first.");
    }
    // Set the deposit state and prompt for amount
    await User.updateOne({ telegramId }, { $set: { depositInProgress: { step: "getAmount" } } });
    await ctx.reply("💵 Please enter the amount you wish to deposit: (Type /cancel to exit)");
    return ctx.answerCbQuery();
        }


        // From callbackHandler_v2.js
// From callbackHandler_v2.js
if (data === "payment_cbe" || data === "payment_telebirr") {
    const user = await User.findOne({ telegramId });
    const depositState = user?.depositInProgress;

    // 🚀 FIX: Allow both "getAmount" and "selectMethod" states
    if (!user || !depositState || !["selectMethod", "getAmount"].includes(depositState.step)) {
        return ctx.answerCbQuery("🚫 This operation is not currently available. Please start a new deposit.");
    }

    if (!depositState.amount) {
    return ctx.reply("🚫 Please enter a valid amount first before choosing a payment method.");
}

    // Determine deposit type
    let depositType = data === "payment_cbe" ? "CBE" : "Telebirr";

    await ctx.answerCbQuery("Proceeding to deposit verification.");
    
    const amount = depositState.amount;

    // 🚀 FIX: If still in getAmount, push state forward to selectMethod
    if (depositState.step === "getAmount") {
        await User.updateOne(
            { telegramId },
            { $set: { "depositInProgress.step": "selectMethod" } }
        );
    }

    // Now move to awaitingSMS
    await User.updateOne(
        { telegramId },
        {
            $set: {
                "depositInProgress.depositType": depositType,
                "depositInProgress.step": "awaitingSMS"
            }
        }
    );

    // Provide instructions
    let instructions = "";
    if (depositType === "CBE") {
        instructions = `የኢትዮጵያ ንግድ ባንክ አካውንት

\`\`\`
1000454544246 
\`\`\`

\`\`\`
1. ከላይ ባለው የኢትዮጵያ ንግድ ባንክ አካውንት ${amount} ብር ያስገቡ

2. የምትልኩት የገንዘብ መጠን እና እዚ ላይ እንዲሞላልዎ የምታስገቡት የብር መጠን ተመሳሳይ መሆኑን እርግጠኛ ይሁኑ

3. ብሩን ስትልኩ የከፈላችሁበትን መረጃ የያዘ አጭር የጹሁፍ መልክት (sms) ከኢትዮጵያ ንግድ ባንክ ይደርሳችኋል

4. የደረሳችሁን አጭር የጹሁፍ መልክት (sms) ሙሉውን ኮፒ (copy) በማረግ ከታች ባለው የቴሌግራም የጹሁፍ ማስገቢያው ላይ ፔስት (paste) በማረግ ይላኩት

5. ብር ስትልኩ የምትጠቀሙት USSD (*889#) ከሆነ፣ ከUSSD (*889#) መጨረሻ ላይ "Complete" ሲያሳይ፣ 3 ቁጥርን በመጫን የትራንዛክሽን ቁጥሩን ያሳያል። ይህን ቁጥር ጽፎ ይቀመጡ
\`\`\`

🔔 ማሳሰቢያ:
- አጭር የጹሁፍ መልክት (sms) ካልደረሳቹ፣ የከፈላችሁበትን ደረሰኝ ከባንክ በመቀበል በማንኛውም ሰአት ትራንዛክሽን ቁጥሩን ቦቱ ላይ ማስገባት ትችላላቹ

- የክፍያ ችግር ካለ፣ [@luckybingos] ኤጀንቱን ማዋራት ይችላሉ፡፡  ለማቋረጥ /cancel

👉 የከፈለችሁበትን አጭር የጹሁፍ መልክት (sms) ወይም "FT" ብሎ የሚጀምረውን የትራንዛክሽን ቁጥር እዚ ላይ ያስገቡ 👇👇👇`;
    } else {
        instructions = ` 📱 የቴሌብር አካውንት

\`\`\`
0930534417
\`\`\`

\`\`\`
1. ከላይ ባለው የቴሌብር አካውንት ${amount} ብር ያስገቡ

2. የምትልኩት የገንዘብ መጠን እና እዚ ላይ እንዲሞላልዎ የምታስገቡት የብር መጠን ተመሳሳይ መሆኑን እርግጠኛ ይሁኑ

3. ብሩን ስትልኩ የከፈላችሁበትን መረጃ የያዘ አጭር የጹሁፍ መልክት (sms) ከቴሌብር ይደርሳችኋል

4. የደረሳችሁን አጭር የጹሁፍ መልክት (sms) ሙሉውን ኮፒ (copy) በማረግ ከታች ባለው የቴሌግራም የጹሁፍ ማስገቢያው ላይ ፔስት (paste) በማረግ ይላኩት
\`\`\`

🔔 ማሳሰቢያ:
- የክፍያ ችግር ካለ፣ [@luckybingos] ኤጀንቱን ማዋራት ይችላሉ፡፡ ለማቋረጥ /cancel

👉 የከፈለችሁበትን አጭር የጹሁፍ መልክት (sms) እዚ ላይ ያስገቡ 👇👇👇`;
    }

    return ctx.reply(`✅ Selected ${depositType}. Amount: ${amount} ETB.\n\n${instructions}`);
}


        // Handle balance callback
        if (data === "balance") {
            try {
                await clearAllFlows(telegramId);
                await ctx.answerCbQuery();
                const user = await User.findOne({ telegramId });

                if (!user) {
                    return ctx.reply("🚫 You must register first to check your balance.", {
                        reply_markup: {
                            inline_keyboard: [[{ text: "🔐 Register", callback_data: "register" }]]
                        }
                    });
                }

                 return ctx.reply(`💰 **Your Balances:**
- **Withdrawable Balance:** *${user.balance} Birr*
- **Bonus Balance:** *${user.bonus_balance || 0} Birr*`, {
        parse_mode: "Markdown"
      });

            } catch (error) {
                console.error("❌ Error in callback balance:", error.message);
                return ctx.reply("🚫 Failed to fetch your balance. Please try again.");
            }
        }

       // Handle invite callback
        if (data === "invite") {
            try {
                 await clearAllFlows(telegramId);
                await ctx.answerCbQuery();
                const inviteLink = `https://t.me/Danbingobot?start=${telegramId}`;

                // ⭐ The message for the share URL needs to be encoded.
                const shareMessageText = `🎉 Join Lucky Bingo and get a bonus when you register!`;
                const encodedShareMessage = encodeURIComponent(`${shareMessageText}\n${inviteLink}`);

                const message = `
🎉 *Invite & Earn!*
Share Lucky Bingo with your friends and earn rewards when they join using your link.
👤 *Your Invite Link:*
\`${inviteLink}\`
`;
                return ctx.replyWithMarkdown(message.trim(), {
                    reply_markup: {
                        inline_keyboard: [
                            [{
                                text: "➡️ Share with Friends",
                                url: `https://t.me/share/url?text=${encodedShareMessage}`
                            }]
                        ]
                    }
                });
            } catch (error) {
                console.error("❌ Error in invite callback:", error.message);
                return ctx.reply("🚫 An error occurred. Please try again.");
            }
        }

        console.warn(`⚠️ Unhandled callback data: ${data}`);
        return;
    });

    bot.action("copied", async (ctx) => {
        await ctx.answerCbQuery("✅ Link copied!", { show_alert: false });
    });
};

   
    