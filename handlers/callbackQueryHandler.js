// handlers/callbackQueryHandler.js
const User = require("../Model/user");
const Withdrawal = require("../Model/withdrawal");
const { userRateLimiter, globalRateLimiter } = require("../Limit/global");
const { clearAllFlows } = require("../utils/flowUtils");
const { processTelebirrWithdrawal } = require('./telebirrWorker.js');
const { getDriver, resetDriver } = require('./appiumService.js'); // 👈 Using the new service
const { buildMainMenu,buildInstructionMenu } = require("../utils/menuMarkup");
const fs = require('fs'); // ADD THIS
const path = require('path'); // ADD THIS
// ... rest of your imports
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
                                ? `✅ የ*${amount} ብር* ወደ አካውንትዎ ገቢ ተደርጓል!`
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

    if (user && user.phoneNumber) {
        // User is already fully registered
        await ctx.editMessageText(`✅ You are already fully registered as *${user.username}*`, {
            parse_mode: "Markdown",
            reply_markup: { inline_keyboard: [] }
        });
        return ctx.reply("🔄 Main menu:", buildMainMenu(user));
    }

    // This part is only reached if the user is not fully registered.
    // Start the registration flow by setting the state.
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
                await ctx.editMessageText("⏳ ጥያቄዎ በሄደት ላይ ነው። ሲጠናቀቅ (1–3 ደቂቃ) ውስጥ እናሳውቃለን።",buildMainMenu(user));

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
     

    // A. Handle opening the Instruction Sub-Menu
    if (data === "open_instructions_menu") {
        await clearAllFlows(telegramId);
        await ctx.answerCbQuery();
        
        const instructionMenu = buildInstructionMenu(); 

        // Edit the existing message to show the new sub-menu
        return ctx.editMessageText("📖 **Instruction Guides**\n\nSelect a guide below to watch the video instructions:", {
            parse_mode: 'Markdown',
            ...instructionMenu, // Spreads the reply_markup property
        });
    }

    // B. Handle Back Button to Main Menu
    if (data === "main_menu") {
        await clearAllFlows(telegramId);
        await ctx.answerCbQuery();
        
        const user = await User.findOne({ telegramId });
        const mainMenu = buildMainMenu(user);
        
        // Edit the message to show the main menu
        return ctx.editMessageText("🔄 **Main Menu**", {
            parse_mode: 'Markdown',
            ...mainMenu,
        });
    }

if (data.startsWith("guide_")) {
    await clearAllFlows(telegramId);
    await ctx.answerCbQuery("⏳ Preparing your video...", { show_alert: false });

    const guideType = data.split('_')[1];

    const guideMap = {
        'registration': {
            fileName: 'registration.mp4',
            caption: "✅ *Registration Guide*\nWatch this video to complete your account setup."
        },
        'howtoplay': {
            fileName: 'how_to_play_video.mp4',
            caption: "🎮 *How to Play*\nLearn the simple steps to start playing your favorite games."
        },
        'deposit': {
            fileName: 'deposit_guide.mp4',
            caption: "💳 *Deposit Guide*\nStep-by-step instructions on adding funds to your balance."
        },
        'withdrawal': {
            fileName: 'withdrawal_guide.mp4',
            caption: "💸 *Withdrawal Guide*\nHow to securely cash out your winnings."
        },
    };

    const guide = guideMap[guideType];

    if (!guide) {
        console.error(`❌ Guide type '${guideType}' not found in guideMap`);
        return ctx.reply("ℹ️ This guide isn't available right now. Please choose another one.");
    }

    const CACHE_PATH = path.join(__dirname, "..", "video_cache.json");
    let videoCache = {};

    try {
        if (fs.existsSync(CACHE_PATH)) {
            videoCache = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'));
            console.log("📂 Loaded video cache:", videoCache);
        }
    } catch (e) {
        console.error("❌ Error reading video cache:", e);
    }

    const cachedFileId = videoCache[guide.fileName];

    if (cachedFileId) {
        console.log(`✅ Attempting cached file_id for ${guide.fileName}`);
        try {
            await ctx.replyWithVideo(cachedFileId, {
                caption: guide.caption,
                parse_mode: 'Markdown',
                supports_streaming: true,
            });
            console.log(`✅ Sent video using cached file_id for ${guide.fileName}`);
            return ctx.reply("📚 Want to see another guide?", buildInstructionMenu());
        } catch (cacheError) {
            console.warn(`⚠️ Cached file_id failed for ${guide.fileName}. Re-uploading. Error:`, cacheError.message);
            delete videoCache[guide.fileName];
        }
    }

    const videoPath = path.join(__dirname, "..", "images", guide.fileName);
    console.log(`🔍 Checking for video at path: ${videoPath}`);

    if (!fs.existsSync(videoPath)) {
        console.error(`❌ Video file missing: '${guideType}' at ${videoPath}`);
      return ctx.reply("ℹ️ The video isn't available right now. Please try again later.");
    }

    try {
        // First attempt: send via file path (more reliable than stream for small videos)
        const sentMessage = await ctx.replyWithVideo(videoPath, {
            caption: guide.caption,
            parse_mode: 'Markdown',
            supports_streaming: true,
        });

        const newFileId = sentMessage.video.file_id;
        videoCache[guide.fileName] = newFileId;
        fs.writeFileSync(CACHE_PATH, JSON.stringify(videoCache, null, 2), 'utf8');
        console.log(`💾 Cached new file_id for ${guide.fileName}: ${newFileId}`);

        return ctx.reply("📚 Want to see another guide?", buildInstructionMenu());

    } catch (errorPath) {
        console.error(`❌ Failed sending video via file path for '${guideType}':`, errorPath.message);

        // Last attempt: send via stream (fallback)
        try {
            const fileStream = fs.createReadStream(videoPath);
            
            // ⭐ Correct stream upload
            const sentStreamMsg = await ctx.replyWithVideo(
                { source: fileStream, filename: guide.fileName },
                {
                    caption: guide.caption,
                    parse_mode: 'Markdown',
                    supports_streaming: true,
                }
            );
            
            const newFileIdStream = sentStreamMsg.video.file_id;
            videoCache[guide.fileName] = newFileIdStream;
            fs.writeFileSync(CACHE_PATH, JSON.stringify(videoCache, null, 2), 'utf8');
            console.log(`💾 Cached new file_id via stream for ${guide.fileName}: ${newFileIdStream}`);

            return ctx.reply("📚 Want to see another guide?", buildInstructionMenu());
        } catch (errorStream) {
            console.error(`❌ Failed sending video via stream for '${guideType}':`, errorStream.message);
            return ctx.reply("ℹ️ The video guide is temporarily unavailable. Please try again later.");
        }
    }
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

                            [{ text: "10 Birr", web_app: { url: `https://frontend.bingoogame.com/?user=${telegramId}&game=10` } }]
                        ]

                    }

                });

            } catch (err) {

                console.error("❌ Error in play callback:", err.message);

                return ctx.reply("🚫 Something went wrong. Please try again later.");

            }

        }

      // Handle deposit callbacks
if (data === "deposit" || /^deposit_\d+$/.test(data)) {
    await clearAllFlows(telegramId); // ✅ Clear any active flows first
    await ctx.answerCbQuery();

    const user = await User.findOne({ telegramId });
    if (!user) {
        return ctx.reply("🚫 You must register first to make a deposit.", {
            reply_markup: { inline_keyboard: [[{ text: "🔐 Register", callback_data: "register" }]] }
        });
    }

    // Prompt deposit method
    return ctx.reply("💰 የገንዘብ ማስገቢያ ዘዴ ይምረጡ:", {
        reply_markup: {
            inline_keyboard: [
                [{ text: "Manual", callback_data: "manual_deposit" }]
            ]
        }
    });
}

// Handle manual deposit selection
if (data === "manual_deposit") {
    await ctx.answerCbQuery();
    const user = await User.findOne({ telegramId });
    if (!user) return ctx.answerCbQuery("🚫 Please register first.");

    // Set deposit state to get amount
    await User.updateOne({ telegramId }, { $set: { depositInProgress: { step: "getAmount" } } });
    return ctx.reply("💵 እንዲሞላልዎት የሚፈልጉትን የገንዘብ መጠን ያስገቡ: (ለማቋረጥ /cancel ይንኩ)");
}

// Handle payment method selection (CBE or Telebirr)
if (data === "payment_cbe" || data === "payment_telebirr") {
    const user = await User.findOne({ telegramId });
    const depositState = user?.depositInProgress;

  // Strict validation for deposit flow
if (!user || !user.depositInProgress) {
    return ctx.answerCbQuery("🚫 No active deposit. Please start a new deposit.");
}

// Only allow selection if user already entered amount
if (depositState.step !== "selectMethod" || !depositState.amount) {
    return ctx.answerCbQuery("🚫 You must enter a valid amount before selecting a payment method.");
}


    let depositType = "";
    let instructions = "";
    const amount = depositState.amount;

    if (data === "payment_cbe") {
        depositType = "CBE";
        instructions = `
የኢትዮጵያ ንግድ ባንክ አካውንት

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

- የክፍያ ችግር ካለ፣ [@luckybingos] ኤጀንቱን ማዋራት ይችላሉ፡፡  ለማቋረጥ /cancel

👉 የከፈለችሁበትን አጭር የጹሁፍ መልክት (sms) ወይም "FT" ብሎ የሚጀምረውን የትራንዛክሽን ቁጥር እዚ ላይ ያስገቡ 👇👇👇
        `;
    } else if (data === "payment_telebirr") {
        depositType = "Telebirr";
        instructions = `
 📱 የቴሌብር አካውንት

\`\`\`
0989492737
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

    // Update deposit state and move to awaitingSMS
    await User.updateOne(
        { telegramId },
        { $set: { "depositInProgress.depositType": depositType, "depositInProgress.step": "awaitingSMS" } }
    );

    return ctx.reply(
        `✅ Selected ${depositType}. Amount: ${amount} ETB.\n\n${instructions}`,
        { parse_mode: "Markdown" }
    );
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

                // IMPORTANT: Use your actual bot's username (e.g., Danbingobot)
                const inviteLink = `https://t.me/Danbingobot?start=${telegramId}`;

                // 1. The message content your user will share
                const shareMessageText = `🎉 Join Lucky Bingo and get a bonus when you register!`;
                // Include the link directly in the shared text for clarity
                const fullShareMessage = `${shareMessageText}\n\n🔗 ${inviteLink}`;
                
                // 2. Use the 'tg://msg' scheme for direct sharing (this is the key change!)
                const telegramShareUrl = `tg://msg?text=${encodeURIComponent(fullShareMessage)}`;

                // 3. The message sent to the user when they tap the "invite" callback button
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
                                // Updated to use the tg://msg scheme
                                url: telegramShareUrl 
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

   
};

   
    