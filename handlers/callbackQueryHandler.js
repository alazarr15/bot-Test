// handlers/callbackQueryHandler.js
require("dotenv").config();
 // Default value, will be overridden by DB if available

const User = require("../Model/user");
const Withdrawal = require("../Model/withdrawal");
const { userRateLimiter, globalRateLimiter } = require("../Limit/global");
const { clearAllFlows } = require("../utils/flowUtils");
const  redis  = require("../utils/redisClient.js");
//const { processTelebirrWithdrawal } = require('./telebirrWorker.js');
//const { getDriver, resetDriver } = require('./appiumService.js'); // 👈 Using the new service
const { buildMainMenu,buildInstructionMenu } = require("../utils/menuMarkup");
const { startDeleteJob } = require('../utils/broadcastUtils'); // ADD THIS
const { CLAIM_CALLBACK_DATA } = require('./limitedBonusScheduler.js'); // ADD THIS (To match the claim key)
const LimitedCampaign = require('../Model/limitedCampaign'); // ADD THIS
const { rewardBonusBalance } = require('../utils/broadcastUtils.js'); // ADD THIS (or wherever you put the reward function)
const BonusClaimLog = require('../Model/BonusClaimLog');


const fs = require('fs'); // ADD THIS
const path = require('path'); // ADD THIS
// ... rest of your imports
const telebirrWithdrawalQueue = [];


    const refundAndCacheUpdate = async (telegramId, amount) => {
        // 1. Atomically update DB and return the new document/balance
        const user = await User.findOneAndUpdate(
            { telegramId }, 
            { $inc: { balance: amount } }, 
            { new: true, select: 'balance' } // CRITICAL: Get the new balance value
        );

        if (user) {
            // 2. Update Redis with the new balance from the DB
            await redis.set(`userBalance:${telegramId}`, user.balance.toString(), { EX: 60 }); 
        }
    };

// const processQueue = (bot) => {

//     const runWorker = async () => {
//         console.log("🔄 Starting Telebirr withdrawal queue processor...");

//         while (true) {
//             let task = null;

//             try {
//                 // ✅ Simplified driver management. The service handles creation/reconnection.
//                 const driver = await getDriver();

//                 if (telebirrWithdrawalQueue.length > 0) {
//                     task = telebirrWithdrawalQueue.shift();
//                     const { telegramId, amount, account_number, withdrawalRecordId } = task;

//                     console.log(`🚀 Starting Telebirr withdrawal task for user ${telegramId}`);

//                     const result = await processTelebirrWithdrawal({ driver, amount, account_number });
//                     console.log("🔍 Telebirr worker result:", JSON.stringify(result, null, 2));

//                     const isSuccess = result?.status === "success" || result?.message?.toLowerCase().includes("completed");

//                     const withdrawalRecord = await Withdrawal.findById(withdrawalRecordId);
//                     if (withdrawalRecord) {
//                         withdrawalRecord.status = isSuccess ? "completed" : "failed";
//                         if (result?.data?.tx_ref) {
//                             withdrawalRecord.tx_ref = result.data.tx_ref;
//                         }
//                         await withdrawalRecord.save();

//                         if (isSuccess) {
//                         withdrawalRecord.status = "completed";
//                         // ... (update tx_ref if available)
//                         await withdrawalRecord.save();
//                         } else {
//                         // ↩️ REFUND STEP (Graceful Failure): The worker failed, so refund the user.
//                         withdrawalRecord.status = "failed";
//                         await withdrawalRecord.save();
                        
//                         console.log(`Refunding ${amount} to user ${telegramId} due to failed withdrawal.`);
//                         // Atomically add the amount back to the user's balance
//                         await refundAndCacheUpdate(telegramId, amount); 
//                     }
//                     }

//                     try {
//                         await bot.telegram.sendMessage(
//                             Number(telegramId),
//                             isSuccess
//                                 ? `✅ የ*${amount} ብር* ወደ አካውንትዎ ገቢ ተደርጓል!`
//                                 : `🚫 የ*${amount} ብር* ገንዘብ ማውጣትዎ አልተሳካም። እባክዎ ቆይተው እንደገና ይሞክሩ።`,
//                             { parse_mode: "Markdown" }
//                         );
//                     } catch (msgErr) {
//                         console.error(`❌ Failed to send final message to ${telegramId}:`, msgErr);
//                     }

//                     await new Promise(resolve => setTimeout(resolve, 2000));
//                 } else {
//                     await new Promise(resolve => setTimeout(resolve, 5000));
//                 }
//             } catch (loopErr) {
//                 console.error("🔥 A critical error occurred in the worker loop:", loopErr);
//                 resetDriver(); // ✅ Tell the service to invalidate the driver

//                 if (task) {
//                     console.error(`💀 Error processing task for user: ${task.telegramId}`);
//                     try {
//                         await Withdrawal.findByIdAndUpdate(task.withdrawalRecordId, { status: "failed" });

//                         console.log(`Refunding ${task.amount} to user ${task.telegramId} due to critical error.`);
//                         await User.findOneAndUpdate({ telegramId: task.telegramId }, { $inc: { balance: task.amount } });

//                         await bot.telegram.sendMessage(
//                             Number(task.telegramId),
//                             `🚫 A system error occurred while processing your withdrawal of *${task.amount} Birr*. Please contact support.`,
//                             { parse_mode: "Markdown" }
//                         );
//                     } catch (recoveryErr) {
//                         console.error("🚨 Failed to perform recovery actions:", recoveryErr);
//                     }
//                 }
//                 await new Promise(resolve => setTimeout(resolve, 10000));
//             }
//         }
//     };


//     runWorker();
// };
module.exports = function (bot) {
   //processQueue(bot);
    let bank  = process.env.Bank;

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

        // ⭐ NEW: Handle the 'register' callback querys
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

                 
            // 2. Update Redis with the new balance from the DB
            await redis.set(`userBalance:${telegramId}`, updatedUser.balance.toString(), { EX: 60 }); 
            
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

                            [{ text: "🎱 Play 10 Birr 💸", web_app: { url: `https://bingofront.netlify.app/?user=${telegramId}&game=10` } }],
                            // [{ text: "🎱 Play 20 Birr 💸", web_app: { url: `https://bingofront.netlify.app/?user=${telegramId}&game=20` } }],
                            // [{ text: "🎱 Play 50 Birr 💸", web_app: { url: `https://bingofront.netlify.app/?user=${telegramId}&game=50` } }],
                            // [{ text: "🎱 Play 100 Birr 💸", web_app: { url: `https://bingofront.netlify.app/?user=${telegramId}&game=100` } }]
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
    return ctx.reply("💸 የገንዘብ ማስገቢያ ዘዴ ይምረጡ 👇", {
        reply_markup: {
            inline_keyboard: [
                [{ text: "🧾 Manual", callback_data: "manual_deposit" }]
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
    return ctx.reply("💵 እንዲሞላልዎት የሚፈልጉትን የገንዘብ መጠን ያስገቡ 👇\n\n❌ ለመሰረዝ /cancel ይንኩ");
}

// Handle payment method selection (CBE or Telebirr)
if (data === "payment_cbe" || data === "payment_telebirr") {
    const user = await User.findOne({ telegramId });
    const depositState = user?.depositInProgress;

  // Strict validation for deposit flow
if (!user || !user.depositInProgress) {
  await ctx.answerCbQuery("⚠️ No active deposit found. Please start a new one 💰", { show_alert: true });
  return buildMainMenu(user, ctx);
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
${bank}
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


//-------------------------------------------------------------------------------------------------------------------------------------------------------



if (data.startsWith(CLAIM_CALLBACK_DATA)) {
    console.log(`\n--- BONUS CLAIM START: User ${ctx.from.id} ---`);
    
    //1. Initial Quick Check (Fetch the LATEST data)
    const campaign = await LimitedCampaign.findOne({ campaignKey: 'DAILY_BONUS' });
    const telegramId = ctx.from.id; // Make sure telegramId is defined here

    if (!campaign) {
        console.error(`[CLAIM FAIL] Campaign document not found for user ${telegramId}.`);
    } else {
        console.log(`[CLAIM CHECK] DB State: isActive=${campaign.isActive}, Claims=${campaign.claimsCount}/${campaign.claimLimit}`);
    }


    if (!campaign || !campaign.isActive) {
        console.log(`[CLAIM FAIL] Campaign is NOT active or NOT found. Triggering expiry message for user ${telegramId}.`);
        // Use answerCbQuery for immediate feedback, then reply or edit later
        await ctx.answerCbQuery('❌ This bonus campaign has expired or reached its limit.', { show_alert: true });
        return ctx.editMessageReplyMarkup(null) 
            .catch((e) => console.log(`[CLEANUP FAIL] Failed to edit message reply markup: ${e.message}`)) 
            .then(() => ctx.reply('❌ This bonus campaign has expired or reached its limit.'));
    }

    // 2. CHECK IF USER ALREADY CLAIMED
    if (campaign.claimants.includes(telegramId)) {
        console.log(`[CLAIM FAIL] User ${telegramId} already claimed. Aborting.`);
        await ctx.answerCbQuery('⚠️ You have already claimed this bonus!', { show_alert: true });
        // The button should only be removed if the claim succeeded, so we won't remove it here.
        return;
    }
    
    // 3. ATOMIC CLAIM AND REWARD (CRITICAL FIX APPLIED HERE)
    // We rely only on the DB to check the count against the limit property on the document itself.
    
  /*  const atomicQuery = { 
        campaignKey: 'DAILY_BONUS', 
        isActive: true, 
        claimsCount: { $lt: campaign.claimLimit } 
    };*/

    const atomicQuery = { 
        campaignKey: 'DAILY_BONUS', 
        isActive: true, 
        claimsCount: { $lt: campaign.claimLimit },
        // 🛑 CRITICAL FIX: Ensures the user ID is NOT in the claimants array before claiming.
        claimants: { $nin: [telegramId] } 
    };
    
    console.log(`[ATOMIC ATTEMPT] Query Criteria: ${JSON.stringify(atomicQuery)}`);
    
    const result = await LimitedCampaign.findOneAndUpdate(
        atomicQuery,
        { 
            $inc: { claimsCount: 1 },
            $push: { claimants: telegramId } 
        },
        { new: true }
    );

    if (!result) {
        console.log(`[ATOMIC FAIL] Atomic update failed for user ${telegramId}. Limit likely hit.`);
        
        // If result is null, the atomic condition failed (i.e., claimsCount was NOT < claimLimit).
        // The limit was hit by someone else immediately before this claim.
        
        // Ensure the campaign is marked inactive for all future checks
        const deactivateResult = await LimitedCampaign.updateOne(
            { campaignKey: 'DAILY_BONUS' },
            { $set: { isActive: false } }
        );
        
        console.log(`[DEACTIVATION] DB Updated: Modified ${deactivateResult.modifiedCount} document(s).`);

        // Trigger mass deletion for *everyone*
        // process.nextTick(() => startDeleteJob(bot, campaign.messageContent)); // Assuming you want this to run on limit hit
        
        await ctx.answerCbQuery('❌ Sorry, the claim limit was just reached by someone else! Try again tomorrow.', { show_alert: true });
        return ctx.editMessageReplyMarkup(null).catch((e) => console.log(`[CLEANUP FAIL] Failed to edit message reply markup on atomic failure: ${e.message}`));
    }
    
    // SUCCESS PATH: User claimed the bonus
    console.log(`[ATOMIC SUCCESS] User ${telegramId} claimed bonus. New ClaimsCount: ${result.claimsCount}`);
   
   
     try {
        await BonusClaimLog.create({
            telegramId: telegramId,
            bonusAmount: result.bonusAmount, // Use the bonus amount from the campaign result
            campaignKey: result.campaignKey // Should be 'DAILY_BONUS'
        });
        console.log(`[LOGGING SUCCESS] Claim logged for user ${telegramId}.`);
    } catch (logError) {
        console.error(`[LOGGING FAIL] Failed to create claim log for user ${telegramId}: ${logError.message}`);
        // IMPORTANT: We log the error but proceed with the reward, 
        // as the atomic claim and reward are more critical.
    }
    
    // 4. REWARD USER
    const rewardSuccess = await rewardBonusBalance(telegramId, result.bonusAmount);
    console.log(`[REWARD] User ${telegramId} reward success: ${rewardSuccess}`);


    if (rewardSuccess) {

         const updatedUser = await User.findOne({ telegramId });

    // 🟢 Sync Redis cache for all balances
    await redis.set(`userBalance:${telegramId}`, updatedUser.balance.toString(), { EX: 60 });
    await redis.set(`userBonusBalance:${telegramId}`, updatedUser.bonus_balance.toString(), { EX: 60 });
    await redis.set(`userCoinBalance:${telegramId}`, updatedUser.coin_balance.toString(), { EX: 60 });
    console.log(`[REDIS SYNC] Updated cache for user ${telegramId}`);
        // 5. CHECK FOR COMPLETION AND DELETE

        if (result.claimsCount >= result.claimLimit) {
            console.log(`🎉 LIMIT REACHED: ${result.claimLimit} claims hit! Starting mass deletion.`);
            // Deactivate campaign state
            const finalDeactivateResult = await LimitedCampaign.updateOne({ campaignKey: 'DAILY_BONUS' }, { $set: { isActive: false } });
            console.log(`[DEACTIVATION FINAL] DB Updated: Modified ${finalDeactivateResult.modifiedCount} document(s).`);

            // Trigger deletion for all users (runs in the background)
            process.nextTick(() => startDeleteJob(bot, result.messageContent)); 
            
            await ctx.answerCbQuery(`✅ Congratulations! You claimed ${result.bonusAmount} Birr Bonus, and you were the last one!`, { show_alert: true });
            return ctx.editMessageReplyMarkup(null).catch((e) => console.log(`[CLEANUP FAIL] Failed to edit message reply markup on final claim: ${e.message}`));
        }
        
        // 6. SUCCESS RESPONSE (Not the final claim)
       const playReplyMarkup = {
            inline_keyboard: [
                [{ text: "🎮 Play Now!", callback_data: 'Play' }] 
            ]
        };
        await ctx.answerCbQuery(`✅ Success! You received ${result.bonusAmount} Birr bonus!`, { show_alert: true });
        
        // Remove button for the claiming user
        await ctx.editMessageReplyMarkup(null).catch((e) => console.log(`[CLEANUP FAIL] Failed to remove button after success: ${e.message}`)); 
        
        console.log(`[RESPONSE] Sent success message to user ${telegramId}. Remaining: ${result.claimLimit - result.claimsCount}`);
        // NEW LINE:
       return ctx.reply(
            `✅ Success! You received **${result.bonusAmount} Birr** bonus! Only **${result.claimLimit - result.claimsCount}** spots remain. What next?`, 
            { 
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: playReplyMarkup.inline_keyboard
                }
            }
        );
    } else {
        console.error(`[REWARD FAIL] Could not reward user ${telegramId}.`);
        await ctx.answerCbQuery('🚫 Error rewarding bonus. Please contact support.', { show_alert: true });
        return;
    }
}



//-----------------------------------------------------------------------------------------------------------------------------------

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
- **Bonus Balance:** *${user.bonus_balance || 0} Birr*
- **Coin Balance:** *${user.coin_balance || 0} Birr*`, {
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
          const botUsername = 'Danbingobot';    
         const inviteLink = `https://t.me/${botUsername}?start=${telegramId}`;

                // 1. The message content your user will share
                const shareMessageText = `🎉 *Hey friends!* 🎉

✨ Be one of the *early players* in *DAN BINGO* and claim your exclusive bonus!  

🎁 Special rewards are waiting — but only for a limited time!  

🔗 Click here to join: ${inviteLink}

Don’t wait — the fun and rewards are just a tap away! 🎲💸`;
                // Include the link directly in the shared text for clarity
                const fullShareMessage = `${shareMessageText}\n\n🔗 ${inviteLink}`;
                
                // 2. Use the 'tg://msg' scheme for direct sharing (this is the key change!)
                const telegramShareUrl = `tg://msg?text=${encodeURIComponent(fullShareMessage)}`;

                // 3. The message sent to the user when they tap the "invite" callback button
                const message = `
🎉 *Invite & Earn!*
Share DAN Bingo with your friends and earn rewards when they join using your link.
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

   
    