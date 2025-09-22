const { Telegraf } = require("telegraf");
const User = require("../Model/user");
const SmsMessage = require("../Model/SmsMessage");
const Deposit = require("../Model/Deposit");
const { userRateLimiter, globalRateLimiter } = require("../Limit/global");

// This function will handle the entire deposit conversation
async function handleDepositFlow(ctx) {
  try {
    const telegramId = ctx.from.id;
    const messageText = ctx.message?.text?.toLowerCase();

    // Check for rate limits first
    await userRateLimiter.consume(telegramId);
    await globalRateLimiter.consume("global");

    const user = await User.findOne({ telegramId });

    // Handle /cancel command at any point
    if (messageText === "/cancel" || messageText === "cancel") {
      await User.findOneAndUpdate({ telegramId }, { $unset: { depositInProgress: "" } });
      return ctx.reply("❌ Manual deposit cancelled.");
    }

    // --- State 1: No deposit in progress (start a new one) ---
    if (!user || !user.depositInProgress?.status) {
      // Initialize the deposit flow
      await User.findOneAndUpdate(
        { telegramId },
        { $set: { "depositInProgress.status": "awaiting_amount" } },
        { upsert: true }
      );
      return ctx.reply("💰 ለማስገባት የሚፈልጉትን መጠን ያስገቡ: (ለመውጣት /cancel)");
    }

    // --- State 2: Awaiting amount ---
    if (user.depositInProgress.status === "awaiting_amount") {
      const amount = parseFloat(ctx.message.text);
      if (isNaN(amount) || amount <= 0) {
        return ctx.reply("🚫 የተሳሳተ መጠን። እባክዎ ትክክለኛ ቁጥር ያስገቡ (ለምሳሌ፦ 100)። (ለመውጣት /cancel)");
      }

      await User.findOneAndUpdate(
        { telegramId },
        { $set: { 
            "depositInProgress.status": "awaiting_method", 
            "depositInProgress.amount": amount 
          } 
        }
      );

      return ctx.reply(
        `💰 የሚፈልጉት ${amount} ብር ለማስገባት ነው። እባክዎ የክፍያ ዘዴዎን ይምረጡ: (ለመውጣት /cancel)`,
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: "CBE to CBE", callback_data: "payment_cbe" }],
              [{ text: "Telebirr To Telebirr", callback_data: "payment_telebirr" }],
            ],
          },
        }
      );
    }

    // --- State 3: Awaiting SMS/transaction ID ---
    if (user.depositInProgress.status === "awaiting_sms") {
      const userMessage = ctx.message?.text || ctx.message?.caption;
      if (!userMessage) {
        return ctx.reply("❌ Please forward the SMS message correctly. (Type /cancel to exit)");
      }

      const claimedAmount = user.depositInProgress.amount;
      const depositType = user.depositInProgress.method;

      const cbeRegex = /FT\s*([A-Z0-9]{10})/i;
      const telebirrRegex = /(?:transaction\s*number\s*is|የሂሳብ\s*እንቅስቃሴ\s*ቁጥር|Txn\s*ID|Reference\s*No)[^\w]*([A-Z0-9]{10})/i;

      let transactionId = null;
      if (cbeRegex.test(userMessage)) transactionId = userMessage.match(cbeRegex)[1];
      else if (telebirrRegex.test(userMessage)) transactionId = userMessage.match(telebirrRegex)[1];

      if (!transactionId) {
        return ctx.reply("🚫 Invalid message. Ensure it is the original CBE/Telebirr SMS. (Type /cancel to exit)");
      }

      const matchingSms = await SmsMessage.findOne({
        status: "pending",
        message: { $regex: new RegExp(transactionId, "i") },
        message: { $regex: new RegExp(claimedAmount.toFixed(2).replace('.', '\\.'), "i") },
      });

      if (!matchingSms) {
        return ctx.reply("🚫 No matching deposit found. Ensure you forwarded the correct message. (Type /cancel to exit)");
      }

      const balanceBefore = user.balance;
      const newBalance = balanceBefore + claimedAmount;

      await Deposit.create({
        userId: user._id,
        telegramId: user.telegramId,
        amount: claimedAmount,
        method: depositType,
        status: "approved",
        transactionId,
        smsMessageId: matchingSms._id,
        balanceBefore,
        balanceAfter: newBalance,
      });

      matchingSms.status = "processed";
      await matchingSms.save();

      const updatedUser = await User.findOneAndUpdate(
        { telegramId },
        { balance: newBalance, $unset: { depositInProgress: "" } },
        { new: true }
      );

      return ctx.reply(
        `✅ Your deposit of ${claimedAmount} ETB has been approved! New balance: *${updatedUser.balance} ETB*`,
        { parse_mode: "Markdown" }
      );
    }
    
    // Fallback for unexpected state
    return ctx.reply("An unexpected error occurred. Please try again or type /cancel.");

  } catch (error) {
    if (error.code === 11000) {
      return ctx.reply("🚫 This transaction has already been processed.");
    }
    if (error?.msBeforeNext) {
      return ctx.reply("⚠️ Too many requests. Please wait a moment before trying again.");
    }
    console.error("❌ Error in manual deposit flow:", error);
    await ctx.reply("🚫 An error occurred. Please try again.");
    // Clear the state on critical error
    await User.findOneAndUpdate({ telegramId: ctx.from.id }, { $unset: { depositInProgress: "" } });
  }
}

module.exports = (bot) => {
  // Use a command to start the flow
  bot.command("deposit", handleDepositFlow);

  // Handle all other text messages within the conversation flow
  bot.on("text", async (ctx, next) => {
    const user = await User.findOne({ telegramId: ctx.from.id });
    if (user?.depositInProgress?.status) {
      return handleDepositFlow(ctx);
    }
    return next(); // Pass control to other handlers
  });

  // Handle callback queries for payment method selection
  bot.on("callback_query", async (ctx, next) => {
    const user = await User.findOne({ telegramId: ctx.from.id });
    const depositStatus = user?.depositInProgress?.status;
    
    if (depositStatus === "awaiting_method" && ctx.callbackQuery.data.startsWith("payment_")) {
        const method = ctx.callbackQuery.data;
        await ctx.answerCbQuery();

        const amount = user.depositInProgress.amount;
        let depositType = "";
        let instructions = "";

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

- የክፍያ ችግር ካለ፣ [@luckybingos] ኤጀንቱን ማዋራት ይችላሉ፡፡     ለማቋረጥ /cancel

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
        
        await User.findOneAndUpdate(
          { telegramId: ctx.from.id },
          { $set: { 
              "depositInProgress.status": "awaiting_sms",
              "depositInProgress.method": depositType
            }
          }
        );

        return ctx.editMessageText(instructions, { parse_mode: "Markdown" });
    }
    return next(); // Pass to other callback query handlers
  });
};