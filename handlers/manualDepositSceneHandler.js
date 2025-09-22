// This file replaces manualDepositSceneHandler.js and manages the deposit flow
// using database state tracking instead of Telegraf scenes.

const User = require("../Model/user");
const SmsMessage = require("../Model/SmsMessage");
const Deposit = require("../Model/Deposit");
const { userRateLimiter, globalRateLimiter } = require("../Limit/global");

module.exports = function (bot) {
  // Universal function to clear all active flows
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

  // Handle all text messages. This is the main listener for the new flow.
  bot.on("text", async (ctx) => {
    const telegramId = ctx.from.id;
    const user = await User.findOne({ telegramId });

    // Check if the user is in a deposit flow
    if (user?.depositInProgress?.step) {
      // Handle /cancel command to exit the flow
      if (ctx.message.text === "/cancel") {
        await clearAllFlows(telegramId);
        return ctx.reply("❌ Manual deposit cancelled.");
      }

      // Handle Step 1: AwaitingAmount
      if (user.depositInProgress.step === "AwaitingAmount") {
        const amount = parseFloat(ctx.message.text);
        if (isNaN(amount) || amount <= 0) {
          return ctx.reply("🚫 የተሳሳተ መጠን። እባክዎ ትክክለኛ ቁጥር ያስገቡ (ለምሳሌ፦ 100)። (ለመውጣት /cancel ይጻፉ)");
        }
        await User.updateOne({ telegramId }, {
          $set: {
            "depositInProgress.step": "AwaitingMethodSelection",
            "depositInProgress.data": { amount: amount }
          }
        });
        return ctx.reply(`💰 የሚፈልጉት ${amount} ብር ለማስገባት ነው። እባክዎ የክፍያ ዘዴዎን ይምረጡ: (ለመውጣት /cancel ይጻፉ)`, {
          reply_markup: {
            inline_keyboard: [
              [{ text: "CBE to CBE", callback_data: "payment_cbe" }],
              [{ text: "Telebirr To Telebirr", callback_data: "payment_telebirr" }]
            ],
          },
        });
      }

      // Handle Step 3: AwaitingConfirmation
      if (user.depositInProgress.step === "AwaitingConfirmation") {
        const userMessage = ctx.message?.text || ctx.message?.caption;
        const claimedAmount = user.depositInProgress.data.amount;

        if (!userMessage) {
          return ctx.reply("❌ Please try forwarding the message again. (Type /cancel to exit)");
        }

        try {
          const cbeRegex = /(FT[A-Z0-9]{10})/i;
          const telebirrRegex = /(?:transaction number is|የሂሳብ እንቅስቃሴ ቁጥርዎ|Lakkoofsi sochii maallaqaa keessan|ቁፅሪ ሒሳብ ዝተንቀሳቀሰ|lambarka hawulgalkaaguna waa)\s*([A-Z0-9]{10})\'?/i;
          let transactionId = null;
          const cbeMatch = userMessage.match(cbeRegex);
          const telebirrMatch = userMessage.match(telebirrRegex);
          if (cbeMatch && cbeMatch[1]) {
            transactionId = cbeMatch[1];
          } else if (telebirrMatch && telebirrMatch[1]) {
            transactionId = telebirrMatch[1];
          }

          if (!transactionId) {
            await clearAllFlows(telegramId); // Clear flow on failure
            return ctx.reply("🚫 የገለበጡት መልእክት ትክክለኛ የCBE ወይም የቴሌብር የግብይት መለያ አልያዘም። እባክዎ ደግመው ይሞክሩ። (ለመውጣት /cancel ይጻፉ)");
          }
          console.log(`Attempting to match transaction ID: ${transactionId}`);

          const matchingSms = await SmsMessage.findOne({
            status: "pending",
            $and: [
              { message: { $regex: new RegExp(transactionId, "i") } },
              { message: { $regex: new RegExp(claimedAmount.toFixed(2).replace('.', '\\.'), "i") } }
            ]
          });

          if (matchingSms) {
            const balanceBefore = user.balance;
            const newBalance = balanceBefore + claimedAmount;

            // 1. Create the detailed deposit record for your dashboard
            await Deposit.create({
              userId: user._id,
              telegramId: user.telegramId,
              amount: claimedAmount,
              method: user.depositInProgress.data.depositType, // Now this will work correctly
              status: 'approved',
              transactionId: transactionId,
              smsMessageId: matchingSms._id,
              balanceBefore: balanceBefore,
              balanceAfter: newBalance,
            });

            // 2. Mark the SMS as processed to prevent reuse
            matchingSms.status = "processed";
            await matchingSms.save();

            // 3. Update the user's balance
            const updatedUser = await User.findOneAndUpdate(
              { telegramId },
              { $inc: { balance: claimedAmount } },
              { new: true }
            );

            await ctx.reply(`✅ Your deposit of ${claimedAmount} ETB has been successfully approved! Your new balance is: *${updatedUser.balance} ETB*.`, { parse_mode: 'Markdown' });
          } else {
            await ctx.reply("🚫 No matching deposit found. Please make sure you forwarded the correct and original confirmation message. If you believe this is an error, please contact support. (Type /cancel to exit)");
          }
        } catch (error) {
          if (error.code === 11000) { // Handles duplicate transactionId error
            await ctx.reply("🚫 This transaction has already been processed.");
          } else {
            console.error("❌ Error processing manual deposit message:", error);
            await ctx.reply("🚫 An error occurred while processing your request. Please try again or contact support.");
          }
        } finally {
          await clearAllFlows(telegramId);
        }
      }
    }
  });


  // Handle all callback queries.
  bot.on('callback_query', async (ctx) => {
    const telegramId = ctx.from.id;
    const data = ctx.callbackQuery?.data;
    const user = await User.findOne({ telegramId });

    if (user?.depositInProgress?.step === "AwaitingMethodSelection" && data.startsWith('payment_')) {
      const method = data;
      const amount = user.depositInProgress.data.amount;
      let instructions = "";
      let depositType = "";

      if (method === "payment_cbe") {
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

- የክፍያ ችግር ካለ፣ [@luckybingos] ኤጀንቱን ማዋራት ይችላሉ፡፡  ለማቋረጥ /cancel

👉 የከፈለችሁበትን አጭር የጹሁፍ መልክት (sms) ወይም "FT" ብሎ የሚጀምረውን የትራንዛክሽን ቁጥር እዚ ላይ ያስገቡ 👇👇👇
`;
      } else if (method === "payment_telebirr") {
        depositType = "Telebirr";
        instructions = `
📱 የቴሌብር አካውንት

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

👉 የከፈለችሁበትን አጭር የጹሁፍ መልክት (sms) እዚ ላይ ያስገቡ 👇👇👇
`;
      }

      await User.updateOne({ telegramId }, {
        $set: {
          "depositInProgress.step": "AwaitingConfirmation",
          "depositInProgress.data.depositType": depositType
        }
      });
      await ctx.answerCbQuery();
      await ctx.reply(instructions, { parse_mode: "Markdown" });
    }
  });
};
